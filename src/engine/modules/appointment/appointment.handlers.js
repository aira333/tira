// Appointment list helpers used by dialogue/dispatch (past / all).
// Add / delete / conflict / upcoming / find / FreeForm live in dialogue/.

const Alexa = require('../../ask');
const { respondWithAppointmentList } = require('../../dialogue/navFlow');
const prompts = require('../../dialogue/prompts');
const {
  getUpcomingAppointments,
  getPastAppointments,
} = require('./appointment.service');
const safeLog = require('../../log');

const GetPastAppointmentsIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) ===
        'GetPastAppointmentsIntent'
    );
  },
  async handle(handlerInput) {
    const userId = handlerInput.requestEnvelope.context.System.user.userId;
    try {
      const past = await getPastAppointments(userId);
      return respondWithAppointmentList(handlerInput, past, {
        listKind: 'past',
        emptySpeak:
          'You have no past appointments. What else can I help you with?',
      });
    } catch (error) {
      safeLog.error('past_appointments_error', {
        errorMessage: error?.message,
        errorName: error?.name,
      });
      return handlerInput.responseBuilder
        .speak(
          'I could not load past appointments. Please try again in a moment. What else can I help you with?',
        )
        .reprompt(prompts.OPEN_REPROMPT)
        .getResponse();
    }
  },
};

const GetAllAppointmentsIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) ===
        'GetAllAppointmentsIntent'
    );
  },
  async handle(handlerInput) {
    const userId = handlerInput.requestEnvelope.context.System.user.userId;
    try {
      const upcoming = await getUpcomingAppointments(userId);
      const past = await getPastAppointments(userId);
      return respondWithAppointmentList(handlerInput, [...upcoming, ...past], {
        listKind: 'total',
        emptySpeak: 'You have no appointments. What else can I help you with?',
      });
    } catch (error) {
      safeLog.error('all_appointments_error', {
        errorMessage: error?.message,
        errorName: error?.name,
      });
      return handlerInput.responseBuilder
        .speak(
          'I could not load your appointments. Please try again in a moment. What else can I help you with?',
        )
        .reprompt(prompts.OPEN_REPROMPT)
        .getResponse();
    }
  },
};

module.exports = {
  GetPastAppointmentsIntentHandler,
  GetAllAppointmentsIntentHandler,
};
