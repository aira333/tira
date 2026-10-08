// src/engine/ask.js
// Minimal stand-in for the parts of ask-sdk-core the Day Buddy engine uses.

function getRequestType(envelope) {
  return envelope?.request?.type;
}

function getIntentName(envelope) {
  return envelope?.request?.intent?.name;
}

function getSlotValue(envelope, slotName) {
  return envelope?.request?.intent?.slots?.[slotName]?.value;
}

/** Collects what a handler "says" into a plain response object. */
function createResponseBuilder() {
  const response = {
    speak: '',
    reprompt: '',
    shouldEndSession: false,
    permissionsToAsk: null,
  };
  const builder = {
    speak(text) {
      response.speak = text || '';
      return builder;
    },
    reprompt(text) {
      response.reprompt = text || '';
      return builder;
    },
    withShouldEndSession(value) {
      response.shouldEndSession = Boolean(value);
      return builder;
    },
    withAskForPermissionsConsentCard(scopes) {
      response.permissionsToAsk = scopes || null;
      return builder;
    },
    withSimpleCard() {
      return builder;
    },
    addDirective() {
      return builder;
    },
    getResponse() {
      return { ...response };
    },
  };
  return builder;
}

module.exports = {
  getRequestType,
  getIntentName,
  getSlotValue,
  createResponseBuilder,
};
