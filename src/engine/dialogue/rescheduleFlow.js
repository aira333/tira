// apps/skill-backend/src/dialogue/rescheduleFlow.js
// Reschedule (edit in place) via dialogue — Step 10

const {
  findByDoctor,
  updateAppointment,
  checkForConflicts,
  formatAppointmentForSpeech,
  formatConflictPromptSpeech,
  getAppointmentById,
  deleteUserAppointment,
} = require('../modules/appointment/appointment.service');
const {
  parseDateAnswer,
  parseTimeAnswer,
  normalizeUtterance,
} = require('./parsers');
const prompts = require('./prompts');
const { matchDeleteCandidate, cleanDeleteDoctorName } = require('./navFlow');
const { attachReminderAfterSave, cancelReminderForAppointment } = require('../libs/remindersClient');
const { formatDateForSpeech, formatTimeForSpeech } = require('../libs/speechFormat');
const safeLog = require('../log');

const STEPS = {
  DOCTOR: 'awaiting_reschedule_doctor',
  CHOICE: 'awaiting_reschedule_choice',
  DATE: 'awaiting_reschedule_date',
  TIME: 'awaiting_reschedule_time',
  CONFIRM: 'awaiting_reschedule_confirm',
  CONFLICT: 'awaiting_reschedule_conflict',
};

/** Slim match metadata for session — no nested full row. */
function candidateFromAppointment(apt, index) {
  return {
    index,
    appointmentId: apt.appointmentId,
    doctorName: apt.doctorName,
    date: apt.date,
    time: apt.time,
    dateTime: apt.dateTime,
    location: apt.location,
    durationMinutes: apt.durationMinutes,
  };
}

function promptForRescheduleStep(dialogue) {
  const { step, slots } = dialogue;
  switch (step) {
    case STEPS.DOCTOR:
      return {
        speak:
          "Which doctor's appointment would you like to reschedule? For example, Doctor Smith.",
        reprompt: "Please say the doctor's name.",
      };
    case STEPS.CHOICE: {
      const list = (slots.candidates || [])
        .map(
          (c) =>
            `Number ${c.index}: ${formatAppointmentForSpeech({
              doctorName: c.doctorName,
              date: c.date,
              time: c.time,
              dateTime: c.dateTime,
              durationMinutes: c.durationMinutes,
            })}`,
        )
        .join('. ');
      return {
        speak: `I found more than one match. ${list}. Which one should I reschedule? Say a number, or the date and time.`,
        reprompt: 'Say number 1, or the date and time of the appointment.',
      };
    }
    case STEPS.DATE:
      return {
        speak: `What is the new date for your appointment with ${slots.selected?.doctorName || 'your doctor'}?`,
        reprompt: 'Please say the new date.',
      };
    case STEPS.TIME:
      return {
        speak: `What is the new time for your appointment with ${slots.selected?.doctorName || 'your doctor'}?`,
        reprompt: 'Please say the new time.',
      };
    case STEPS.CONFIRM: {
      const selected = slots.selected || {};
      const newDateSpeech = formatDateForSpeech({
        date: slots.newDate,
        dateTime: null,
      });
      const newTimeSpeech = formatTimeForSpeech({
        date: slots.newDate,
        time: slots.newTime,
      });
      return {
        speak:
          `Just to confirm: move ${formatAppointmentForSpeech(selected)} to ${newDateSpeech} at ${newTimeSpeech}? ` +
          'Say yes to update, or no to cancel.',
        reprompt: 'Say yes to update the appointment, or no to cancel.',
      };
    }
    case STEPS.CONFLICT: {
      const existing = slots.conflictAppointment || {};
      return {
        speak: `${formatConflictPromptSpeech(existing, {
          doctorName: slots.selected?.doctorName,
          date: slots.newDate,
          time: slots.newTime,
          durationMinutes: slots.selected?.durationMinutes,
        })} Or say cancel to leave both as they are and stop rescheduling.`,
        reprompt:
          'Say yes to keep both, no to replace the overlapping one, or cancel.',
      };
    }
    default:
      return prompts.unclearIdle();
  }
}

function advanceAfterSelection(dialogue) {
  if (!dialogue.slots.newDate) {
    dialogue.step = STEPS.DATE;
  } else if (!dialogue.slots.newTime) {
    dialogue.step = STEPS.TIME;
  } else {
    dialogue.step = STEPS.CONFIRM;
  }
  dialogue.promptId = dialogue.step;
  return dialogue;
}

/**
 * Begin reschedule from idle classify / intent slots.
 */
async function prepareReschedule(userId, { doctorName = null, date = null, time = null } = {}) {
  const slots = {
    doctorName: doctorName ? cleanDeleteDoctorName(doctorName) : null,
    newDate: date || null,
    newTime: time || null,
  };

  if (!slots.doctorName) {
    return {
      domain: 'reschedule',
      step: STEPS.DOCTOR,
      slots,
      promptId: STEPS.DOCTOR,
    };
  }

  return resolveDoctorAndContinue(userId, slots);
}

async function resolveDoctorAndContinue(userId, slots) {
  const appointments = await findByDoctor(userId, slots.doctorName);
  if (appointments.length === 0) {
    return {
      domain: null,
      step: null,
      slots: {},
      _terminal: {
        speak: `You don't have any appointments with ${slots.doctorName} to reschedule. What else can I help you with?`,
        reprompt: prompts.OPEN_REPROMPT,
      },
    };
  }

  if (appointments.length > 1) {
    return {
      domain: 'reschedule',
      step: STEPS.CHOICE,
      slots: {
        ...slots,
        candidates: appointments.map((apt, i) => candidateFromAppointment(apt, i + 1)),
      },
      promptId: STEPS.CHOICE,
    };
  }

  const selected = candidateFromAppointment(appointments[0], 1);
  const dialogue = {
    domain: 'reschedule',
    step: STEPS.CONFIRM,
    slots: { ...slots, selected },
    promptId: STEPS.CONFIRM,
  };
  return advanceAfterSelection(dialogue);
}

async function prepareAndMaybeFinishReschedule(handlerInput, dialogue) {
  if (dialogue._terminal) {
    return {
      dialogue: { domain: null, step: null, slots: {} },
      done: true,
      prompt: dialogue._terminal,
    };
  }
  return {
    dialogue,
    done: false,
    prompt: promptForRescheduleStep(dialogue),
  };
}

async function finishReschedule(handlerInput, dialogue) {
  const userId =
    handlerInput.requestEnvelope.context?.System?.user?.userId ||
    handlerInput.requestEnvelope.session?.user?.userId;
  const selectedMeta = dialogue.slots.selected;
  const { newDate, newTime } = dialogue.slots;

  try {
    const selected = await getAppointmentById(userId, selectedMeta?.appointmentId);
    if (!selected) {
      return {
        dialogue: { domain: null, step: null, slots: {} },
        done: true,
        prompt: {
          speak:
            'I could not find that appointment anymore. What else can I help you with?',
          reprompt: prompts.OPEN_REPROMPT,
        },
      };
    }

    const conflicts = await checkForConflicts(userId, newDate, newTime, {
      durationMinutes: selected.durationMinutes || 60,
      excludeAppointmentId: selected.appointmentId,
    });
    if (conflicts.length > 0 && !dialogue.slots.keepBothConflict) {
      dialogue.slots.conflictAppointment = {
        appointmentId: conflicts[0].appointmentId,
        doctorName: conflicts[0].doctorName,
        date: conflicts[0].date,
        time: conflicts[0].time,
        dateTime: conflicts[0].dateTime,
        durationMinutes: conflicts[0].durationMinutes,
      };
      dialogue.step = STEPS.CONFLICT;
      dialogue.promptId = STEPS.CONFLICT;
      return {
        dialogue,
        done: false,
        prompt: promptForRescheduleStep(dialogue),
      };
    }

    const updated = await updateAppointment(userId, selected.appointmentId, {
      date: newDate,
      time: newTime,
    });

    let speak = `I've updated your appointment with ${updated.doctorName} to ${formatDateForSpeech(updated)} at ${formatTimeForSpeech(updated)}.`;

    // Cancel any prior device reminder before attaching one for the new time
    if (selected.alexaReminderId) {
      await cancelReminderForAppointment(handlerInput, selected);
    }

    const lead = selected.reminderLeadMinutes;
    if (lead) {
      const reminderResult = await attachReminderAfterSave(handlerInput, updated, lead);
      if (reminderResult.alexaReminderId) {
        speak += reminderResult.speakSuffix;
        await updateAppointment(userId, updated.appointmentId, {
          alexaReminderId: reminderResult.alexaReminderId,
          reminderLeadMinutes: lead,
        });
      } else if (reminderResult.permissionsToAsk) {
        speak += reminderResult.speakSuffix || '';
        await updateAppointment(userId, updated.appointmentId, {
          alexaReminderId: null,
        });
        return {
          dialogue: { domain: null, step: null, slots: {} },
          done: true,
          prompt: {
            speak: `${speak} What else can I help you with?`,
            reprompt: prompts.OPEN_REPROMPT,
          },
          permissionsToAsk: reminderResult.permissionsToAsk,
        };
      } else {
        speak += reminderResult.speakSuffix || '';
        await updateAppointment(userId, updated.appointmentId, {
          alexaReminderId: null,
        });
      }
    } else if (selected.alexaReminderId) {
      await updateAppointment(userId, updated.appointmentId, {
        alexaReminderId: null,
        reminderLeadMinutes: null,
      });
    }

    speak += ' What else can I help you with?';
    return {
      dialogue: { domain: null, step: null, slots: {} },
      done: true,
      prompt: { speak, reprompt: prompts.OPEN_REPROMPT },
    };
  } catch (e) {
    safeLog.error('reschedule_finish_failed', {
      errorMessage: e?.message,
      errorName: e?.name,
    });
    return {
      dialogue: { domain: null, step: null, slots: {} },
      done: true,
      prompt: {
        speak: 'Sorry, I had trouble updating that appointment. Please try again.',
        reprompt: prompts.OPEN_REPROMPT,
      },
    };
  }
}

async function applyRescheduleAnswer(handlerInput, utterance) {
  const session = handlerInput.attributesManager.getSessionAttributes();
  const { getDialogue } = require('./state');
  const current = getDialogue(session);
  const dialogue = {
    domain: current.domain,
    step: current.step,
    slots: { ...(current.slots || {}) },
    promptId: current.promptId,
  };
  const userId =
    handlerInput.requestEnvelope.context?.System?.user?.userId ||
    handlerInput.requestEnvelope.session?.user?.userId;
  const text = normalizeUtterance(utterance);

  if (dialogue.step === STEPS.DOCTOR) {
    const name = cleanDeleteDoctorName(text);
    if (!name) {
      return { dialogue, done: false, prompt: promptForRescheduleStep(dialogue) };
    }
    dialogue.slots.doctorName = name;
    const next = await resolveDoctorAndContinue(userId, dialogue.slots);
    if (next._terminal) {
      return {
        dialogue: { domain: null, step: null, slots: {} },
        done: true,
        prompt: next._terminal,
      };
    }
    return {
      dialogue: next,
      done: false,
      prompt: promptForRescheduleStep(next),
    };
  }

  if (dialogue.step === STEPS.CHOICE) {
    let match = matchDeleteCandidate(dialogue.slots.candidates || [], utterance);
    if (!match) {
      const needle = text.toLowerCase().replace(/^(dr\.?|doctor)\s+/i, '').trim();
      const byDoctor = (dialogue.slots.candidates || []).filter((c) =>
        String(c.doctorName || '')
          .toLowerCase()
          .includes(needle),
      );
      if (byDoctor.length === 1) match = byDoctor[0];
    }
    if (!match) {
      return {
        dialogue,
        done: false,
        prompt: {
          speak: `I didn't catch which appointment. ${promptForRescheduleStep(dialogue).speak}`,
          reprompt: promptForRescheduleStep(dialogue).reprompt,
        },
      };
    }
    dialogue.slots.selected = match;
    delete dialogue.slots.candidates;
    const next = advanceAfterSelection(dialogue);
    return {
      dialogue: next,
      done: false,
      prompt: promptForRescheduleStep(next),
    };
  }

  if (dialogue.step === STEPS.DATE) {
    const parsed = parseDateAnswer(text);
    if (!parsed?.date) {
      return {
        dialogue,
        done: false,
        prompt: {
          speak: "I didn't catch the new date. Please say a day, like Friday or July 30.",
          reprompt: 'Please say the new date.',
        },
      };
    }
    dialogue.slots.newDate = parsed.date;
    if (parsed.time) dialogue.slots.newTime = parsed.time;
    const next = advanceAfterSelection(dialogue);
    return {
      dialogue: next,
      done: false,
      prompt: promptForRescheduleStep(next),
    };
  }

  if (dialogue.step === STEPS.TIME) {
    const parsed = parseTimeAnswer(text);
    if (!parsed?.time) {
      return {
        dialogue,
        done: false,
        prompt: {
          speak: "I didn't catch the new time. Please say a time, like 3 P.M.",
          reprompt: 'Please say the new time.',
        },
      };
    }
    dialogue.slots.newTime = parsed.time;
    dialogue.step = STEPS.CONFIRM;
    dialogue.promptId = STEPS.CONFIRM;
    return {
      dialogue,
      done: false,
      prompt: promptForRescheduleStep(dialogue),
    };
  }

  if (dialogue.step === STEPS.CONFIRM) {
    const t = text.toLowerCase();
    if (/^(no|nope|cancel|never mind)\b/.test(t) || /\b(cancel|keep it)\b/.test(t)) {
      return {
        dialogue: { domain: null, step: null, slots: {} },
        done: true,
        prompt: {
          speak: 'Okay, I will not change that appointment. What else can I help you with?',
          reprompt: prompts.OPEN_REPROMPT,
        },
      };
    }
    if (!/\b(yes|yeah|yep|confirm|update|change|do it)\b/.test(t)) {
      return { dialogue, done: false, prompt: promptForRescheduleStep(dialogue) };
    }
    return finishReschedule(handlerInput, dialogue);
  }

  if (dialogue.step === STEPS.CONFLICT) {
    const t = text.toLowerCase();
    if (/\b(cancel|never mind|stop)\b/.test(t) && !/\b(no|replace)\b/.test(t)) {
      return {
        dialogue: { domain: null, step: null, slots: {} },
        done: true,
        prompt: {
          speak: 'Okay, I will not reschedule that appointment. What else can I help you with?',
          reprompt: prompts.OPEN_REPROMPT,
        },
      };
    }
    if (/\b(yes|keep both|keep)\b/.test(t)) {
      dialogue.slots.keepBothConflict = true;
      return finishReschedule(handlerInput, dialogue);
    }
    if (/\b(no|replace)\b/.test(t)) {
      const conflictId = dialogue.slots.conflictAppointment?.appointmentId;
      if (conflictId) {
        try {
          const full = await getAppointmentById(userId, conflictId);
          if (full) {
            await cancelReminderForAppointment(handlerInput, full);
            await deleteUserAppointment(userId, full.appointmentId);
          }
        } catch (e) {
          safeLog.error('reschedule_replace_conflict_failed', {
            errorMessage: e?.message,
            errorName: e?.name,
          });
        }
      }
      dialogue.slots.keepBothConflict = true;
      delete dialogue.slots.conflictAppointment;
      return finishReschedule(handlerInput, dialogue);
    }
    return { dialogue, done: false, prompt: promptForRescheduleStep(dialogue) };
  }

  return { dialogue, done: false, prompt: promptForRescheduleStep(dialogue) };
}

module.exports = {
  STEPS,
  prepareReschedule,
  prepareAndMaybeFinishReschedule,
  promptForRescheduleStep,
  applyRescheduleAnswer,
};
