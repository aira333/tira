// apps/skill-backend/src/dialogue/turnRouter.js
// Sole ASK IntentRequest surface (except idle Cancel/Stop)
// Utterance-first: Alexa routes; local classify interprets messy speech

const Alexa = require('../ask');
const {
  getDialogue,
  setDialogue,
  clearDialogue,
  hasActiveStep,
} = require('./state');
const {
  isCancelUtterance,
  parseHelpDomain,
  parseNameAnswer,
  parseReminderLead,
  parseDateAnswer,
  parseTimeAnswer,
  parseListVerbosityAnswer,
  normalizeUtterance,
  sanitizeDoctorName,
  utteranceHasExplicitTime,
} = require('./parsers');
const { parseFreeForm } = require('../smart-logic/smartDateParser');
const {
  classifyIdleUtterance,
  shouldSwitchFromActiveDialogue,
} = require('./classify');
const { buildSpokenText, isCrispIdleIntent } = require('./utterance');
const prompts = require('./prompts');
const {
  promptForStep,
  applyAppointmentAnswer,
} = require('./appointmentFlow');
const { applyListAnswer, promptForListStep } = require('./listFlow');
const { applyRideAnswer, promptForRideStep } = require('./rideFlow');
const {
  applyNavAnswer,
  promptDeleteChoice,
  promptDeleteConfirm,
  promptDeleteDoctor,
  promptListNav,
  DELETE_STEPS,
  LIST_STEPS,
} = require('./navFlow');
const {
  applyRescheduleAnswer,
  promptForRescheduleStep,
} = require('./rescheduleFlow');
const {
  dispatchClassified,
  respond,
} = require('./dispatch');
const safeLog = require('../log');

/** Current-question prompt for context-sensitive Help. */
async function promptForActiveStep(handlerInput, dialogue) {
  if (!dialogue?.step) return prompts.unclearIdle();
  if (dialogue.domain === 'appointment') return promptForStep(dialogue);
  if (dialogue.domain === 'shopping' || dialogue.domain === 'todo') {
    return promptForListStep(dialogue);
  }
  if (dialogue.domain === 'ride') return promptForRideStep(dialogue);
  if (dialogue.domain === 'delete') {
    if (dialogue.step === DELETE_STEPS.DOCTOR) return promptDeleteDoctor();
    if (dialogue.step === DELETE_STEPS.CHOICE) return promptDeleteChoice(dialogue);
    if (dialogue.step === DELETE_STEPS.CONFIRM) {
      return promptDeleteConfirm(dialogue.slots.selected || {});
    }
  }
  if (dialogue.domain === 'reschedule') {
    return promptForRescheduleStep(dialogue);
  }
  if (dialogue.domain === 'list' && dialogue.step === LIST_STEPS.NAV) {
    const userId =
      handlerInput.requestEnvelope.context?.System?.user?.userId ||
      handlerInput.requestEnvelope.session?.user?.userId;
    return promptListNav(dialogue, userId);
  }
  if (dialogue.domain === 'help') {
    return {
      speak: 'Please say appointments, rides, shopping, or to-dos.',
      reprompt: prompts.OPEN_REPROMPT,
    };
  }
  return prompts.unclearIdle();
}

/**
 * Recover appointment slots from polluted Person/Date/Time (structured hints).
 */
function seedSlotsFromAddIntent(handlerInput) {
  const envelope = handlerInput.requestEnvelope;
  const slots = {};
  const doctorRaw = Alexa.getSlotValue(envelope, 'DoctorName') || '';
  const rawDate = Alexa.getSlotValue(envelope, 'Date');
  const rawTime = Alexa.getSlotValue(envelope, 'Time');
  const location = Alexa.getSlotValue(envelope, 'Location');
  const duration = Alexa.getSlotValue(envelope, 'Duration');
  const reminderTime = Alexa.getSlotValue(envelope, 'ReminderTime');

  const recoverBits = [];
  if (doctorRaw) recoverBits.push(`doctor ${doctorRaw}`);
  if (rawDate) recoverBits.push(String(rawDate));
  if (rawTime) recoverBits.push(`at ${rawTime}`);
  const recovered = parseFreeForm(recoverBits.join(' '));

  const doctor =
    sanitizeDoctorName(doctorRaw) ||
    sanitizeDoctorName(recovered.doctorName);
  if (doctor) slots.doctorName = doctor;

  if (recovered.date) {
    slots.date = recovered.date;
  } else if (rawDate) {
    const parsedDate = parseDateAnswer(rawDate);
    if (parsedDate?.date) slots.date = parsedDate.date;
  }

  if (recovered.time && utteranceHasExplicitTime(recoverBits.join(' '))) {
    slots.time = recovered.time;
  } else if (rawTime) {
    if (/^\d{1,2}:\d{2}/.test(String(rawTime))) {
      slots.time = String(rawTime).slice(0, 5);
    } else {
      const parsedTime = parseTimeAnswer(rawTime);
      if (parsedTime?.time) slots.time = parsedTime.time;
    }
  }
  if (location) {
    slots.location = location;
    slots.locationDone = true;
  }
  if (duration) {
    slots.duration = duration;
    slots.durationDone = true;
  }
  if (reminderTime) {
    const parsed = parseReminderLead(String(reminderTime));
    if (parsed.valid) {
      slots.reminderLeadMinutes = parsed.leadMinutes;
      slots.reminderDone = true;
    }
  }
  return slots;
}

/**
 * Merge Alexa AddAppointment slot hints into classify slots when classify left gaps.
 * Never overwrite cleaned doctorName with raw AMAZON.Person.
 */
function mergeAlexaDateTimeHints(handlerInput, classified) {
  if (!classified || classified.action !== 'add_appointment') {
    return classified;
  }
  const slots = { ...(classified.slots || {}) };
  const envelope = handlerInput.requestEnvelope;
  const rawDate = Alexa.getSlotValue(envelope, 'Date');
  const rawTime = Alexa.getSlotValue(envelope, 'Time');

  if (!slots.date && rawDate) {
    const parsedDate = parseDateAnswer(rawDate);
    if (parsedDate?.date) slots.date = parsedDate.date;
  }
  if (!slots.time && rawTime) {
    if (/^\d{1,2}:\d{2}/.test(String(rawTime))) {
      slots.time = String(rawTime).slice(0, 5);
    } else {
      const parsedTime = parseTimeAnswer(rawTime);
      if (parsedTime?.time) slots.time = parsedTime.time;
    }
  }

  const seeded = seedSlotsFromAddIntent(handlerInput);

  // Prefer sanitized Alexa DoctorName when classify only kept the first token
  // (chrono often matches a single word after "doctor").
  if (seeded.doctorName) {
    if (!slots.doctorName) {
      slots.doctorName = seeded.doctorName;
    } else if (
      seeded.doctorName.toLowerCase().startsWith(slots.doctorName.toLowerCase()) &&
      seeded.doctorName.length > slots.doctorName.length
    ) {
      slots.doctorName = seeded.doctorName;
    }
  }
  if (!slots.date && seeded.date) slots.date = seeded.date;
  if (!slots.time && seeded.time) slots.time = seeded.time;

  // Optional add hints (Location / Duration / ReminderTime) — fill gaps only
  if (!slots.locationDone && seeded.locationDone) {
    slots.location = seeded.location;
    slots.locationDone = true;
  }
  if (!slots.durationDone && seeded.durationDone) {
    slots.duration = seeded.duration;
    slots.durationDone = true;
  }
  if (!slots.reminderDone && seeded.reminderDone) {
    slots.reminderLeadMinutes = seeded.reminderLeadMinutes;
    slots.reminderDone = true;
  }

  return { ...classified, slots };
}

async function applyActiveDialogue(handlerInput, utterance, dialogue) {
  if (dialogue.domain === 'appointment') {
    return applyAppointmentAnswer(handlerInput, utterance);
  }
  if (dialogue.domain === 'shopping' || dialogue.domain === 'todo') {
    return applyListAnswer(handlerInput, utterance);
  }
  if (dialogue.domain === 'ride') {
    return applyRideAnswer(handlerInput, utterance);
  }
  if (dialogue.domain === 'delete' || dialogue.domain === 'list') {
    return applyNavAnswer(handlerInput, dialogue, utterance);
  }
  if (dialogue.domain === 'reschedule') {
    return applyRescheduleAnswer(handlerInput, utterance);
  }
  if (dialogue.domain === 'help' && dialogue.step === 'awaiting_help_domain') {
    const domain =
      parseHelpDomain(utterance) ||
      parseHelpDomain(Alexa.getSlotValue(handlerInput.requestEnvelope, 'Domain'));
    if (!domain) {
      return {
        dialogue,
        done: false,
        prompt: {
          speak:
            'Please say one of these words: appointments, rides, shopping, or to-dos.',
          reprompt: prompts.OPEN_REPROMPT,
        },
        _helpMiss: true,
      };
    }
    return {
      dialogue: { domain: null, step: null, slots: {} },
      done: true,
      prompt: {
        speak: prompts.HELP_BY_DOMAIN[domain],
        reprompt: prompts.OPEN_REPROMPT,
      },
    };
  }
  return {
    dialogue: { domain: null, step: null, slots: {} },
    done: true,
    prompt: prompts.unclearIdle(),
  };
}

/** Structured fallback when classify returns null on messy intents. */
async function dispatchStructuredFallback(handlerInput, intentName, utterance, session) {
  if (intentName === 'AddAppointmentIntent') {
    const slots = seedSlotsFromAddIntent(handlerInput);
    const hasDoctor = !!slots.doctorName;
    const hasWhen = !!(slots.date || slots.time);
    const hasOther =
      !!slots.location || !!slots.durationDone || !!slots.reminderDone;
    // Idle bare date/time only → unclear (do not start add)
    if (!hasDoctor && hasWhen && !hasOther) {
      const p = prompts.unclearIdle();
      return respond(handlerInput, p.speak, p.reprompt, session);
    }
    // Idle ReminderTime/Duration/location without doctor → unclear (mid-flow carriers)
    if (!hasDoctor && !hasWhen && hasOther) {
      const p = prompts.unclearIdle();
      return respond(handlerInput, p.speak, p.reprompt, session);
    }
    // Bare add with no slots → start add (ask doctor)
    return dispatchClassified(
      handlerInput,
      { action: 'add_appointment', slots },
      session,
    );
  }

  if (intentName === 'DeleteAppointmentIntent') {
    const doctorName =
      sanitizeDoctorName(
        Alexa.getSlotValue(handlerInput.requestEnvelope, 'DoctorName'),
      ) || utterance;
    return dispatchClassified(
      handlerInput,
      { action: 'delete_appointment', slots: { doctorName, raw: utterance } },
      session,
    );
  }

  if (intentName === 'RescheduleAppointmentIntent') {
    const seeded = seedSlotsFromAddIntent(handlerInput);
    return dispatchClassified(
      handlerInput,
      {
        action: 'reschedule_appointment',
        slots: {
          doctorName:
            sanitizeDoctorName(
              Alexa.getSlotValue(handlerInput.requestEnvelope, 'DoctorName'),
            ) || seeded.doctorName || null,
          date: seeded.date || null,
          time: seeded.time || null,
        },
      },
      session,
    );
  }

  if (intentName === 'FindAppointmentByDoctorIntent') {
    return dispatchClassified(
      handlerInput,
      {
        action: 'find_by_doctor',
        slots: {
          doctorName: sanitizeDoctorName(
            Alexa.getSlotValue(handlerInput.requestEnvelope, 'DoctorName'),
          ),
        },
      },
      session,
    );
  }

  if (intentName === 'GetTodoListIntent') {
    return dispatchClassified(
      handlerInput,
      {
        action: 'get_todo',
        slots: {
          listName: Alexa.getSlotValue(handlerInput.requestEnvelope, 'ListName'),
        },
      },
      session,
    );
  }

  if (intentName === 'GetShoppingListIntent') {
    return dispatchClassified(
      handlerInput,
      {
        action: 'get_shopping',
        slots: {
          storeName: Alexa.getSlotValue(
            handlerInput.requestEnvelope,
            'StoreName',
          ),
        },
      },
      session,
    );
  }

  if (intentName === 'AddTodoListIntent') {
    return dispatchClassified(
      handlerInput,
      {
        action: 'add_todo',
        slots: {
          listName: Alexa.getSlotValue(handlerInput.requestEnvelope, 'ListName'),
          items: Alexa.getSlotValue(handlerInput.requestEnvelope, 'Items'),
        },
      },
      session,
    );
  }

  if (intentName === 'AddShoppingListIntent') {
    const items =
      Alexa.getSlotValue(handlerInput.requestEnvelope, 'Items') || '';
    const storeName = Alexa.getSlotValue(
      handlerInput.requestEnvelope,
      'StoreName',
    );
    const combined = `${items} ${utterance || ''}`.toLowerCase();
    if (/\b(appointments?|appoinments?|dr\.?|doctor|checkup)\b/.test(combined)) {
      return dispatchClassified(
        handlerInput,
        { action: 'add_appointment', slots: {} },
        session,
      );
    }
    return dispatchClassified(
      handlerInput,
      { action: 'add_shopping', slots: { storeName, items } },
      session,
    );
  }

  if (intentName === 'MarkTodoItemCompletedIntent') {
    return dispatchClassified(
      handlerInput,
      {
        action: 'mark_todo_done',
        slots: {
          listName: Alexa.getSlotValue(handlerInput.requestEnvelope, 'ListName'),
          itemName: Alexa.getSlotValue(handlerInput.requestEnvelope, 'ItemName'),
        },
      },
      session,
    );
  }

  if (intentName === 'MarkItemCompletedIntent') {
    return dispatchClassified(
      handlerInput,
      {
        action: 'mark_shopping_done',
        slots: {
          storeName: Alexa.getSlotValue(handlerInput.requestEnvelope, 'StoreName'),
          itemName: Alexa.getSlotValue(handlerInput.requestEnvelope, 'ItemName'),
        },
      },
      session,
    );
  }

  if (intentName === 'RemoveShoppingItemIntent') {
    return dispatchClassified(
      handlerInput,
      {
        action: 'remove_shopping_item',
        slots: {
          storeName: Alexa.getSlotValue(handlerInput.requestEnvelope, 'StoreName'),
          itemName: Alexa.getSlotValue(handlerInput.requestEnvelope, 'ItemName'),
        },
      },
      session,
    );
  }

  if (intentName === 'RemoveTodoItemIntent') {
    return dispatchClassified(
      handlerInput,
      {
        action: 'remove_todo_item',
        slots: {
          listName: Alexa.getSlotValue(handlerInput.requestEnvelope, 'ListName'),
          itemName: Alexa.getSlotValue(handlerInput.requestEnvelope, 'ItemName'),
        },
      },
      session,
    );
  }

  if (intentName === 'ClearShoppingCompletedIntent') {
    return dispatchClassified(
      handlerInput,
      {
        action: 'clear_shopping_completed',
        slots: {
          storeName: Alexa.getSlotValue(handlerInput.requestEnvelope, 'StoreName'),
        },
      },
      session,
    );
  }

  if (intentName === 'ClearTodoCompletedIntent') {
    return dispatchClassified(
      handlerInput,
      {
        action: 'clear_todo_completed',
        slots: {
          listName: Alexa.getSlotValue(handlerInput.requestEnvelope, 'ListName'),
        },
      },
      session,
    );
  }

  if (intentName === 'RequestRideToAppointmentIntent') {
    return dispatchClassified(
      handlerInput,
      { action: 'request_ride_appointment', slots: {} },
      session,
    );
  }

  if (intentName === 'RequestRideToLocationIntent') {
    return dispatchClassified(
      handlerInput,
      {
        action: 'request_ride_location',
        slots: {
          destination: Alexa.getSlotValue(
            handlerInput.requestEnvelope,
            'Destination',
          ),
        },
      },
      session,
    );
  }

  if (intentName === 'SetTransportInfoIntent') {
    return dispatchClassified(
      handlerInput,
      {
        action: 'set_transport',
        slots: {
          transportName: Alexa.getSlotValue(
            handlerInput.requestEnvelope,
            'TransportName',
          ),
          transportPhone:
            Alexa.getSlotValue(handlerInput.requestEnvelope, 'TransportPhone') ||
            Alexa.getSlotValue(handlerInput.requestEnvelope, 'PhoneNumber'),
        },
      },
      session,
    );
  }

  if (intentName === 'SetRiderPhoneIntent') {
    return dispatchClassified(
      handlerInput,
      {
        action: 'set_rider_phone',
        slots: {
          riderPhone:
            Alexa.getSlotValue(handlerInput.requestEnvelope, 'RiderPhone') ||
            Alexa.getSlotValue(handlerInput.requestEnvelope, 'PhoneNumber'),
        },
      },
      session,
    );
  }

  if (intentName === 'SetUserNameIntent') {
    const userName =
      parseNameAnswer(utterance) ||
      parseNameAnswer(
        `my name is ${Alexa.getSlotValue(handlerInput.requestEnvelope, 'UserName') || ''}`,
      );
    if (!userName) {
      return respond(
        handlerInput,
        'What name should I call you?',
        'Please tell me your name.',
        session,
      );
    }
    return dispatchClassified(
      handlerInput,
      { action: 'set_name', slots: { userName } },
      session,
    );
  }

  if (intentName === 'SetListVerbosityIntent') {
    const raw =
      Alexa.getSlotValue(handlerInput.requestEnvelope, 'Verbosity') || utterance;
    const verbosity =
      parseListVerbosityAnswer(raw) || parseListVerbosityAnswer(utterance);
    if (!verbosity) {
      return respond(
        handlerInput,
        'Would you like brief or detailed appointment lists?',
        'Say brief or detailed.',
        session,
      );
    }
    return dispatchClassified(
      handlerInput,
      { action: 'set_list_verbosity', slots: { verbosity } },
      session,
    );
  }

  if (intentName === 'HelpDomainIntent') {
    const domain =
      parseHelpDomain(Alexa.getSlotValue(handlerInput.requestEnvelope, 'Domain')) ||
      parseHelpDomain(utterance);
    if (!domain) {
      return dispatchClassified(handlerInput, { action: 'help_menu' }, session);
    }
    return dispatchClassified(
      handlerInput,
      { action: 'help_domain', slots: { domain } },
      session,
    );
  }

  return null;
}

async function dispatchCrispIdle(handlerInput, intentName, session) {
  if (intentName === 'AMAZON.HelpIntent') {
    return dispatchClassified(handlerInput, { action: 'help_menu' }, session);
  }
  if (intentName === 'AMAZON.YesIntent' || intentName === 'AMAZON.NoIntent') {
    const p = prompts.unclearIdle();
    return respond(handlerInput, p.speak, p.reprompt, session);
  }
  if (
    intentName === 'ReplaceConflictingAppointmentIntent' ||
    intentName === 'KeepBothAppointmentsIntent'
  ) {
    return respond(
      handlerInput,
      'There is no conflicting appointment waiting. What else can I help you with?',
      prompts.OPEN_REPROMPT,
      session,
    );
  }
  if (intentName === 'GetUserNameIntent') {
    return dispatchClassified(handlerInput, { action: 'get_name' }, session);
  }
  if (intentName === 'ClearUserNameIntent') {
    return dispatchClassified(handlerInput, { action: 'clear_name' }, session);
  }
  if (intentName === 'GetListVerbosityIntent') {
    return dispatchClassified(
      handlerInput,
      { action: 'get_list_verbosity' },
      session,
    );
  }
  if (intentName === 'GreetingIntent') {
    return dispatchClassified(handlerInput, { action: 'greeting' }, session);
  }
  if (intentName === 'GetUpcomingAppointmentsIntent') {
    return dispatchClassified(
      handlerInput,
      { action: 'list_appointments' },
      session,
    );
  }
  if (intentName === 'GetPastAppointmentsIntent') {
    return dispatchClassified(
      handlerInput,
      { action: 'list_past_appointments' },
      session,
    );
  }
  if (intentName === 'GetAllAppointmentsIntent') {
    return dispatchClassified(
      handlerInput,
      { action: 'list_all_appointments' },
      session,
    );
  }
  return null;
}

const DialogueTurnHandler = {
  canHandle(handlerInput) {
    if (Alexa.getRequestType(handlerInput.requestEnvelope) !== 'IntentRequest') {
      return false;
    }

    const intentName = Alexa.getIntentName(handlerInput.requestEnvelope);
    const session = handlerInput.attributesManager.getSessionAttributes();

    if (hasActiveStep(session)) {
      return true;
    }
    if (
      intentName === 'AMAZON.CancelIntent' ||
      intentName === 'AMAZON.StopIntent'
    ) {
      return false;
    }
    return true;
  },

  async handle(handlerInput) {
    let session = handlerInput.attributesManager.getSessionAttributes();
    const intentName = Alexa.getIntentName(handlerInput.requestEnvelope);
    const utterance = buildSpokenText(handlerInput);
    const dialogue = getDialogue(session);

    // --- Active dialogue ---
    if (dialogue.step) {
      if (
        intentName === 'AMAZON.CancelIntent' ||
        intentName === 'AMAZON.StopIntent' ||
        isCancelUtterance(utterance)
      ) {
        session = clearDialogue(session);
        const p = prompts.cancelledOpen();
        return respond(handlerInput, p.speak, p.reprompt, session);
      }

      if (
        intentName === 'AMAZON.HelpIntent' ||
        /^help\b/i.test(normalizeUtterance(utterance || ''))
      ) {
        const stepPrompt = await promptForActiveStep(handlerInput, dialogue);
        const p = prompts.contextualHelp(stepPrompt);
        return respond(handlerInput, p.speak, p.reprompt, session);
      }

      // Empty mid-flow (Fallback/Greeting with no text): coach once, then give up.
      const spoken = normalizeUtterance(utterance || '');
      if (!spoken) {
        const misses = (dialogue.emptyMissCount || 0) + 1;
        safeLog.info('empty_midflow_miss', {
          domain: dialogue.domain,
          step: dialogue.step,
          missCount: misses,
          intentName,
          budget: 'local',
        });
        if (misses >= 2) {
          session = clearDialogue(session);
          const p = prompts.emptyMidflowGiveUp();
          return respond(handlerInput, p.speak, p.reprompt, session);
        }
        session = setDialogue(session, {
          ...dialogue,
          emptyMissCount: misses,
        });
        const p = prompts.emptyMidflowCoach(dialogue);
        return respond(handlerInput, p.speak, p.reprompt, session);
      }

      const switchClassified = classifyIdleUtterance(utterance);
      if (shouldSwitchFromActiveDialogue(dialogue, switchClassified)) {
        session = clearDialogue(session);
        handlerInput.attributesManager.setSessionAttributes(session);
        return dispatchClassified(
          handlerInput,
          mergeAlexaDateTimeHints(handlerInput, switchClassified),
          session,
        );
      }

      const result = await applyActiveDialogue(handlerInput, utterance, dialogue);

      if (result._helpMiss && switchClassified) {
        session = clearDialogue(session);
        return dispatchClassified(
          handlerInput,
          mergeAlexaDateTimeHints(handlerInput, switchClassified),
          session,
        );
      }

      if (result.done) {
        session = clearDialogue(session);
      } else {
        const nextDialogue = { ...(result.dialogue || {}) };
        // Successful non-empty answer: clear empty-miss streak.
        delete nextDialogue.emptyMissCount;
        session = setDialogue(session, nextDialogue);
      }
      return respond(
        handlerInput,
        result.prompt.speak,
        result.prompt.reprompt,
        session,
        { permissionsToAsk: result.permissionsToAsk || null },
      );
    }

    // --- Idle: crisp intents bypass classify ---
    if (isCrispIdleIntent(intentName)) {
      const crisp = await dispatchCrispIdle(handlerInput, intentName, session);
      if (crisp) return crisp;
    }

    // --- Idle: messy intents — classify spoken text first ---
    const classified = classifyIdleUtterance(utterance);
    if (classified) {
      return dispatchClassified(
        handlerInput,
        mergeAlexaDateTimeHints(handlerInput, classified),
        session,
      );
    }

    const structured = await dispatchStructuredFallback(
      handlerInput,
      intentName,
      utterance,
      session,
    );
    if (structured) return structured;

    const p = prompts.unclearIdle();
    return respond(handlerInput, p.speak, p.reprompt, session);
  },
};

module.exports = {
  DialogueTurnHandler,
  buildSpokenText,
  mergeAlexaDateTimeHints,
  seedSlotsFromAddIntent,
};
