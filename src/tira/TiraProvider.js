// src/tira/TiraProvider.js
// Owns the Tira conversation: engine session, voice loop, and settings.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { configurePlatform, createTira, initStore, stripWakeWord } from '../engine';
import { devicePlatform, flushPendingCalls, storageAdapter } from './device';
import { recognizer, speak, stopSpeaking } from './voice';

const SETTINGS_KEY = 'tira.settings';
const DEFAULT_SETTINGS = {
  /** Keep listening for "Tira, …" while the app is open. */
  handsFree: false,
  /** Speak replies out loud. */
  speakReplies: true,
  speechRate: 1.0,
};

const TiraContext = createContext(null);

let messageSeq = 0;
function message(from, text) {
  messageSeq += 1;
  return { id: `${Date.now()}-${messageSeq}`, from, text };
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function TiraProvider({ children }) {
  const [ready, setReady] = useState(false);
  const [messages, setMessages] = useState([]);
  /** idle | listening | thinking | speaking */
  const [status, setStatus] = useState('idle');
  const [partial, setPartial] = useState('');
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [dataVersion, setDataVersion] = useState(0);
  const [voiceError, setVoiceError] = useState(null);

  const tiraRef = useRef(null);
  const settingsRef = useRef(DEFAULT_SETTINGS);
  const listenRef = useRef(null);
  /** Bumped to cancel any running listen loop. */
  const loopTokenRef = useRef(0);
  const appActiveRef = useRef(true);

  const voiceAvailable = recognizer.available;

  const addMessage = useCallback((from, text) => {
    if (!text) return;
    setMessages((prev) => [...prev, message(from, text)].slice(-200));
  }, []);

  const cancelListening = useCallback(() => {
    loopTokenRef.current += 1;
    listenRef.current?.abort();
    listenRef.current = null;
    setPartial('');
  }, []);

  /** Listen once; resolves '' on silence, null if cancelled. */
  const listen = useCallback(async (token) => {
    if (!recognizer.available) return null;
    setStatus('listening');
    setPartial('');
    const session = recognizer.listenOnce({ onPartial: setPartial });
    listenRef.current = session;
    try {
      const text = await session.promise;
      if (token !== loopTokenRef.current) return null;
      setVoiceError(null);
      return text;
    } catch (e) {
      if (token !== loopTokenRef.current) return null;
      setVoiceError(
        e?.code === 'not-allowed'
          ? 'Tira needs microphone and speech recognition permission. You can turn them on in your phone settings.'
          : `I had trouble hearing you (${e?.code || e?.message}).`,
      );
      if (e?.code === 'not-allowed') {
        settingsRef.current = { ...settingsRef.current, handsFree: false };
        setSettings(settingsRef.current);
      }
      return null;
    } finally {
      if (listenRef.current === session) listenRef.current = null;
      setPartial('');
      setStatus((s) => (s === 'listening' ? 'idle' : s));
    }
  }, []);

  const say = useCallback(async (text) => {
    if (!text || !settingsRef.current.speakReplies) return;
    setStatus('speaking');
    await speak(text, { rate: settingsRef.current.speechRate });
    setStatus((s) => (s === 'speaking' ? 'idle' : s));
  }, []);

  // Forward-declared so the voice loop and send() can call each other.
  const sendRef = useRef(null);

  /**
   * Hands-free: wait for an utterance that starts with the wake word.
   * Anything else is ignored (it wasn't meant for Tira).
   */
  const runWakeLoop = useCallback(async () => {
    const token = ++loopTokenRef.current;
    let failures = 0;
    while (
      token === loopTokenRef.current &&
      settingsRef.current.handsFree &&
      appActiveRef.current
    ) {
      const heard = await listen(token);
      if (token !== loopTokenRef.current) return;
      if (heard === null) {
        failures += 1;
        if (failures >= 3 || !settingsRef.current.handsFree) return;
        await wait(1500);
        continue;
      }
      failures = 0;
      if (!heard) continue;

      const { woke, text } = stripWakeWord(heard);
      if (!woke) continue;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      // Hand off to send(); it restarts listening when the turn is over.
      sendRef.current?.(text || heard, { viaVoice: true });
      return;
    }
  }, [listen]);

  /** After Tira replies: listen for the answer, or go back to wake-word mode. */
  const afterReply = useCallback(
    async (reply) => {
      if (!appActiveRef.current) return;
      const expectsAnswer =
        !reply.endSession && (tiraRef.current?.isMidDialogue() || /\?\s*$/.test(reply.speech));

      if (expectsAnswer && recognizer.available && settingsRef.current.speakReplies) {
        // Like Alexa keeping the mic open: no wake word needed for the answer.
        const token = ++loopTokenRef.current;
        const answer = await listen(token);
        if (token !== loopTokenRef.current) return;
        if (answer) {
          sendRef.current?.(answer, { viaVoice: true });
          return;
        }
      }
      if (settingsRef.current.handsFree) runWakeLoop();
    },
    [listen, runWakeLoop],
  );

  /** One user turn (typed or spoken). */
  const send = useCallback(
    async (rawText, opts = {}) => {
      const text = String(rawText || '').trim();
      if (!text || !tiraRef.current) return;
      cancelListening();
      stopSpeaking();
      addMessage('user', text);
      setStatus('thinking');

      let reply;
      try {
        reply = await tiraRef.current.turn(text);
      } catch (e) {
        reply = { speech: 'Sorry, something went wrong. Please try again.', endSession: false };
      }
      addMessage('tira', reply.speech);
      setDataVersion((v) => v + 1);
      setStatus('idle');

      await say(reply.speech);
      await flushPendingCalls();
      if (reply.endSession) tiraRef.current.reset();
      if (opts.viaVoice || settingsRef.current.handsFree) afterReply(reply);
    },
    [addMessage, afterReply, cancelListening, say],
  );
  sendRef.current = send;

  /** Mic button: listen once without needing the wake word. */
  const startListening = useCallback(async () => {
    stopSpeaking();
    cancelListening();
    const token = ++loopTokenRef.current;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const heard = await listen(token);
    if (token !== loopTokenRef.current) return;
    if (heard) {
      await send(heard, { viaVoice: true });
    } else if (heard === '' && settingsRef.current.handsFree) {
      runWakeLoop();
    }
  }, [cancelListening, listen, runWakeLoop, send]);

  /** Stop talking and listening right now. */
  const interrupt = useCallback(() => {
    cancelListening();
    stopSpeaking();
    setStatus('idle');
  }, [cancelListening]);

  const updateSettings = useCallback(
    (patch) => {
      const next = { ...settingsRef.current, ...patch };
      settingsRef.current = next;
      setSettings(next);
      AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(next)).catch(() => {});
      if ('handsFree' in patch) {
        if (patch.handsFree) runWakeLoop();
        else cancelListening();
      }
    },
    [cancelListening, runWakeLoop],
  );

  const refreshData = useCallback(() => setDataVersion((v) => v + 1), []);

  // Boot: storage → engine → greeting.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      configurePlatform(devicePlatform);
      await initStore(storageAdapter);
      try {
        const saved = JSON.parse((await AsyncStorage.getItem(SETTINGS_KEY)) || 'null');
        if (saved) {
          settingsRef.current = { ...DEFAULT_SETTINGS, ...saved };
          if (!recognizer.available) settingsRef.current.handsFree = false;
          setSettings(settingsRef.current);
        }
      } catch {
        /* keep defaults */
      }
      tiraRef.current = createTira({ userId: 'device-user' });
      const welcome = await tiraRef.current.launch();
      if (cancelled) return;
      setReady(true);
      addMessage('tira', welcome.speech);
      await say(welcome.speech);
      if (settingsRef.current.handsFree) runWakeLoop();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pause the mic when the app leaves the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      const active = state === 'active';
      appActiveRef.current = active;
      if (!active) {
        cancelListening();
        if (Platform.OS !== 'web') stopSpeaking();
      } else if (settingsRef.current.handsFree) {
        runWakeLoop();
      }
    });
    return () => sub.remove();
  }, [cancelListening, runWakeLoop]);

  const value = useMemo(
    () => ({
      ready,
      messages,
      status,
      partial,
      settings,
      dataVersion,
      voiceAvailable,
      voiceError,
      send,
      startListening,
      interrupt,
      updateSettings,
      refreshData,
      clearConversation: () => {
        tiraRef.current?.reset();
        setMessages([]);
      },
    }),
    [
      ready,
      messages,
      status,
      partial,
      settings,
      dataVersion,
      voiceAvailable,
      voiceError,
      send,
      startListening,
      interrupt,
      updateSettings,
      refreshData,
    ],
  );

  return <TiraContext.Provider value={value}>{children}</TiraContext.Provider>;
}

export function useTira() {
  const ctx = useContext(TiraContext);
  if (!ctx) throw new Error('useTira must be used inside <TiraProvider>');
  return ctx;
}
