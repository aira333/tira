// src/engine/index.js
// Tira runtime: text in → speech out, using the Day Buddy dialogue engine.
//
// Alexa used to pick an intent and fill slots before our code ran. Tira gets
// the raw transcript instead, so every turn arrives as FreeForm text (which the
// engine already treats as the source of truth) plus a few crisp built-ins.

const ask = require('./ask');
const brand = require('./brand');
const store = require('./store');
const { configurePlatform } = require('./platform');
const { DialogueTurnHandler } = require('./dialogue');
const {
  LaunchRequestHandler,
  CancelAndStopIntentHandler,
  ErrorHandler,
} = require('./handlers/builtIn.handlers');

const FREEFORM_INTENT = 'FreeFormAppointmentIntent';

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const WAKE_WORDS = [brand.invocationName, ...(brand.wakeWordVariants || [])];
const WAKE_RE = new RegExp(
  `^\\s*(?:(?:hey|hi|ok|okay|hello)\\s+)?(?:${WAKE_WORDS.map(escapeRegExp).join('|')})\\b[\\s,.!?:;-]*`,
  'i',
);

/**
 * Split an utterance into { woke, text } — `woke` is true when it started with
 * the wake word ("Tira, add milk" → { woke: true, text: "add milk" }).
 */
function stripWakeWord(utterance) {
  const raw = String(utterance || '').trim();
  const m = raw.match(WAKE_RE);
  if (!m) return { woke: false, text: raw };
  return { woke: true, text: raw.slice(m[0].length).trim() };
}

const STOP_RE = /^(stop|cancel|never ?mind|goodbye|good bye|bye|exit|quit|that'?s all|that is all|i'?m done)[.!]*$/i;
const HELP_RE = /^(help|help me|what can you do|what can i say)[.!?]*$/i;
const YES_RE = /^(yes|yeah|yep|yup|sure|correct|right|ok|okay|please do|do it)[.!]*$/i;
const NO_RE = /^(no|nope|nah|no thanks|no thank you)[.!]*$/i;

function intentForText(text) {
  if (STOP_RE.test(text)) return /^cancel|never/i.test(text) ? 'AMAZON.CancelIntent' : 'AMAZON.StopIntent';
  if (HELP_RE.test(text)) return 'AMAZON.HelpIntent';
  if (YES_RE.test(text)) return 'AMAZON.YesIntent';
  if (NO_RE.test(text)) return 'AMAZON.NoIntent';
  return FREEFORM_INTENT;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Alexa read "2026-09-28" and "14:00" naturally; phone TTS does not.
 * Rewrite ISO dates and 24-hour clock times into spoken form.
 */
function humanizeDatesAndTimes(text) {
  return text
    .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (match, y, m, d) => {
      const date = new Date(Number(y), Number(m) - 1, Number(d));
      if (Number.isNaN(date.getTime())) return match;
      const sameYear = date.getFullYear() === new Date().getFullYear();
      const base = `${WEEKDAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}`;
      return sameYear ? base : `${base}, ${date.getFullYear()}`;
    })
    .replace(/\b([01]?\d|2[0-3]):([0-5]\d)\b(?!\s*(?:a\.?m\.?|p\.?m\.?)\b)/gi, (match, h, mm) => {
      const hour = Number(h);
      const suffix = hour >= 12 ? 'PM' : 'AM';
      const h12 = hour % 12 === 0 ? 12 : hour % 12;
      return mm === '00' ? `${h12} ${suffix}` : `${h12}:${mm} ${suffix}`;
    });
}

/** Plain text for TTS / chat bubbles (drop SSML tags). */
function toPlainSpeech(ssmlOrText) {
  const plain = String(ssmlOrText || '')
    .replace(/<break[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  return humanizeDatesAndTimes(plain)
    .replace(/\bAlexa\b/g, 'Tira')
    .replace(/\.{2,}(?=\s|$)/g, '.');
}

let requestCounter = 0;

function buildHandlerInput(envelope, sessionRef) {
  return {
    requestEnvelope: envelope,
    attributesManager: {
      getSessionAttributes: () => sessionRef.attributes,
      setSessionAttributes: (attrs) => {
        sessionRef.attributes = attrs || {};
      },
    },
    responseBuilder: ask.createResponseBuilder(),
    serviceClientFactory: null,
  };
}

/**
 * Create a Tira conversation for one device user.
 *
 * @param {{ userId?: string, locale?: string }} [opts]
 */
function createTira(opts = {}) {
  const userId = opts.userId || 'tira-device-user';
  const locale = opts.locale || 'en-US';
  const sessionRef = { attributes: {} };

  function envelope(request) {
    requestCounter += 1;
    return {
      version: '1.0',
      session: { new: false, user: { userId }, attributes: sessionRef.attributes },
      context: {
        System: {
          user: { userId },
          apiAccessToken: 'device',
          apiEndpoint: 'device://tira',
        },
      },
      request: {
        requestId: `tira.${Date.now()}.${requestCounter}`,
        timestamp: new Date().toISOString(),
        locale,
        ...request,
      },
    };
  }

  async function run(handler, request) {
    const env = envelope(request);
    const input = buildHandlerInput(env, sessionRef);
    let response;
    try {
      response = await handler.handle(input);
    } catch (error) {
      response = await ErrorHandler.handle(buildHandlerInput(env, sessionRef), error);
    }
    if (response.shouldEndSession) sessionRef.attributes = {};
    return {
      speech: toPlainSpeech(response.speak),
      reprompt: toPlainSpeech(response.reprompt),
      endSession: Boolean(response.shouldEndSession),
      needsNotificationPermission: Boolean(response.permissionsToAsk?.length),
    };
  }

  /** Open Tira (like "Alexa, open …"). */
  async function launch() {
    sessionRef.attributes = {};
    return run(LaunchRequestHandler, { type: 'LaunchRequest' });
  }

  /**
   * One user turn. Accepts text with or without the wake word.
   * @param {string} utterance
   */
  async function turn(utterance) {
    const { text } = stripWakeWord(utterance);
    if (!text) {
      return {
        speech: `Yes? I'm listening.`,
        reprompt: 'What would you like to do?',
        endSession: false,
        needsNotificationPermission: false,
      };
    }

    const intentName = intentForText(text);
    const request = {
      type: 'IntentRequest',
      dialogState: 'COMPLETED',
      intent: {
        name: intentName,
        confirmationStatus: 'NONE',
        slots:
          intentName === FREEFORM_INTENT
            ? { FreeForm: { name: 'FreeForm', value: text, confirmationStatus: 'NONE' } }
            : {},
      },
    };

    const env = envelope(request);
    const probe = buildHandlerInput(env, sessionRef);
    if (DialogueTurnHandler.canHandle(probe)) {
      return run(DialogueTurnHandler, request);
    }
    return run(CancelAndStopIntentHandler, request);
  }

  /** Forget in-progress dialogue (e.g. user closed the conversation). */
  function reset() {
    sessionRef.attributes = {};
  }

  function isMidDialogue() {
    return Boolean(sessionRef.attributes?.dialogue?.step);
  }

  return { launch, turn, reset, isMidDialogue, userId };
}

module.exports = {
  createTira,
  stripWakeWord,
  toPlainSpeech,
  initStore: store.initStore,
  clearAllData: store.clearAll,
  configurePlatform,
  brand,
  store,
};
