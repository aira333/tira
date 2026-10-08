// apps/skill-backend/src/dialogue/dispatch.js
// Map classified idle actions → domain intent handlers

const Alexa = require('../ask');
const prompts = require('./prompts');
const {
  setPersonalizedName,
  getPersonalizedName,
  clearPersonalizedName,
  getListVerbosity,
  setListVerbosity,
  speechForNameQuery,
  speechForVerbosity,
  speechForVerbositySet,
} = require('../modules/profile/profile.service');
const {
  getUpcomingAppointments,
  findByDoctor,
  listPageSizeForVerbosity,
} = require('../modules/appointment/appointment.service');
const {
  prepareAppointmentDialogue,
  promptForStep,
  finishAppointment,
} = require('./appointmentFlow');
const {
  startShoppingAdd,
  startTodoAdd,
  startShoppingMark,
  startTodoMark,
  startShoppingRemove,
  startTodoRemove,
  startShoppingClear,
  startTodoClear,
  prepareAndMaybeFinish,
} = require('./listFlow');
const {
  startSetTransport,
  startSetRiderPhone,
  prepareRideToAppointment,
  prepareRideToLocation,
  prepareAndMaybeFinishRide,
} = require('./rideFlow');
const { setDialogue, clearDialogue } = require('./state');

function slot(name, value) {
  if (value === undefined || value === null || value === '') {
    return { name, confirmationStatus: 'NONE' };
  }
  return { name, value: String(value), confirmationStatus: 'NONE' };
}

function rewriteIntent(handlerInput, intentName, slots = {}) {
  const slotObjects = {};
  for (const [k, v] of Object.entries(slots)) {
    slotObjects[k] = slot(k, v);
  }
  handlerInput.requestEnvelope.request.intent = {
    name: intentName,
    confirmationStatus: 'NONE',
    slots: slotObjects,
  };
}

function getUserId(handlerInput) {
  const envelope = handlerInput.requestEnvelope;
  return (
    envelope.context?.System?.user?.userId ||
    envelope.session?.user?.userId
  );
}

/**
 * Dialog.ElicitSlot was tried for mid-flow Items fill, but Alexa ended the
 * session with reason ERROR on this skill (no dialog model). Do not re-add
 * without Console validation. Mid-flow relies on add {Items} carriers +
 * FreeForm "add {FreeForm} to my list" + Items/ItemName slot preference.
 */
function respond(handlerInput, speak, reprompt, sessionAttributes, options = {}) {
  handlerInput.attributesManager.setSessionAttributes(sessionAttributes || {});
  let builder = handlerInput.responseBuilder
    .speak(speak)
    .reprompt(reprompt || speak);
  if (options.permissionsToAsk && options.permissionsToAsk.length) {
    builder = builder.withAskForPermissionsConsentCard(options.permissionsToAsk);
  }
  return builder.getResponse();
}

/**
 * Legacy shopping/todo session elicit — retired; dialogue owns multi-turn.
 * Kept as no-op so older call sites do not break.
 */
async function continueListElicitation() {
  return null;
}

async function startListDialogue(handlerInput, session, startFn, slots) {
  const dialogue = startFn(slots);
  const result = await prepareAndMaybeFinish(handlerInput, dialogue);
  if (result.done) {
    session = clearDialogue(session);
    return respond(
      handlerInput,
      result.prompt.speak,
      result.prompt.reprompt,
      session,
    );
  }
  session = setDialogue(session, result.dialogue);
  return respond(
    handlerInput,
    result.prompt.speak,
    result.prompt.reprompt,
    session,
  );
}

async function startRideDialogue(handlerInput, session, dialogueOrPromise) {
  const dialogue = await dialogueOrPromise;
  const result = await prepareAndMaybeFinishRide(handlerInput, dialogue);
  if (result.done) {
    session = clearDialogue(session);
    return respond(
      handlerInput,
      result.prompt.speak,
      result.prompt.reprompt,
      session,
    );
  }
  session = setDialogue(session, result.dialogue);
  return respond(
    handlerInput,
    result.prompt.speak,
    result.prompt.reprompt,
    session,
  );
}

/**
 * Dispatch a classified action. Returns Alexa response.
 */
async function dispatchClassified(handlerInput, classified, session) {
  const action = classified.action;
  const slots = classified.slots || {};

  if (action === 'help_menu') {
    session = setDialogue(session, {
      domain: 'help',
      step: 'awaiting_help_domain',
      slots: {},
    });
    return respond(handlerInput, prompts.HELP_MENU, prompts.OPEN_REPROMPT, session);
  }

  if (action === 'help_domain') {
    return respond(
      handlerInput,
      prompts.HELP_BY_DOMAIN[slots.domain],
      prompts.OPEN_REPROMPT,
      session,
    );
  }

  if (action === 'set_name') {
    await setPersonalizedName(getUserId(handlerInput), slots.userName);
    return respond(
      handlerInput,
      `Nice to meet you, ${slots.userName}. I will remember your name on this phone.`,
      prompts.OPEN_REPROMPT,
      session,
    );
  }

  if (action === 'get_name') {
    const userName = await getPersonalizedName(getUserId(handlerInput));
    return respond(
      handlerInput,
      speechForNameQuery(userName),
      prompts.OPEN_REPROMPT,
      session,
    );
  }

  if (action === 'clear_name') {
    await clearPersonalizedName(getUserId(handlerInput));
    return respond(
      handlerInput,
      'Okay. I cleared your name. I will not use a personal greeting until you say call me, then your name. What else can I help you with?',
      prompts.OPEN_REPROMPT,
      session,
    );
  }

  if (action === 'set_list_verbosity') {
    const verbosity = slots.verbosity || 'detailed';
    await setListVerbosity(getUserId(handlerInput), verbosity);
    return respond(
      handlerInput,
      speechForVerbositySet(verbosity),
      prompts.OPEN_REPROMPT,
      session,
    );
  }

  if (action === 'get_list_verbosity') {
    const verbosity = await getListVerbosity(getUserId(handlerInput));
    return respond(
      handlerInput,
      `${speechForVerbosity(verbosity)} What else can I help you with?`,
      prompts.OPEN_REPROMPT,
      session,
    );
  }

  if (action === 'greeting') {
    const { GreetingIntentHandler } = require('../modules/profile/profile.handlers');
    rewriteIntent(handlerInput, 'GreetingIntent', {});
    return GreetingIntentHandler.handle(handlerInput);
  }

  if (action === 'add_appointment') {
    const dialogueStart = await prepareAppointmentDialogue(
      getUserId(handlerInput),
      slots,
    );
    if (dialogueStart.step === 'ready_to_save') {
      const result = await finishAppointment(handlerInput, dialogueStart);
      session = clearDialogue(session);
      return respond(
        handlerInput,
        result.prompt.speak,
        result.prompt.reprompt,
        session,
        { permissionsToAsk: result.permissionsToAsk || null },
      );
    }
    session = setDialogue(session, dialogueStart);
    const prompt = promptForStep(dialogueStart);
    return respond(handlerInput, prompt.speak, prompt.reprompt, session);
  }

  if (action === 'list_appointments') {
    const { presentAppointmentList } = require('./navFlow');
    const userId = getUserId(handlerInput);
    const verbosity = await getListVerbosity(userId);
    const appointments = await getUpcomingAppointments(userId);
    const result = presentAppointmentList(appointments, {
      listKind: 'upcoming',
      emptySpeak:
        'You have no upcoming appointments. What else can I help you with?',
      verbosity,
      pageSize: listPageSizeForVerbosity(verbosity),
    });
    if (result.done) {
      session = clearDialogue(session);
    } else {
      session = clearDialogue(session);
      session = setDialogue(session, result.dialogue);
    }
    return respond(
      handlerInput,
      result.prompt.speak,
      result.prompt.reprompt,
      session,
    );
  }

  if (action === 'list_past_appointments') {
    rewriteIntent(handlerInput, 'GetPastAppointmentsIntent', {});
    const { GetPastAppointmentsIntentHandler } = require('../modules/appointment/appointment.handlers');
    return GetPastAppointmentsIntentHandler.handle(handlerInput);
  }

  if (action === 'decline_recurring_appointment') {
    const p = prompts.weeklyDecline();
    return respond(handlerInput, p.speak, p.reprompt, session);
  }

  if (action === 'list_all_appointments') {
    rewriteIntent(handlerInput, 'GetAllAppointmentsIntent', {});
    const { GetAllAppointmentsIntentHandler } = require('../modules/appointment/appointment.handlers');
    return GetAllAppointmentsIntentHandler.handle(handlerInput);
  }

  if (action === 'find_by_doctor') {
    const doctorName = slots.doctorName;
    if (!doctorName) {
      return respond(
        handlerInput,
        'Which doctor would you like me to find?',
        'Please say the doctor name.',
        session,
      );
    }
    const { presentAppointmentList } = require('./navFlow');
    const userId = getUserId(handlerInput);
    const verbosity = await getListVerbosity(userId);
    const matches = await findByDoctor(userId, doctorName);
    const result = presentAppointmentList(matches, {
      listKind: 'matching',
      emptySpeak: `I couldn't find any appointments with ${doctorName}. What else can I help you with?`,
      verbosity,
      pageSize: listPageSizeForVerbosity(verbosity),
    });
    if (result.done) {
      session = clearDialogue(session);
    } else {
      session = clearDialogue(session);
      session = setDialogue(session, result.dialogue);
    }
    return respond(
      handlerInput,
      result.prompt.speak,
      result.prompt.reprompt,
      session,
    );
  }

  if (action === 'delete_appointment') {
    const { beginDeleteByDoctor, cleanDeleteDoctorName } = require('./navFlow');
    const doctorName =
      cleanDeleteDoctorName(slots.doctorName) ||
      cleanDeleteDoctorName(slots.raw) ||
      '';
    const result = await beginDeleteByDoctor(getUserId(handlerInput), doctorName);
    if (result.done) {
      session = clearDialogue(session);
      return respond(
        handlerInput,
        result.prompt.speak,
        result.prompt.reprompt,
        session,
      );
    }
    session = setDialogue(session, result.dialogue);
    return respond(
      handlerInput,
      result.prompt.speak,
      result.prompt.reprompt,
      session,
    );
  }

  if (action === 'reschedule_appointment') {
    const {
      prepareReschedule,
      prepareAndMaybeFinishReschedule,
    } = require('./rescheduleFlow');
    const dialogue = await prepareReschedule(getUserId(handlerInput), {
      doctorName: slots.doctorName || null,
      date: slots.date || null,
      time: slots.time || null,
    });
    const result = await prepareAndMaybeFinishReschedule(handlerInput, dialogue);
    if (result.done) {
      session = clearDialogue(session);
    } else {
      session = clearDialogue(session);
      session = setDialogue(session, result.dialogue);
    }
    return respond(
      handlerInput,
      result.prompt.speak,
      result.prompt.reprompt,
      session,
      { permissionsToAsk: result.permissionsToAsk || null },
    );
  }

  if (action === 'add_todo') {
    return startListDialogue(handlerInput, session, startTodoAdd, {
      listName: slots.listName || null,
      items: slots.items || null,
    });
  }

  if (action === 'get_todo') {
    const { presentGetTodo } = require('./listFlow');
    const result = await presentGetTodo(
      getUserId(handlerInput),
      slots.listName || null,
    );
    if (result.done) {
      session = clearDialogue(session);
    } else {
      session = clearDialogue(session);
      session = setDialogue(session, result.dialogue);
    }
    return respond(
      handlerInput,
      result.prompt.speak,
      result.prompt.reprompt,
      session,
    );
  }

  if (action === 'mark_todo_done') {
    return startListDialogue(handlerInput, session, startTodoMark, {
      listName: slots.listName || null,
      itemName: slots.itemName || null,
    });
  }

  if (action === 'add_shopping') {
    return startListDialogue(handlerInput, session, startShoppingAdd, {
      storeName: slots.storeName || null,
      items: slots.items || null,
    });
  }

  if (action === 'get_shopping') {
    const { presentGetShopping } = require('./listFlow');
    const result = await presentGetShopping(
      getUserId(handlerInput),
      slots.storeName || null,
    );
    if (result.done) {
      session = clearDialogue(session);
    } else {
      session = clearDialogue(session);
      session = setDialogue(session, result.dialogue);
    }
    return respond(
      handlerInput,
      result.prompt.speak,
      result.prompt.reprompt,
      session,
    );
  }

  if (action === 'mark_shopping_done') {
    return startListDialogue(handlerInput, session, startShoppingMark, {
      storeName: slots.storeName || null,
      itemName: slots.itemName || null,
    });
  }

  if (action === 'remove_todo_item') {
    return startListDialogue(handlerInput, session, startTodoRemove, {
      listName: slots.listName || null,
      itemName: slots.itemName || null,
    });
  }

  if (action === 'remove_shopping_item') {
    return startListDialogue(handlerInput, session, startShoppingRemove, {
      storeName: slots.storeName || null,
      itemName: slots.itemName || null,
    });
  }

  if (action === 'clear_todo_completed') {
    return startListDialogue(handlerInput, session, startTodoClear, {
      listName: slots.listName || null,
    });
  }

  if (action === 'clear_shopping_completed') {
    return startListDialogue(handlerInput, session, startShoppingClear, {
      storeName: slots.storeName || null,
    });
  }

  if (action === 'request_ride_appointment') {
    return startRideDialogue(
      handlerInput,
      session,
      prepareRideToAppointment(getUserId(handlerInput), {
        doctorName: slots.doctorName || null,
        pickupTime: slots.pickupTime || null,
      }),
    );
  }

  if (action === 'request_ride_location') {
    return startRideDialogue(
      handlerInput,
      session,
      prepareRideToLocation(getUserId(handlerInput), {
        destination: slots.destination || null,
        pickupDate: slots.pickupDate || null,
        pickupTime: slots.pickupTime || null,
      }),
    );
  }

  if (action === 'set_transport') {
    return startRideDialogue(
      handlerInput,
      session,
      startSetTransport({
        transportName: slots.transportName || null,
        transportPhone: slots.transportPhone || null,
      }),
    );
  }

  if (action === 'set_rider_phone') {
    return startRideDialogue(
      handlerInput,
      session,
      startSetRiderPhone({ riderPhone: slots.riderPhone || null }),
    );
  }

  const p = prompts.unclearIdle();
  return respond(handlerInput, p.speak, p.reprompt, session);
}

module.exports = {
  dispatchClassified,
  continueListElicitation,
  rewriteIntent,
  respond,
  getUserId,
};
