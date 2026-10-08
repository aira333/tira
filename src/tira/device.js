// src/tira/device.js
// Phone capabilities for the Tira engine: storage, reminders, and calls.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';

const REMINDER_CHANNEL = 'appointment-reminders';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/** Key-value adapter the engine store persists through. */
export const storageAdapter = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
};

async function ensureNotificationPermission() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL, {
      name: 'Appointment reminders',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    });
  }
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const asked = await Notifications.requestPermissionsAsync();
  return Boolean(asked.granted);
}

async function scheduleReminder({ fireAtIso, title, body }) {
  if (Platform.OS === 'web') return { ok: false, reason: 'skipped' };
  const allowed = await ensureNotificationPermission();
  if (!allowed) return { ok: false, reason: 'unauthorized' };
  const id = await Notifications.scheduleNotificationAsync({
    content: { title, body, sound: true },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: new Date(fireAtIso),
      channelId: REMINDER_CHANNEL,
    },
  });
  return { ok: true, id };
}

async function cancelReminder({ id }) {
  if (!id || Platform.OS === 'web') return { ok: false, reason: 'missing' };
  await Notifications.cancelScheduledNotificationAsync(id);
  return { ok: true };
}

/**
 * Calls are queued rather than dialed immediately, so Tira can finish
 * speaking ("Calling City Rides now…") before the dialer takes over.
 */
const pendingCalls = [];

async function placeCall({ phone }) {
  if (!phone) return { ok: false };
  const url = `tel:${phone}`;
  if (Platform.OS !== 'web') {
    const supported = await Linking.canOpenURL(url).catch(() => false);
    if (!supported) return { ok: false };
  }
  pendingCalls.push(url);
  return { ok: true };
}

/** Open the dialer for any call queued during the last turn. */
export async function flushPendingCalls() {
  while (pendingCalls.length) {
    const url = pendingCalls.shift();
    try {
      await Linking.openURL(url);
    } catch {
      // Dialer unavailable (simulator / tablet) — speech already explained.
    }
  }
}

export function hasPendingCall() {
  return pendingCalls.length > 0;
}

export async function cancelAllReminders() {
  if (Platform.OS === 'web') return;
  await Notifications.cancelAllScheduledNotificationsAsync();
}

export const devicePlatform = {
  placeCall,
  scheduleReminder,
  cancelReminder,
};
