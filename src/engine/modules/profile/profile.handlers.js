// Profile greeting helper used by dialogue/dispatch.
// Name get/set/clear intents route through DialogueTurnHandler.

const Alexa = require('../../ask');
const {
  getPersonalizedName,
  greetingForName,
} = require('./profile.service');
const safeLog = require('../../log');

function getUserId(requestEnvelope) {
  return (
    requestEnvelope.context?.System?.user?.userId ||
    requestEnvelope.session?.user?.userId
  );
}

const GreetingIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'GreetingIntent'
    );
  },

  async handle(handlerInput) {
    const userId = getUserId(handlerInput.requestEnvelope);
    let userName = null;

    try {
      userName = await getPersonalizedName(userId);
    } catch (error) {
      safeLog.error('profile_greeting_read_failed', {
        errorMessage: error?.message,
        errorName: error?.name,
      });
    }

    const speech = greetingForName(userName);
    return handlerInput.responseBuilder
      .speak(speech)
      .reprompt('How can I help you today?')
      .getResponse();
  },
};

module.exports = {
  GreetingIntentHandler,
};
