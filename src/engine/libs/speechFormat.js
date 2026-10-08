// apps/skill-backend/src/libs/speechFormat.js
// Ear-friendly date/time speech for VI users

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * Parse YYYY-MM-DD (or Date) as a local calendar date (avoids UTC day shift).
 * @returns {Date|null}
 */
function parseLocalCalendarDate(dateStr) {
  const s = String(dateStr || '').trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  return null;
}

/**
 * @param {object} appointment - { date, dateTime }
 * @returns {string} e.g. "Friday, July 25"
 */
function formatDateForSpeech(appointment) {
  const fromStored = parseLocalCalendarDate(appointment?.date);
  if (fromStored) {
    return `${WEEKDAYS[fromStored.getDay()]}, ${MONTHS[fromStored.getMonth()]} ${fromStored.getDate()}`;
  }
  if (appointment?.dateTime) {
    const d = new Date(appointment.dateTime);
    if (!Number.isNaN(d.getTime())) {
      return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
    }
  }
  return String(appointment?.date || 'an unknown date');
}

/**
 * @param {string} timeStr - "14:00", "2:00 PM", "2 PM"
 * @returns {string} e.g. "2 P.M." or "2:30 P.M."
 */
function formatTimeStringForSpeech(timeStr) {
  const raw = String(timeStr || '').trim();
  if (!raw) return 'an unknown time';

  const m24 = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) {
    let h = parseInt(m24[1], 10);
    const min = parseInt(m24[2], 10);
    const ap = h >= 12 ? 'P.M.' : 'A.M.';
    h = h % 12;
    if (h === 0) h = 12;
    return min === 0 ? `${h} ${ap}` : `${h}:${String(min).padStart(2, '0')} ${ap}`;
  }

  const m12 = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)$/i);
  if (m12) {
    const h = parseInt(m12[1], 10);
    const min = m12[2] ? parseInt(m12[2], 10) : 0;
    const ap = /p/i.test(m12[3]) ? 'P.M.' : 'A.M.';
    return min === 0 ? `${h} ${ap}` : `${h}:${String(min).padStart(2, '0')} ${ap}`;
  }

  // Already spoken-ish
  return raw.replace(/\b(am)\b/i, 'A.M.').replace(/\b(pm)\b/i, 'P.M.');
}

/**
 * @param {object} appointment - { time, dateTime }
 */
function formatTimeForSpeech(appointment) {
  if (appointment?.time) {
    return formatTimeStringForSpeech(appointment.time);
  }
  if (appointment?.dateTime) {
    const d = new Date(appointment.dateTime);
    if (!Number.isNaN(d.getTime())) {
      let h = d.getHours();
      const min = d.getMinutes();
      const ap = h >= 12 ? 'P.M.' : 'A.M.';
      h = h % 12;
      if (h === 0) h = 12;
      return min === 0 ? `${h} ${ap}` : `${h}:${String(min).padStart(2, '0')} ${ap}`;
    }
  }
  return 'an unknown time';
}

module.exports = {
  WEEKDAYS,
  MONTHS,
  parseLocalCalendarDate,
  formatDateForSpeech,
  formatTimeForSpeech,
  formatTimeStringForSpeech,
};
