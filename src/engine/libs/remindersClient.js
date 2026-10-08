// src/engine/libs/remindersClient.js
// Appointment reminders as local phone notifications (replaces Alexa Reminders API).
// The app injects the notification scheduler via platform.configurePlatform().

const platform = require('../platform');
const safeLog = require('../log');

/** Kept for API parity; Tira asks for notification permission in-app instead. */
const REMINDERS_PERMISSION = 'notifications';

/**
 * @typedef {{ ok: boolean, alertToken?: string|null, reason?: 'unauthorized'|'error'|'skipped'|'past' }} ReminderResult
 * @typedef {{ ok: boolean, reason?: 'unauthorized'|'error'|'skipped'|'missing' }} CancelReminderResult
 */

let createImpl = defaultCreateAppointmentReminder;
let cancelImpl = defaultCancelAppointmentReminder;

function shouldSkipRemindersApi() {
  return false;
}

function formatLeadForSpeech(leadMinutes) {
  if (leadMinutes === 15) return '15 minutes';
  if (leadMinutes === 60) return '1 hour';
  if (leadMinutes === 1440) return '1 day';
  return `${leadMinutes} minutes`;
}

/**
 * Compute absolute fire time ISO from appointment dateTime and lead minutes.
 * @returns {string|null} ISO string, or null if fire time would be in the past
 */
function reminderFireTimeIso(appointmentDateTimeIso, leadMinutes) {
  const apptMs = new Date(appointmentDateTimeIso).getTime();
  if (Number.isNaN(apptMs)) return null;
  const fireMs = apptMs - leadMinutes * 60 * 1000;
  if (fireMs <= Date.now()) return null;
  return new Date(fireMs).toISOString();
}

/** @returns {Promise<ReminderResult>} */
async function defaultCreateAppointmentReminder({ scheduledTimeIso, doctorName, leadMinutes }) {
  try {
    const result = await platform.scheduleReminder({
      fireAtIso: scheduledTimeIso,
      title: `Appointment with ${doctorName || 'your doctor'}`,
      body: `Your appointment is in ${formatLeadForSpeech(leadMinutes)}.`,
    });
    if (result?.ok) return { ok: true, alertToken: result.id || null };
    return { ok: false, alertToken: null, reason: result?.reason || 'error' };
  } catch (e) {
    safeLog.warn('reminder_schedule_failed', {
      errorMessage: e?.message,
      errorName: e?.name,
    });
    return { ok: false, alertToken: null, reason: 'error' };
  }
}

/** @returns {Promise<CancelReminderResult>} */
async function defaultCancelAppointmentReminder({ alertToken }) {
  if (!alertToken) return { ok: false, reason: 'missing' };
  try {
    const result = await platform.cancelReminder({ id: alertToken });
    return result?.ok ? { ok: true } : { ok: false, reason: result?.reason || 'error' };
  } catch (e) {
    safeLog.warn('reminder_cancel_failed', {
      errorMessage: e?.message,
      errorName: e?.name,
    });
    return { ok: false, reason: 'error' };
  }
}

/** Create an appointment reminder (injectable for tests). */
function createAppointmentReminder(opts) {
  return createImpl(opts);
}

/** Cancel an appointment reminder by id (injectable for tests). */
function cancelAppointmentReminder(opts) {
  return cancelImpl(opts);
}

function setRemindersCreateFn(fn) {
  createImpl = typeof fn === 'function' ? fn : defaultCreateAppointmentReminder;
}

function setRemindersCancelFn(fn) {
  cancelImpl = typeof fn === 'function' ? fn : defaultCancelAppointmentReminder;
}

function resetRemindersCreateFn() {
  createImpl = defaultCreateAppointmentReminder;
}

function resetRemindersCancelFn() {
  cancelImpl = defaultCancelAppointmentReminder;
}

/**
 * Best-effort cancel for an appointment (or raw notification id). Never throws.
 * @returns {Promise<CancelReminderResult>}
 */
async function cancelReminderForAppointment(_handlerInput, appointmentOrToken) {
  const alertToken =
    typeof appointmentOrToken === 'string'
      ? appointmentOrToken
      : appointmentOrToken?.alexaReminderId || null;
  if (!alertToken) return { ok: false, reason: 'missing' };
  return cancelAppointmentReminder({ alertToken });
}

/**
 * After appointment save: schedule a notification; return speech suffix.
 * Never promises an alert unless scheduling succeeded.
 *
 * @returns {Promise<{ speakSuffix: string, permissionsToAsk: string[]|null, alexaReminderId: string|null }>}
 */
async function attachReminderAfterSave(_handlerInput, appointment, leadMinutes) {
  if (!leadMinutes) {
    return { speakSuffix: ' No reminder set.', permissionsToAsk: null, alexaReminderId: null };
  }

  const leadSpeech = formatLeadForSpeech(leadMinutes);
  const scheduledTimeIso = reminderFireTimeIso(appointment.dateTime, leadMinutes);
  if (!scheduledTimeIso) {
    return {
      speakSuffix: ` That is less than ${leadSpeech} away, so I did not set a reminder.`,
      permissionsToAsk: null,
      alexaReminderId: null,
    };
  }

  const result = await createAppointmentReminder({
    scheduledTimeIso,
    doctorName: appointment.doctorName,
    leadMinutes,
  });

  if (result.ok) {
    return {
      speakSuffix: ` I'll remind you ${leadSpeech} before.`,
      permissionsToAsk: null,
      alexaReminderId: result.alertToken || null,
    };
  }

  if (result.reason === 'unauthorized') {
    return {
      speakSuffix:
        ' I could not set a reminder because notifications are turned off for Tira. Turn them on in your phone settings, then add the appointment again if you still want an alert.',
      permissionsToAsk: [REMINDERS_PERMISSION],
      alexaReminderId: null,
    };
  }

  return {
    speakSuffix: ' I could not set a reminder on your phone. You can try again later, or say help.',
    permissionsToAsk: null,
    alexaReminderId: null,
  };
}

module.exports = {
  REMINDERS_PERMISSION,
  formatLeadForSpeech,
  reminderFireTimeIso,
  shouldSkipRemindersApi,
  createAppointmentReminder,
  cancelAppointmentReminder,
  cancelReminderForAppointment,
  setRemindersCreateFn,
  setRemindersCancelFn,
  resetRemindersCreateFn,
  resetRemindersCancelFn,
  attachReminderAfterSave,
  defaultCreateAppointmentReminder,
  defaultCancelAppointmentReminder,
};
