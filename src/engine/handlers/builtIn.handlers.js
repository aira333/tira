// apps/skill-backend/src/handlers/builtIn.handlers.js
// Launch / idle Cancel-Stop / SessionEnded / Error
// Help, Fallback, and all feature intents → DialogueTurnHandler

const Alexa = require('../ask');
const brand = require('../brand');
const { getPersonalizedName } = require('../modules/profile/profile.service');
const dialoguePrompts = require('../dialogue/prompts');
const safeLog = require('../log');

const HELP_MENU_REPROMPT = dialoguePrompts.OPEN_REPROMPT;

function getUserId(requestEnvelope) {
  return (
    requestEnvelope.context?.System?.user?.userId ||
    requestEnvelope.session?.user?.userId
  );
}

/**
 * LaunchRequestHandler - Skill opening
 */
const LaunchRequestHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
  },

  async handle(handlerInput) {
    const userId = getUserId(handlerInput.requestEnvelope);
    let userName = null;

    try {
      userName = await getPersonalizedName(userId);
    } catch (error) {
      // Soft-fail Launch (U0 NFR): never block greeting on profile read.
      safeLog.error('launch_profile_read_failed', {
        errorMessage: error?.message,
        errorName: error?.name,
      });
    }

    const speakOutput = userName
      ? `Hi ${userName}. Welcome back to ${brand.displayName}. I can help with appointments, rides, shopping lists, or to-dos. Say what you need, or say help for examples.`
      : `Welcome to ${brand.displayName}. I can help with appointments, rides, shopping lists, or to-dos. Say what you need, or say help for examples. To hear your name in greetings, say: my name is, then your name.`;

    return handlerInput.responseBuilder
      .speak(speakOutput)
      .reprompt(HELP_MENU_REPROMPT)
      .getResponse();
  },
};

/**
 * CancelAndStopIntentHandler — idle session exit only
 * (active dialogue Cancel/Stop is handled by DialogueTurnHandler)
 */
const CancelAndStopIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.CancelIntent' ||
        Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.StopIntent')
    );
  },

  handle(handlerInput) {
    // Idle Cancel/Stop: end session (U0 BR-U0-06).
    return handlerInput.responseBuilder
      .speak('Goodbye!')
      .withShouldEndSession(true)
      .getResponse();
  },
};

/**
 * SessionEndedRequestHandler
 */
const SessionEndedRequestHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'SessionEndedRequest';
  },

  handle(handlerInput) {
    safeLog.info('session_ended', {
      reason: handlerInput.requestEnvelope.request.reason,
    });
    return handlerInput.responseBuilder.getResponse();
  },
};

/**
 * ErrorHandler
 */
const ErrorHandler = {
  canHandle() {
    return true;
  },

  handle(handlerInput, error) {
    const requestId = handlerInput.requestEnvelope?.request?.requestId || 'unknown';
    const intentName =
      handlerInput.requestEnvelope?.request?.intent?.name ||
      handlerInput.requestEnvelope?.request?.type ||
      'unknown';

    safeLog.error('skill_error', {
      requestId,
      intentName,
      errorMessage: error?.message,
      errorName: error?.name,
    });

    return handlerInput.responseBuilder
      .speak('Sorry, I encountered an error. Please try again.')
      .reprompt(HELP_MENU_REPROMPT)
      .getResponse();
  },
};

module.exports = {
  LaunchRequestHandler,
  CancelAndStopIntentHandler,
  SessionEndedRequestHandler,
  ErrorHandler,
};
