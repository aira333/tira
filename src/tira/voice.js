// src/tira/voice.js
// Speech in (expo-speech-recognition) and speech out (expo-speech).
//
// Speech recognition is a native module, so it is missing in Expo Go. In that
// case `recognizer.available` is false and the app falls back to typing, while
// Tira still talks back out loud.

import * as Speech from 'expo-speech';

import brand from '../engine/brand';

let SR = null;
try {
  // eslint-disable-next-line global-require
  SR = require('expo-speech-recognition').ExpoSpeechRecognitionModule;
} catch {
  SR = null;
}

function srAvailable() {
  try {
    return Boolean(SR && (typeof SR.isRecognitionAvailable !== 'function' || SR.isRecognitionAvailable()));
  } catch {
    return false;
  }
}

/**
 * Listen for one utterance.
 * Resolves with the final transcript ('' on silence / no match).
 * Rejects on permission or engine errors.
 *
 * @param {{ onPartial?: (text: string) => void }} [opts]
 * @returns {{ promise: Promise<string>, stop: () => void, abort: () => void }}
 */
function listenOnce(opts = {}) {
  let subs = [];
  let finalText = '';
  let latest = '';
  let settled = false;

  const cleanup = () => {
    subs.forEach((s) => s?.remove?.());
    subs = [];
  };

  const promise = new Promise((resolve, reject) => {
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };

    subs.push(
      SR.addListener('result', (event) => {
        const text = event?.results?.[0]?.transcript || '';
        latest = text;
        if (event?.isFinal) finalText = text;
        else opts.onPartial?.(text);
      }),
    );
    subs.push(
      SR.addListener('error', (event) => {
        const code = event?.error;
        // Silence and "no match" are normal outcomes, not failures.
        if (code === 'no-speech' || code === 'speech-timeout' || code === 'aborted') {
          finish(resolve, '');
          return;
        }
        const err = new Error(event?.message || code || 'speech error');
        err.code = code;
        finish(reject, err);
      }),
    );
    subs.push(SR.addListener('nomatch', () => finish(resolve, '')));
    subs.push(SR.addListener('end', () => finish(resolve, (finalText || latest).trim())));

    SR.requestPermissionsAsync()
      .then((perm) => {
        if (!perm?.granted) {
          const err = new Error('Microphone or speech permission was denied.');
          err.code = 'not-allowed';
          finish(reject, err);
          return;
        }
        SR.start({
          lang: 'en-US',
          interimResults: true,
          continuous: false,
          maxAlternatives: 1,
          addsPunctuation: false,
          // Bias the recognizer toward the wake word and domain words.
          contextualStrings: [
            brand.displayName,
            'appointment',
            'shopping list',
            'to do list',
            'reschedule',
            'ride',
          ],
          iosTaskHint: 'dictation',
        });
      })
      .catch((e) => finish(reject, e));
  });

  return {
    promise,
    stop: () => {
      try {
        SR.stop();
      } catch {
        /* already stopped */
      }
    },
    abort: () => {
      try {
        SR.abort();
      } catch {
        /* already stopped */
      }
    },
  };
}

export const recognizer = {
  get available() {
    return srAvailable();
  },
  listenOnce,
};

/**
 * Speak text; resolves when finished or interrupted.
 * @param {string} text
 * @param {{ rate?: number }} [opts]
 */
export function speak(text, opts = {}) {
  return new Promise((resolve) => {
    if (!text) {
      resolve();
      return;
    }
    Speech.stop();
    Speech.speak(text, {
      language: 'en-US',
      rate: opts.rate || 1.0,
      onDone: resolve,
      onStopped: resolve,
      onError: resolve,
    });
  });
}

export function stopSpeaking() {
  Speech.stop();
}
