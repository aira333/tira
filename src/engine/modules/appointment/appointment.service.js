// apps/skill-backend/src/modules/appointment/appointment.service.js
// Appointment Business Logic Service
// Appointment business logic

const {
  saveAppointment,
  getAppointments,
  queryAppointmentsByDateRange,
  deleteAppointment: dbDeleteAppointment,
  toLogicalAppointmentId,
} = require('../../store');
const { parseDate, smartParseDateTime } = require('../../smart-logic/smartDateParser');
const {
  formatDateForSpeech,
  formatTimeForSpeech,
} = require('../../libs/speechFormat');
const safeLog = require('../../log');

const DEFAULT_DURATION_MINUTES = 60;
const MAX_DURATION_MINUTES = 480; // 8 hours cap
const MAX_LOCATION_CHARS = 120;
const LIST_PAGE_SIZE = 3;
/** Brief list mode: more items per page, shorter each line. */
const BRIEF_LIST_PAGE_SIZE = 5;

function listPageSizeForVerbosity(verbosity) {
  return String(verbosity || '').toLowerCase() === 'brief'
    ? BRIEF_LIST_PAGE_SIZE
    : LIST_PAGE_SIZE;
}

function sameAppointmentId(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  return toLogicalAppointmentId(a) === toLogicalAppointmentId(b);
}

/**
 * Parse a natural-language duration string into minutes.
 * Returns DEFAULT_DURATION_MINUTES for empty/invalid/negative input.
 * Caps at MAX_DURATION_MINUTES for excessively large values.
 *
 * @param {string|null} input - e.g. "30 minutes", "2 hours", "default"
 * @returns {{ minutes: number, capped: boolean, usedDefault: boolean }}
 */
function parseDurationFromSpeech(input) {
  if (!input || typeof input !== 'string') {
    return { minutes: DEFAULT_DURATION_MINUTES, capped: false, usedDefault: true };
  }

  const raw = input.trim().toLowerCase();

  // Alexa AMAZON.DURATION may be alone or embedded ("for PT1H35M")
  const isoMatch = raw.match(
    /\bp(?:(\d+(?:\.\d+)?)d)?(?:t(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?)?\b/i,
  );
  if (isoMatch && (isoMatch[1] || isoMatch[2] || isoMatch[3] || isoMatch[4])) {
    const days = parseFloat(isoMatch[1] || '0');
    const hours = parseFloat(isoMatch[2] || '0');
    const minutes = parseFloat(isoMatch[3] || '0');
    const seconds = parseFloat(isoMatch[4] || '0');
    const totalMinutes = Math.round(days * 24 * 60 + hours * 60 + minutes + seconds / 60);
    if (totalMinutes > MAX_DURATION_MINUTES) {
      return { minutes: MAX_DURATION_MINUTES, capped: true, usedDefault: false };
    }
    if (totalMinutes > 0) {
      return { minutes: totalMinutes, capped: false, usedDefault: false };
    }
  }

  // Explicit defaults
  if (!raw || ['default', 'use default', 'one hour', '1 hour', 'an hour'].includes(raw)) {
    return { minutes: DEFAULT_DURATION_MINUTES, capped: false, usedDefault: raw !== 'one hour' && raw !== '1 hour' && raw !== 'an hour' };
  }

  let totalMinutes = null;

  // "half an hour" / "half hour"
  if (/half.*(hour|hr)/.test(raw)) {
    totalMinutes = 30;
  }
  // "an hour and a half" / "1.5 hours" / "one and a half hours"
  else if (/(?:an? hour and a half|1\.5 hours?|one and a half hours?)/.test(raw)) {
    totalMinutes = 90;
  }
  // "X hours and Y minutes" e.g. "1 hour and 30 minutes"
  else if (/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\s*(?:and\s*)?(\d+)\s*(?:minutes?|mins?)/.test(raw)) {
    const m = raw.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\s*(?:and\s*)?(\d+)\s*(?:minutes?|mins?)/);
    totalMinutes = Math.round(parseFloat(m[1]) * 60) + parseInt(m[2], 10);
  }
  // "X.Y hours"
  else if (/(\d+\.\d+)\s*(?:hours?|hrs?)/.test(raw)) {
    const m = raw.match(/(\d+\.\d+)\s*(?:hours?|hrs?)/);
    totalMinutes = Math.round(parseFloat(m[1]) * 60);
  }
  // "X hours"
  else if (/(\d+)\s*(?:hours?|hrs?)/.test(raw)) {
    const m = raw.match(/(\d+)\s*(?:hours?|hrs?)/);
    totalMinutes = parseInt(m[1], 10) * 60;
  }
  // "X minutes"
  else if (/(\d+)\s*(?:minutes?|mins?)/.test(raw)) {
    const m = raw.match(/(\d+)\s*(?:minutes?|mins?)/);
    totalMinutes = parseInt(m[1], 10);
  }
  // Bare number (assume minutes)
  else if (/^(\d+)$/.test(raw)) {
    totalMinutes = parseInt(raw, 10);
  }

  // Invalid / negative / still null
  if (totalMinutes === null || totalMinutes <= 0 || isNaN(totalMinutes)) {
    return { minutes: DEFAULT_DURATION_MINUTES, capped: false, usedDefault: true };
  }

  // Cap at max
  if (totalMinutes > MAX_DURATION_MINUTES) {
    return { minutes: MAX_DURATION_MINUTES, capped: true, usedDefault: false };
  }

  return { minutes: totalMinutes, capped: false, usedDefault: false };
}

/**
 * Format duration in minutes to human-readable speech string.
 * e.g. 60 -> "1 hour", 90 -> "1 hour and 30 minutes", 30 -> "30 minutes"
 *
 * @param {number} minutes
 * @returns {string}
 */
function formatDurationForSpeech(minutes) {
  if (!minutes || minutes <= 0) return '1 hour';
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hrs > 0 && mins > 0) return `${hrs} ${hrs === 1 ? 'hour' : 'hours'} and ${mins} ${mins === 1 ? 'minute' : 'minutes'}`;
  if (hrs > 0) return `${hrs} ${hrs === 1 ? 'hour' : 'hours'}`;
  return `${mins} ${mins === 1 ? 'minute' : 'minutes'}`;
}

/**
 * Create a new appointment
 * 
 * @param {string} userId - User's Alexa ID
 * @param {Object} appointmentData - Appointment details
 * @returns {Promise<Object>} Created appointment
 */
async function createAppointment(userId, appointmentData) {
  const {
    doctorName,
    date,
    time,
    location,
    notes,
    duration,
    reminderLeadMinutes = null,
    alexaReminderId = null,
  } = appointmentData;
  const { minutes: durationMinutes } = parseDurationFromSpeech(duration || null);
  
  // Generate unique ID
  const appointmentId = `apt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  
  // Parse date
  let parsedDate;
  try {
    parsedDate = await smartParseDateTime(date, time);
    if (!parsedDate) {
      parsedDate = parseDate(date);
    }
  } catch (error) {
    safeLog.error('date_parse_failed', {
      errorMessage: error?.message,
      errorName: error?.name,
    });
    parsedDate = new Date(date); // Fallback
  }
  
  const locationRaw = location || 'Not specified';
  const locationCapped =
    String(locationRaw).length > MAX_LOCATION_CHARS
      ? String(locationRaw).slice(0, MAX_LOCATION_CHARS).trim()
      : locationRaw;

  const appointment = {
    appointmentId,
    doctorName,
    date,
    time,
    dateTime: parsedDate ? parsedDate.toISOString() : new Date().toISOString(),
    location: locationCapped,
    notes: notes || '',
    reminderLeadMinutes:
      reminderLeadMinutes === undefined || reminderLeadMinutes === null
        ? null
        : Number(reminderLeadMinutes),
    alexaReminderId: alexaReminderId || null,
    durationMinutes,
  };

  const { appointmentId: storedId } = await saveAppointment(userId, appointment);

  return { ...appointment, appointmentId: storedId };
}

/**
 * Get all upcoming appointments for a user
 * 
 * @param {string} userId - User's Alexa ID
 * @returns {Promise<Array>} List of appointments
 */
async function getUpcomingAppointments(userId) {
  const nowIso = new Date().toISOString();
  return queryAppointmentsByDateRange(userId, {
    fromIso: nowIso,
    ascending: true,
  });
}

/**
 * Past appointments (before now), newest first.
 */
async function getPastAppointments(userId) {
  const nowIso = new Date().toISOString();
  return queryAppointmentsByDateRange(userId, {
    toIso: nowIso,
    ascending: false,
  });
}

/**
 * Load one appointment by id (logical or storage form).
 * @returns {Promise<object|null>}
 */
async function getAppointmentById(userId, appointmentId) {
  if (!appointmentId) return null;
  const appointments = await getAppointments(userId);
  return appointments.find((apt) => sameAppointmentId(apt.appointmentId, appointmentId)) || null;
}

/**
 * Load appointments by ids, preserving input order. Missing ids are dropped.
 * @param {string} userId
 * @param {string[]} ids
 * @returns {Promise<object[]>}
 */
async function getAppointmentsByIds(userId, ids = []) {
  const ordered = (ids || []).filter(Boolean);
  if (!ordered.length) return [];
  const appointments = await getAppointments(userId);
  const byLogical = new Map();
  for (const apt of appointments) {
    byLogical.set(toLogicalAppointmentId(apt.appointmentId), apt);
  }
  const out = [];
  for (const id of ordered) {
    const apt = byLogical.get(toLogicalAppointmentId(id));
    if (apt) out.push(apt);
  }
  return out;
}

/**
 * Find appointments by doctor name
 * 
 * @param {string} userId - User's Alexa ID
 * @param {string} doctorName - Doctor's name (partial match supported)
 * @returns {Promise<Array>} Matching appointments
 */
async function findByDoctor(userId, doctorName) {
  const searchName = String(doctorName || '').trim().toLowerCase();
  if (!searchName) {
    return [];
  }

  const appointments = await getAppointments(userId);
  return appointments
    .filter(apt => String(apt.doctorName || '').toLowerCase().includes(searchName))
    .sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));
}

/**
 * Resolve an appointment's start Date from date+time fields (preferred) or dateTime.
 * Preferring date+time keeps conflict math aligned with spoken Alexa slots.
 * @returns {Date|null}
 */
function resolveAppointmentStart(apt) {
  if (!apt) return null;
  if (apt.date && apt.time) {
    const time = String(apt.time).trim();
    let isoTime = time;
    const ampm = time.match(/^(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)$/i);
    if (ampm) {
      let h = Number(ampm[1]);
      const m = ampm[2];
      const mer = ampm[3].toLowerCase();
      if (mer.startsWith('p') && h < 12) h += 12;
      if (mer.startsWith('a') && h === 12) h = 0;
      isoTime = `${String(h).padStart(2, '0')}:${m}`;
    } else if (/^\d{1,2}:\d{2}$/.test(time)) {
      const [h, m] = time.split(':');
      isoTime = `${String(h).padStart(2, '0')}:${m}`;
    } else if (/^\d{1,2}$/.test(time)) {
      isoTime = `${String(time).padStart(2, '0')}:00`;
    }
    const combined = new Date(`${apt.date}T${isoTime}:00`);
    if (!Number.isNaN(combined.getTime())) return combined;
  }
  if (apt.dateTime) {
    const fromField = new Date(apt.dateTime);
    if (!Number.isNaN(fromField.getTime())) return fromField;
  }
  return null;
}

function appointmentDurationMinutes(apt) {
  const n = Number(apt?.durationMinutes);
  if (Number.isFinite(n) && n > 0) return n;
  return DEFAULT_DURATION_MINUTES;
}

/**
 * Half-open window overlap: [start, end).
 */
function windowsOverlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

/**
 * Check if a proposed appointment overlaps any existing by duration window
 * (not only identical date+time strings).
 *
 * @param {string} userId
 * @param {string} date - YYYY-MM-DD or spoken date already normalized
 * @param {string} time - HH:MM or similar
 * @param {{ durationMinutes?: number, excludeAppointmentId?: string|null }} [opts]
 * @returns {Promise<Array>} Conflicting appointments (soonest first)
 */
async function checkForConflicts(userId, date, time, opts = {}) {
  const proposedDuration =
    Number.isFinite(Number(opts.durationMinutes)) && Number(opts.durationMinutes) > 0
      ? Number(opts.durationMinutes)
      : DEFAULT_DURATION_MINUTES;
  const excludeId = opts.excludeAppointmentId || null;

  const proposedStart = resolveAppointmentStart({ date, time });
  if (!proposedStart) {
    // Fallback: exact string match if we cannot parse a window
    const appointments = await getAppointments(userId);
    return appointments.filter(
      (apt) =>
        apt.appointmentId !== excludeId &&
        apt.date === date &&
        apt.time === time,
    );
  }
  const proposedEnd = new Date(
    proposedStart.getTime() + proposedDuration * 60 * 1000,
  );

  const appointments = await getAppointments(userId);
  const conflicts = appointments
    .filter((apt) => {
      if (excludeId && apt.appointmentId === excludeId) return false;
      const start = resolveAppointmentStart(apt);
      if (!start) return false;
      const end = new Date(
        start.getTime() + appointmentDurationMinutes(apt) * 60 * 1000,
      );
      return windowsOverlap(proposedStart, proposedEnd, start, end);
    })
    .sort((a, b) => {
      const sa = resolveAppointmentStart(a)?.getTime() || 0;
      const sb = resolveAppointmentStart(b)?.getTime() || 0;
      return sa - sb;
    });

  return conflicts;
}

/**
 * Ear-friendly conflict explanation for VI users.
 *
 * @param {Object} existing - conflicting appointment
 * @param {{ doctorName?: string, date: string, time: string, durationMinutes?: number }} proposed
 * @returns {string}
 */
function formatConflictPromptSpeech(existing, proposed) {
  const existingDur = appointmentDurationMinutes(existing);
  const proposedDur =
    Number.isFinite(Number(proposed?.durationMinutes)) &&
    Number(proposed.durationMinutes) > 0
      ? Number(proposed.durationMinutes)
      : DEFAULT_DURATION_MINUTES;

  const existingDate = formatDateForSpeech(existing);
  const existingStart = formatTimeForSpeech(existing);
  const existingEndDate = resolveAppointmentStart(existing);
  let existingEndSpeech = existingStart;
  if (existingEndDate) {
    const end = new Date(existingEndDate.getTime() + existingDur * 60 * 1000);
    existingEndSpeech = formatTimeForSpeech({
      dateTime: end.toISOString(),
      time: null,
    });
  }

  const proposedStartSpeech = formatTimeForSpeech({
    date: proposed.date,
    time: proposed.time,
  });
  const proposedStartDate = resolveAppointmentStart({
    date: proposed.date,
    time: proposed.time,
  });
  let proposedEndSpeech = proposedStartSpeech;
  if (proposedStartDate) {
    const end = new Date(
      proposedStartDate.getTime() + proposedDur * 60 * 1000,
    );
    proposedEndSpeech = formatTimeForSpeech({
      dateTime: end.toISOString(),
      time: null,
    });
  }
  const proposedDateSpeech = formatDateForSpeech({
    date: proposed.date,
    dateTime: proposedStartDate ? proposedStartDate.toISOString() : null,
  });
  const newDoctor = proposed.doctorName || 'your new appointment';

  return (
    `You already have an appointment with ${existing.doctorName} on ${existingDate} ` +
    `from ${existingStart} to ${existingEndSpeech}. ` +
    `The new one with ${newDoctor} on ${proposedDateSpeech} would be from ${proposedStartSpeech} to ${proposedEndSpeech}. ` +
    `Those times overlap. Say yes to keep both appointments, or no to replace the old one.`
  );
}

/**
 * Update an existing appointment
 */
async function updateAppointment(userId, appointmentId, updates) {
  const appointments = await getAppointments(userId);
  const target = appointments.find(apt => apt.appointmentId === appointmentId);
  if (!target) {
    throw new Error('Appointment not found');
  }
  
  const updatedApt = { ...target, ...updates };
  
  if (updates.date || updates.time) {
    try {
      const parsedDate = await smartParseDateTime(updatedApt.date, updatedApt.time);
      if (parsedDate) {
        updatedApt.dateTime = parsedDate.toISOString();
      } else {
        updatedApt.dateTime = parseDate(updatedApt.date).toISOString();
      }
    } catch(e) {
      updatedApt.dateTime = new Date(`${updatedApt.date}T${updatedApt.time}`).toISOString();
    }
  }
  
  await saveAppointment(userId, updatedApt);
  return updatedApt;
}

/**
 * Delete an user appointment
 */
async function deleteUserAppointment(userId, appointmentId) {
  try {
    return await dbDeleteAppointment(userId, appointmentId);
  } catch (error) {
    const message = String(error && (error.code || error.name || error.message || ''));
    if (!/AccessDenied|Unauthorized|not authorized/i.test(message)) {
      throw error;
    }

    safeLog.warn('appointment_hard_delete_denied_soft_fallback', {});
    const appointments = await getAppointments(userId);
    const target = appointments.find(apt => apt.appointmentId === appointmentId);
    if (!target) {
      throw new Error('Appointment not found for soft delete');
    }

    await saveAppointment(userId, {
      ...target,
      status: 'CANCELLED',
    });
    return { softDeleted: true };
  }
}

/**
 * Format appointment for speech output (ear-friendly date/time).
 *
 * @param {Object} appointment - Appointment object
 * @param {{ verbosity?: 'brief'|'detailed' }} [opts]
 * @returns {string} Human-readable description
 */
function formatAppointmentForSpeech(appointment, opts = {}) {
  const { doctorName, location, durationMinutes } = appointment;
  const dateSpeech = formatDateForSpeech(appointment);
  const timeSpeech = formatTimeForSpeech(appointment);
  const verbosity = String(opts.verbosity || 'detailed').toLowerCase();

  let speech = `${doctorName} on ${dateSpeech} at ${timeSpeech}`;

  if (verbosity === 'brief') {
    return speech;
  }

  if (location && location !== 'Not specified') {
    speech += ` in ${location}`;
  }

  const dur = durationMinutes || 60;
  speech += ` for ${formatDurationForSpeech(dur)}`;

  return speech;
}

/**
 * Format a short appointment list (no pagination). Prefer presentAppointmentList for UX.
 *
 * @param {Array} appointments - Array of appointments
 * @param {string} [listKind='upcoming']
 * @returns {string} Human-readable list
 */
function formatAppointmentListForSpeech(
  appointments,
  listKind = 'upcoming',
  opts = {},
) {
  if (!appointments || appointments.length === 0) {
    return `You have no ${listKind} appointments.`;
  }

  if (appointments.length === 1) {
    return `You have one ${listKind} appointment: ${formatAppointmentForSpeech(appointments[0], opts)}.`;
  }

  const count = appointments.length;
  const list = appointments
    .map((apt, idx) => `Number ${idx + 1}: ${formatAppointmentForSpeech(apt, opts)}`)
    .join('. ');

  return `You have ${count} ${listKind} appointments: ${list}.`;
}

module.exports = {
  createAppointment,
  getUpcomingAppointments,
  getPastAppointments,
  getAppointmentById,
  getAppointmentsByIds,
  findByDoctor,
  checkForConflicts,
  formatConflictPromptSpeech,
  resolveAppointmentStart,
  updateAppointment,
  deleteUserAppointment,
  formatAppointmentForSpeech,
  formatAppointmentListForSpeech,
  parseDurationFromSpeech,
  formatDurationForSpeech,
  listPageSizeForVerbosity,
  DEFAULT_DURATION_MINUTES,
  MAX_DURATION_MINUTES,
  LIST_PAGE_SIZE,
  BRIEF_LIST_PAGE_SIZE,
};
