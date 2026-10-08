// apps/skill-backend/src/dialogue/appointmentFlow.js
// Appointment add flow driven by dialogue steps

const {
  createAppointment,
  checkForConflicts,
  formatConflictPromptSpeech,
  parseDurationFromSpeech,
  formatDurationForSpeech,
  deleteUserAppointment,
  updateAppointment,
  getAppointmentById,
  DEFAULT_DURATION_MINUTES,
} = require('../modules/appointment/appointment.service');
const { getDialogue, setDialogue, clearDialogue } = require('./state');
const Alexa = require('../ask');
const {
  parseDoctorAnswer,
  parseDateAnswer,
  parseTimeAnswer,
  parseSkipLocation,
  parseSkipOptionalAdd,
  cleanLocationAnswer,
  parseReminderLead,
  normalizeUtterance,
  sanitizeDoctorName,
} = require('./parsers');
const prompts = require('./prompts');
const { attachReminderAfterSave, cancelReminderForAppointment } = require('../libs/remindersClient');
const safeLog = require('../log');

const STEPS = {
  DOCTOR: 'awaiting_doctor',
  DATE: 'awaiting_date',
  TIME: 'awaiting_time',
  LOCATION: 'awaiting_location',
  DURATION: 'awaiting_duration',
  REMINDER: 'awaiting_reminder',
  CONFLICT: 'awaiting_conflict',
};

function proposedDurationMinutes(slots) {
  if (slots.durationDone || slots.duration) {
    return parseDurationFromSpeech(slots.duration || null).minutes;
  }
  return DEFAULT_DURATION_MINUTES;
}

function applyConflictSlots(dialogue, conflict) {
  dialogue.slots.conflictDoctorName = conflict.doctorName;
  dialogue.slots.conflictAppointmentId = conflict.appointmentId;
  dialogue.slots.conflictAppointment = {
    appointmentId: conflict.appointmentId,
    doctorName: conflict.doctorName,
    date: conflict.date,
    time: conflict.time,
    dateTime: conflict.dateTime,
    durationMinutes: conflict.durationMinutes,
  };
  dialogue.step = STEPS.CONFLICT;
  dialogue.promptId = STEPS.CONFLICT;
}

async function findConflictsForSlots(userId, slots) {
  return checkForConflicts(userId, slots.date, slots.time, {
    durationMinutes: proposedDurationMinutes(slots),
  });
}

function startAddAppointment(slots = {}) {
  const s = { ...slots };
  if (s.doctorName) {
    s.doctorName = sanitizeDoctorName(s.doctorName);
    if (!s.doctorName) delete s.doctorName;
  }
  let step = STEPS.DOCTOR;
  if (s.doctorName && s.date && s.time) {
    // Caller should run prepareAppointmentDialogue for conflict check
    step = STEPS.LOCATION;
  } else if (s.doctorName && s.date) {
    step = STEPS.TIME;
  } else if (s.doctorName) {
    step = STEPS.DATE;
  }
  return {
    domain: 'appointment',
    step,
    slots: s,
    promptId: step,
  };
}

/**
 * Start add flow and run conflict check when doctor+date+time already known.
 * If all optionals already filled and no conflict, returns step null with readyToSave.
 */
async function prepareAppointmentDialogue(userId, slots = {}) {
  const dialogue = startAddAppointment(slots);

  if (
    dialogue.slots.doctorName &&
    dialogue.slots.date &&
    dialogue.slots.time
  ) {
    try {
      const conflicts = await findConflictsForSlots(userId, dialogue.slots);
      if (conflicts.length > 0) {
        applyConflictSlots(dialogue, conflicts[0]);
        return dialogue;
      }
    } catch (e) {
      console.warn('Dialogue conflict check skipped:', e.message);
    }

    // Advance past completed optional steps
    if (!dialogue.slots.locationDone) {
      dialogue.step = STEPS.LOCATION;
    } else if (!dialogue.slots.durationDone) {
      dialogue.step = STEPS.DURATION;
    } else if (!dialogue.slots.reminderDone) {
      dialogue.step = STEPS.REMINDER;
    } else {
      dialogue.step = 'ready_to_save';
      dialogue.promptId = 'ready_to_save';
    }
  }

  return dialogue;
}

function promptForStep(dialogue) {
  const { step, slots } = dialogue;
  switch (step) {
    case STEPS.DOCTOR:
      return prompts.askDoctor();
    case STEPS.DATE:
      return prompts.askDate(slots.doctorName || 'your doctor');
    case STEPS.TIME:
      return prompts.askTime(slots.doctorName || 'your doctor');
    case STEPS.LOCATION:
      return prompts.askLocation(slots.doctorName, slots.date, slots.time);
    case STEPS.DURATION:
      return prompts.askDuration();
    case STEPS.REMINDER:
      return prompts.askReminder();
    case STEPS.CONFLICT: {
      const existing = slots.conflictAppointment || {
        doctorName: slots.conflictDoctorName,
        date: slots.date,
        time: slots.time,
      };
      return {
        speak: formatConflictPromptSpeech(existing, {
          doctorName: slots.doctorName,
          date: slots.date,
          time: slots.time,
          durationMinutes: proposedDurationMinutes(slots),
        }),
        reprompt: 'Say yes to keep both, no to replace the old one, or cancel.',
      };
    }
    default:
      return prompts.askDoctor();
  }
}

function nextStepAfterSlots(slots, afterConflict = false) {
  if (!slots.doctorName) return STEPS.DOCTOR;
  if (!slots.date) return STEPS.DATE;
  if (!slots.time) return STEPS.TIME;
  if (!slots.locationDone) return STEPS.LOCATION;
  if (!slots.durationDone) return STEPS.DURATION;
  if (!slots.reminderDone) return STEPS.REMINDER;
  return null;
}

/**
 * Apply a spoken answer to the current appointment dialogue step.
 * @returns {{ dialogue, prompt, done, speakExtra }}
 */
async function applyAppointmentAnswer(handlerInput, utterance) {
  const attributesManager = handlerInput.attributesManager;
  let session = attributesManager.getSessionAttributes();
  let dialogue = getDialogue(session);
  const text = normalizeUtterance(utterance);
  const userId =
    handlerInput.requestEnvelope.context?.System?.user?.userId ||
    handlerInput.requestEnvelope.session?.user?.userId;

  if (dialogue.step === STEPS.DOCTOR) {
    const doctorName = parseDoctorAnswer(text);
    if (!doctorName) {
      return { dialogue, prompt: prompts.retryDoctor() };
    }
    dialogue.slots.doctorName = doctorName;

    // Opportunistically capture date/time if given in the same reply
    // (e.g. "doctor smith tomorrow 12:00 pm") instead of discarding them
    // and re-asking for a date already provided.
    const parsedDate = parseDateAnswer(text);
    if (parsedDate?.date) {
      dialogue.slots.date = parsedDate.date;
      if (parsedDate.time) {
        dialogue.slots.time = parsedDate.time;
        try {
          const conflicts = await findConflictsForSlots(userId, dialogue.slots);
          if (conflicts.length > 0) {
            applyConflictSlots(dialogue, conflicts[0]);
            return { dialogue, prompt: promptForStep(dialogue) };
          }
        } catch (e) {
          console.warn('Dialogue conflict check skipped:', e.message);
        }
        dialogue.step = STEPS.LOCATION;
      } else {
        dialogue.step = STEPS.TIME;
      }
    } else {
      dialogue.step = STEPS.DATE;
    }
    dialogue.promptId = dialogue.step;
    return { dialogue, prompt: promptForStep(dialogue) };
  }

  if (dialogue.step === STEPS.DATE) {
    const parsed = parseDateAnswer(text);
    if (!parsed?.date) {
      return { dialogue, prompt: prompts.retryDate() };
    }
    dialogue.slots.date = parsed.date;
    if (parsed.time) {
      dialogue.slots.time = parsed.time;
      dialogue.step = STEPS.LOCATION;
    } else {
      dialogue.step = STEPS.TIME;
    }
    dialogue.promptId = dialogue.step;
    return { dialogue, prompt: promptForStep(dialogue) };
  }

  if (dialogue.step === STEPS.TIME) {
    const parsed = parseTimeAnswer(text);
    if (!parsed?.time) {
      return { dialogue, prompt: prompts.retryTime() };
    }
    dialogue.slots.time = parsed.time;

    // Conflict check before optional fields (duration window)
    try {
      const conflicts = await findConflictsForSlots(userId, dialogue.slots);
      if (conflicts.length > 0) {
        applyConflictSlots(dialogue, conflicts[0]);
        return { dialogue, prompt: promptForStep(dialogue) };
      }
    } catch (e) {
      console.warn('Dialogue conflict check skipped:', e.message);
    }

    dialogue.step = STEPS.LOCATION;
    dialogue.promptId = STEPS.LOCATION;
    return { dialogue, prompt: promptForStep(dialogue) };
  }

  if (dialogue.step === STEPS.CONFLICT) {
    const t = text.toLowerCase();
    if (/\b(yes|keep both|keep)\b/.test(t)) {
      dialogue.slots.keepBoth = true;
      dialogue.step = STEPS.LOCATION;
      dialogue.promptId = STEPS.LOCATION;
      return { dialogue, prompt: promptForStep(dialogue) };
    }
    if (/\b(no|replace)\b/.test(t)) {
      let prefix = '';
      if (dialogue.slots.conflictAppointmentId) {
        try {
          const full = await getAppointmentById(
            userId,
            dialogue.slots.conflictAppointmentId,
          );
          if (full) {
            await cancelReminderForAppointment(handlerInput, full);
            await deleteUserAppointment(userId, full.appointmentId);
            prefix = 'I deleted your existing appointment. ';
          }
        } catch (e) {
          safeLog.error('replace_conflict_delete_failed', {
            errorMessage: e?.message,
            errorName: e?.name,
          });
        }
      }
      dialogue.slots.replaceConflict = true;
      delete dialogue.slots.conflictAppointmentId;

      if (
        dialogue.slots.locationDone &&
        dialogue.slots.durationDone &&
        dialogue.slots.reminderDone
      ) {
        const saved = await finishAppointment(handlerInput, dialogue);
        saved.prompt.speak = prefix + saved.prompt.speak;
        return saved;
      }

      if (!dialogue.slots.locationDone) {
        dialogue.step = STEPS.LOCATION;
      } else if (!dialogue.slots.durationDone) {
        dialogue.step = STEPS.DURATION;
      } else {
        dialogue.step = STEPS.REMINDER;
      }
      dialogue.promptId = dialogue.step;
      const nextPrompt = promptForStep(dialogue);
      return {
        dialogue,
        prompt: {
          speak: prefix + nextPrompt.speak,
          reprompt: nextPrompt.reprompt,
        },
      };
    }
    return { dialogue, prompt: promptForStep(dialogue) };
  }

  if (dialogue.step === STEPS.LOCATION) {
    if (parseSkipOptionalAdd(text)) {
      dialogue.slots.location = 'Not specified';
      dialogue.slots.locationDone = true;
      dialogue.slots.duration = 'default';
      dialogue.slots.durationDone = true;
      dialogue.slots.reminderLeadMinutes = null;
      dialogue.slots.reminderDone = true;
      return finishAppointment(handlerInput, dialogue);
    }
    if (parseSkipLocation(text)) {
      dialogue.slots.location = 'Not specified';
    } else {
      const envelope = handlerInput.requestEnvelope;
      const locationSlot = Alexa.getSlotValue(envelope, 'Location') || '';
      const doctorAsPlace = Alexa.getSlotValue(envelope, 'DoctorName') || '';
      // Mid-flow: Alexa may route a place name into DoctorName ("Mason")
      const placeHint = locationSlot || doctorAsPlace;
      dialogue.slots.location = cleanLocationAnswer(placeHint || text);
    }
    dialogue.slots.locationDone = true;
    dialogue.step = STEPS.DURATION;
    dialogue.promptId = STEPS.DURATION;
    return { dialogue, prompt: promptForStep(dialogue) };
  }

  if (dialogue.step === STEPS.DURATION) {
    if (parseSkipOptionalAdd(text)) {
      dialogue.slots.duration = 'default';
      dialogue.slots.durationDone = true;
      dialogue.slots.reminderLeadMinutes = null;
      dialogue.slots.reminderDone = true;
      return finishAppointment(handlerInput, dialogue);
    }
    const durationSlot =
      Alexa.getSlotValue(handlerInput.requestEnvelope, 'Duration') || '';
    const t = text.toLowerCase();
    if (/\b(default|skip|one hour|1 hour)\b/.test(t) || !t) {
      // Prefer explicit Duration slot over spoken "1 hour" when Alexa filled ISO
      if (durationSlot && !/^(default|skip)$/i.test(durationSlot)) {
        dialogue.slots.duration = durationSlot;
      } else {
        dialogue.slots.duration = 'default';
      }
    } else {
      dialogue.slots.duration = durationSlot || text;
    }
    dialogue.slots.durationDone = true;

    // Re-check overlap with the chosen duration (window may grow)
    if (!dialogue.slots.keepBoth && !dialogue.slots.replaceConflict) {
      try {
        const conflicts = await findConflictsForSlots(userId, dialogue.slots);
        if (conflicts.length > 0) {
          applyConflictSlots(dialogue, conflicts[0]);
          return { dialogue, prompt: promptForStep(dialogue) };
        }
      } catch (e) {
        console.warn('Dialogue conflict re-check skipped:', e.message);
      }
    }

    dialogue.step = STEPS.REMINDER;
    dialogue.promptId = STEPS.REMINDER;
    return { dialogue, prompt: promptForStep(dialogue) };
  }

  if (dialogue.step === STEPS.REMINDER) {
    if (parseSkipOptionalAdd(text)) {
      dialogue.slots.reminderLeadMinutes = null;
      dialogue.slots.reminderDone = true;
      return finishAppointment(handlerInput, dialogue);
    }
    let parsed = parseReminderLead(text);
    // Mid-flow: Alexa often fills ReminderTime/Duration as ISO (P1D) while speech is "one day"
    if (!parsed.valid) {
      const envelope = handlerInput.requestEnvelope;
      const slotHint =
        Alexa.getSlotValue(envelope, 'ReminderTime') ||
        Alexa.getSlotValue(envelope, 'Duration') ||
        '';
      if (slotHint) parsed = parseReminderLead(slotHint);
    }
    if (!parsed.valid) {
      return { dialogue, prompt: prompts.retryReminder() };
    }
    dialogue.slots.reminderLeadMinutes = parsed.leadMinutes;
    dialogue.slots.reminderDone = true;
    return finishAppointment(handlerInput, dialogue);
  }

  return { dialogue, prompt: promptForStep(dialogue) };
}

async function finishAppointment(handlerInput, dialogue) {
  const userId =
    handlerInput.requestEnvelope.context?.System?.user?.userId ||
    handlerInput.requestEnvelope.session?.user?.userId;
  const slots = dialogue.slots;

  if (slots.replaceConflict && slots.conflictAppointmentId) {
    try {
      const full = await getAppointmentById(userId, slots.conflictAppointmentId);
      if (full) {
        await cancelReminderForAppointment(handlerInput, full);
        await deleteUserAppointment(userId, full.appointmentId);
      }
    } catch (e) {
      safeLog.error('replace_conflict_delete_failed', {
        errorMessage: e?.message,
        errorName: e?.name,
      });
    }
  }

  const { minutes: durationMinutes, capped } = parseDurationFromSpeech(
    slots.duration || null,
  );
  const durationSpeech = formatDurationForSpeech(durationMinutes);
  const leadMinutes =
    slots.reminderLeadMinutes === undefined ? null : slots.reminderLeadMinutes;

  let appointment;
  try {
    appointment = await createAppointment(userId, {
      doctorName: slots.doctorName,
      date: slots.date,
      time: slots.time,
      location: slots.location || 'Not specified',
      notes: '',
      reminderLeadMinutes: leadMinutes,
      duration: slots.duration || null,
    });
  } catch (e) {
    safeLog.error('create_appointment_failed', {
      errorMessage: e?.message,
      errorName: e?.name,
    });
    return {
      dialogue: { domain: null, step: null, slots: {} },
      done: true,
      prompt: {
        speak:
          'I could not save that appointment. Please try again in a moment, or say help. What else can I help you with?',
        reprompt: prompts.OPEN_REPROMPT,
      },
    };
  }

  let speak = `I've added an appointment with ${slots.doctorName} on ${slots.date} at ${slots.time}`;
  if (slots.location && slots.location !== 'Not specified') {
    speak += ` in ${slots.location}`;
  }
  speak += ` for ${durationSpeech}`;
  if (capped) speak += ' (capped at 8 hours)';
  speak += '.';

  const reminderResult = await attachReminderAfterSave(
    handlerInput,
    appointment,
    leadMinutes,
  );
  speak += reminderResult.speakSuffix;

  if (reminderResult.alexaReminderId) {
    try {
      await updateAppointment(userId, appointment.appointmentId, {
        alexaReminderId: reminderResult.alexaReminderId,
        reminderLeadMinutes: leadMinutes,
      });
    } catch (e) {
      safeLog.error('store_reminder_id_failed', {
        errorMessage: e?.message,
        errorName: e?.name,
      });
    }
  }

  speak += ' What else can I help you with?';

  return {
    dialogue: { domain: null, step: null, slots: {} },
    done: true,
    permissionsToAsk: reminderResult.permissionsToAsk,
    prompt: { speak, reprompt: prompts.OPEN_REPROMPT },
  };
}

module.exports = {
  STEPS,
  startAddAppointment,
  prepareAppointmentDialogue,
  promptForStep,
  applyAppointmentAnswer,
  finishAppointment,
  nextStepAfterSlots,
};
