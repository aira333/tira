// Business logic for ride coordination.

const {
  getAppointments,
  getRiderPhone,
  getTransportInfo,
  normalizePhoneNumber,
  placeBridgeCall,
  shouldAttemptRealTwilioHttp,
  saveRiderPhone,
  saveTransportInfo,
} = require('../../store');
const safeLog = require('../../log');
const { parseFreeForm } = require('../../smart-logic/smartDateParser');

function transportEnvKey(transportName) {
  return String(transportName || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function getPhoneFromDirectory(transportName) {
  const rawDirectory = process.env.TRANSPORT_DIRECTORY_JSON;
  if (!rawDirectory) return '';

  try {
    const directory = JSON.parse(rawDirectory);
    const name = String(transportName || '').trim();
    const key = transportEnvKey(name);
    return directory[name] || directory[name.toLowerCase()] || directory[key] || '';
  } catch (error) {
    safeLog.warn('transport_directory_json_invalid', {
      errorMessage: error?.message,
      errorName: error?.name,
    });
    return '';
  }
}

function getConfiguredTransportPhone(transportName) {
  const key = transportEnvKey(transportName);
  return (
    getPhoneFromDirectory(transportName) ||
    process.env[`TRANSPORT_${key}_PHONE`] ||
    process.env[`RIDE_${key}_PHONE`] ||
    process.env[`${key}_PHONE`] ||
    process.env.RIDE_TRANSPORT_PHONE ||
    process.env.TRANSPORT_PHONE ||
    process.env.DEFAULT_TRANSPORT_PHONE ||
    ''
  );
}

function getConfiguredRiderPhone() {
  return (
    process.env.RIDER_PHONE ||
    process.env.USER_PHONE ||
    process.env.DEFAULT_RIDER_PHONE ||
    ''
  );
}

function isPlaceholderPhone(phoneNumber) {
  const normalizedPhone = normalizePhoneNumber(phoneNumber);
  return normalizedPhone === '+15555555555';
}

function phoneEnding(phoneNumber) {
  const normalizedPhone = normalizePhoneNumber(phoneNumber);
  if (!normalizedPhone) return '';
  return normalizedPhone.replace(/[^\d]/g, '').slice(-4);
}

function formatTransportForSpeech(transportInfo) {
  if (!transportInfo) return 'your ride contact';

  if (transportInfo.transportName) {
    return transportInfo.transportName;
  }

  const ending = phoneEnding(transportInfo.transportPhone);
  return ending ? `the number ending in ${ending}` : 'your ride contact';
}

async function setTransportInfo(userId, transportName, transportPhone) {
  const configuredPhone = transportPhone || getConfiguredTransportPhone(transportName);
  const normalizedPhone = normalizePhoneNumber(configuredPhone) || '';
  return saveTransportInfo(userId, transportName || 'My Ride', normalizedPhone);
}

async function setRiderPhone(userId, riderPhone) {
  const normalizedPhone = normalizePhoneNumber(riderPhone);
  if (!normalizedPhone) {
    throw new Error('A valid phone number is required');
  }

  return saveRiderPhone(userId, normalizedPhone);
}

async function getTransportInfoForUser(userId) {
  const transportInfo = await getTransportInfo(userId);
  if (!transportInfo) return null;

  if (transportInfo.transportPhone) {
    return transportInfo;
  }

  const configuredPhone = normalizePhoneNumber(getConfiguredTransportPhone(transportInfo.transportName)) || '';
  if (!configuredPhone) {
    return transportInfo;
  }

  return {
    ...transportInfo,
    transportPhone: configuredPhone,
  };
}

async function getRiderPhoneForUser(userId) {
  const savedPhone = await getRiderPhone(userId);
  const normalizedSavedPhone = normalizePhoneNumber(savedPhone?.riderPhone);
  if (normalizedSavedPhone && !isPlaceholderPhone(normalizedSavedPhone)) {
    return normalizedSavedPhone;
  }

  return normalizePhoneNumber(getConfiguredRiderPhone()) || '';
}

async function resolveTransportInfoForRide(userId, transportName, transportPhone) {
  const normalizedPhone = normalizePhoneNumber(transportPhone);
  if (normalizedPhone) {
    return {
      transportName: transportName || '',
      transportPhone: normalizedPhone,
      isDirectNumber: true,
    };
  }

  if (transportName) {
    return {
      transportName,
      transportPhone: normalizePhoneNumber(getConfiguredTransportPhone(transportName)) || '',
    };
  }

  return getTransportInfoForUser(userId);
}

function resolveAppointmentDateTime(apt) {
  if (!apt) return null;
  if (apt.dateTime) {
    const fromField = new Date(apt.dateTime);
    if (!Number.isNaN(fromField.getTime())) return fromField;
  }
  if (apt.date && apt.time) {
    const time = String(apt.time).trim();
    // AMAZON.TIME / stored "15:00" or "3:00 PM"
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
    }
    const combined = new Date(`${apt.date}T${isoTime}:00`);
    if (!Number.isNaN(combined.getTime())) return combined;
    const dateOnly = new Date(apt.date);
    if (!Number.isNaN(dateOnly.getTime())) return dateOnly;
  }
  return null;
}

async function getNextAppointment(userId) {
  const upcoming = await getUpcomingAppointments(userId);
  return upcoming[0] || null;
}

/**
 * All upcoming appointments, soonest first (for ride disambiguation).
 * @returns {Promise<Array>}
 */
async function getUpcomingAppointments(userId) {
  const appointments = await getAppointments(userId);
  const now = new Date();

  return appointments
    .map((apt) => ({ apt, when: resolveAppointmentDateTime(apt) }))
    .filter(({ when }) => when && when > now)
    .sort((a, b) => a.when - b.when)
    .map(({ apt, when }) => ({
      ...apt,
      dateTime: apt.dateTime || when.toISOString(),
      date: apt.date || when.toISOString().slice(0, 10),
      time: apt.time || when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    }));
}

/**
 * Filter upcoming appointments by doctor name (partial, case-insensitive).
 */
function filterAppointmentsByDoctor(appointments, doctorName) {
  const needle = String(doctorName || '')
    .toLowerCase()
    .replace(/^(dr\.?|doctor)\s+/i, '')
    .trim();
  if (!needle) return appointments || [];
  return (appointments || []).filter((apt) =>
    String(apt.doctorName || '')
      .toLowerCase()
      .includes(needle),
  );
}

/**
 * Last-4 confirm snippet for rider + transport phones (VI trust before call).
 */
function formatLastFourConfirmSpeech(riderPhone, transportInfo) {
  const rider4 = phoneEnding(riderPhone);
  const transport4 = phoneEnding(transportInfo?.transportPhone);
  const transportText = formatTransportForSpeech(transportInfo);
  const parts = [];
  if (transport4) {
    parts.push(`I'll call ${transportText} at the number ending in ${transport4}`);
  } else {
    parts.push(`I'll call ${transportText}`);
  }
  if (rider4) {
    parts.push(`and your callback number ends in ${rider4}`);
  }
  return `${parts.join(' ')}. `;
}

function formatPickupTimeForSpeech(pickupTime) {
  if (!pickupTime || typeof pickupTime !== 'string') {
    return 'the requested time';
  }

  const timeMatch = pickupTime.match(/^(\d{1,2}):(\d{2})$/);
  if (!timeMatch) {
    return pickupTime;
  }

  const hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return pickupTime;
  }

  const date = new Date(Date.UTC(2000, 0, 1, hours, minutes));
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  });
}

const NUMBER_WORDS = {
  zero: 0,
  oh: 0,
  o: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const TENS_WORDS = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fourty: 40,
  fifty: 50,
};

function parseNumberTokens(tokens) {
  if (!tokens.length) return null;

  if (tokens.length === 1) {
    const token = tokens[0];
    if (/^\d+$/.test(token)) return Number(token);
    if (Object.prototype.hasOwnProperty.call(NUMBER_WORDS, token)) {
      return NUMBER_WORDS[token];
    }
    if (Object.prototype.hasOwnProperty.call(TENS_WORDS, token)) {
      return TENS_WORDS[token];
    }
    return null;
  }

  if (tokens.length === 2 && (tokens[0] === 'zero' || tokens[0] === 'oh' || tokens[0] === 'o')) {
    return parseNumberTokens([tokens[1]]);
  }

  const first = tokens[0];
  const second = tokens[1];
  if (
    Object.prototype.hasOwnProperty.call(TENS_WORDS, first) &&
    Object.prototype.hasOwnProperty.call(NUMBER_WORDS, second) &&
    NUMBER_WORDS[second] < 10
  ) {
    return TENS_WORDS[first] + NUMBER_WORDS[second];
  }

  return null;
}

function toClockTime(hours, minutes, meridiem) {
  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return '';
  }

  let normalizedHours = hours;
  if (meridiem === 'am') {
    if (hours < 1 || hours > 12) return '';
    normalizedHours = hours === 12 ? 0 : hours;
  } else if (meridiem === 'pm') {
    if (hours < 1 || hours > 12) return '';
    normalizedHours = hours === 12 ? 12 : hours + 12;
  }

  return `${String(normalizedHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function meridiemFromText(rawTime) {
  const value = String(rawTime || '').toLowerCase();
  if (/\bp\.?\s*m\.?\b|\bin the afternoon\b|\bafternoon\b|\bevening\b/.test(value)) {
    return 'pm';
  }
  if (/\ba\.?\s*m\.?\b|\bin the morning\b|\bmorning\b/.test(value)) {
    return 'am';
  }
  return '';
}

function parseCompactNumericTime(rawTime) {
  const digits = String(rawTime || '').replace(/[^\d]/g, '');
  if (!/^\d{3,4}$/.test(digits)) return null;

  const hourText = digits.length === 3 ? digits.slice(0, 1) : digits.slice(0, 2);
  const minuteText = digits.slice(-2);
  const hours = Number(hourText);
  const minutes = Number(minuteText);

  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    hours < 1 ||
    hours > 12 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }

  return { hours, minutes };
}

function normalizePickupTime(rawTime) {
  if (!rawTime || typeof rawTime !== 'string') return '';

  const trimmed = rawTime.trim();
  const validTime = trimmed.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (validTime) {
    return `${String(Number(validTime[1])).padStart(2, '0')}:${validTime[2]}`;
  }

  let value = trimmed
    .toLowerCase()
    .replace(/\ba\.?\s*m\.?\b/g, ' am ')
    .replace(/\bp\.?\s*m\.?\b/g, ' pm ')
    .replace(/\bin the afternoon\b|\bafternoon\b|\bevening\b/g, ' pm ')
    .replace(/\bin the morning\b|\bmorning\b/g, ' am ')
    .replace(/\bpoint\b|\bcolon\b/g, ' ')
    .replace(/\bo'clock\b|\bclock\b/g, ' ')
    .replace(/-/g, ' ')
    .replace(/[^a-z0-9:\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (value === 'noon') return '12:00';
  if (value === 'midnight') return '00:00';

  let meridiem = '';
  if (/\bpm\b/.test(value)) {
    meridiem = 'pm';
  } else if (/\bam\b/.test(value)) {
    meridiem = 'am';
  }

  value = value
    .replace(/\b(am|pm|at|around|about|please)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const compactTime = parseCompactNumericTime(value);
  if (compactTime && meridiem) {
    return toClockTime(compactTime.hours, compactTime.minutes, meridiem);
  }

  const numericMatch = value.match(/^(\d{1,2})(?::|\s)(\d{1,2})$/);
  if (numericMatch) {
    const hours = Number(numericMatch[1]);
    const minutes = Number(numericMatch[2]);
    return toClockTime(hours, minutes, meridiem);
  }

  const numericHourMatch = value.match(/^(\d{1,2})$/);
  if (numericHourMatch) {
    return toClockTime(Number(numericHourMatch[1]), 0, meridiem);
  }

  const tokens = value.split(' ').filter(Boolean);
  if (!tokens.length) return '';

  const hour = parseNumberTokens([tokens[0]]);
  if (hour === null) return '';

  const minuteTokens = tokens.slice(1);
  const minutes = minuteTokens.length ? parseNumberTokens(minuteTokens) : 0;
  if (minutes === null) return '';

  return toClockTime(hour, minutes, meridiem);
}

function getAmbiguousPickupTime(rawTime) {
  if (meridiemFromText(rawTime)) return null;

  const compactTime = parseCompactNumericTime(rawTime);
  if (!compactTime) return null;

  return {
    hours: compactTime.hours,
    minutes: compactTime.minutes,
    speech: `${compactTime.hours}:${String(compactTime.minutes).padStart(2, '0')}`,
  };
}

function resolveAmbiguousPickupTime(rawTime, ambiguousTime) {
  const meridiem = meridiemFromText(rawTime);
  if (!meridiem || !ambiguousTime) return '';
  return toClockTime(Number(ambiguousTime.hours), Number(ambiguousTime.minutes), meridiem);
}

function formatPickupDateForSpeech(pickupDate) {
  const date = parsePickupDate(pickupDate);
  if (!date) {
    return pickupDate || 'the requested date';
  }

  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function parsePickupDate(rawDate, referenceDate = new Date()) {
  if (!rawDate || typeof rawDate !== 'string') return null;
  const value = rawDate.trim().toLowerCase();
  if (!value) return null;

  const reference = new Date(referenceDate);
  // Calendar dates are UTC-midnight values; "today" is the phone's local day.
  const referenceUtc = new Date(Date.UTC(
    reference.getFullYear(),
    reference.getMonth(),
    reference.getDate(),
  ));

  if (value === 'today') {
    return referenceUtc;
  }

  if (value === 'tomorrow') {
    referenceUtc.setUTCDate(referenceUtc.getUTCDate() + 1);
    return referenceUtc;
  }

  if (value === 'day after tomorrow' || value === 'the day after tomorrow') {
    referenceUtc.setUTCDate(referenceUtc.getUTCDate() + 2);
    return referenceUtc;
  }

  let isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!isoMatch) {
    // Alexa's DATE slot used to resolve "next monday" / "october 3" for us;
    // on device, fall back to chrono on the raw transcript.
    const spoken = parseFreeForm(value);
    isoMatch = spoken?.date ? String(spoken.date).match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  }
  if (!isoMatch) return null;

  const year = Number(isoMatch[1]);
  const month = Number(isoMatch[2]);
  const day = Number(isoMatch[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

function normalizePickupDate(rawDate, referenceDate = new Date()) {
  const date = parsePickupDate(rawDate, referenceDate);
  if (!date) return '';
  return date.toISOString().slice(0, 10);
}

function pickupDateTimeStatus(pickupDate, pickupTime, referenceDate = new Date()) {
  const date = parsePickupDate(pickupDate, referenceDate);
  const timeMatch = String(pickupTime || '').match(/^(\d{1,2}):(\d{2})$/);

  if (!date) {
    return { valid: false, reason: 'INVALID_DATE' };
  }

  if (!timeMatch) {
    return { valid: false, reason: 'INVALID_TIME' };
  }

  const hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);
  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return { valid: false, reason: 'INVALID_TIME' };
  }

  // Pickup is local wall-clock time on the phone.
  const pickupDateTime = new Date(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    hours,
    minutes,
  );
  const reference = new Date(referenceDate);

  if (pickupDateTime < reference) {
    const referenceDateOnly = new Date(Date.UTC(
      reference.getFullYear(),
      reference.getMonth(),
      reference.getDate(),
    ));
    if (date < referenceDateOnly) {
      return { valid: false, reason: 'PAST_DATE', pickupDateTime };
    }
    return { valid: false, reason: 'PAST_TIME', pickupDateTime };
  }

  return { valid: true, pickupDateTime };
}

function formatAppointmentRideRequest(appointment, pickupTime, transportInfo) {
  const appointmentDate = new Date(appointment.dateTime);
  const dateText = appointmentDate.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const appointmentTime = appointmentDate.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
  const pickupTimeText = formatPickupTimeForSpeech(pickupTime);
  const transportText = formatTransportForSpeech(transportInfo);

  return `I can call ${transportText} for a ride to your appointment with ${appointment.doctorName} ` +
    `on ${dateText} at ${appointmentTime}. Pickup time is ${pickupTimeText}.`;
}

function formatLocationRideRequest(destination, pickupDate, pickupTime, transportInfo) {
  const pickupDateText = formatPickupDateForSpeech(pickupDate);
  const pickupTimeText = formatPickupTimeForSpeech(pickupTime);
  const transportText = formatTransportForSpeech(transportInfo);

  return `I can call ${transportText} for a ride to ${destination} ` +
    `on ${pickupDateText} at ${pickupTimeText}.`;
}

function buildAppointmentBridgeMessage(appointment, pickupTime, transportInfo) {
  const appointmentDate = new Date(appointment.dateTime);
  const dateText = appointmentDate.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const appointmentTime = appointmentDate.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
  const pickupTimeText = formatPickupTimeForSpeech(pickupTime);
  const transportText = formatTransportForSpeech(transportInfo);

  return `When they answer, say: I need a ride ` +
    `to my appointment with ${appointment.doctorName} ` +
    `on ${dateText} at ${appointmentTime}. Pickup time is ${pickupTimeText}.`;
}

function buildLocationBridgeMessage(destination, pickupDate, pickupTime, transportInfo) {
  const pickupDateText = formatPickupDateForSpeech(pickupDate);
  const pickupTimeText = formatPickupTimeForSpeech(pickupTime);
  const transportText = formatTransportForSpeech(transportInfo);
  return `When they answer, say: I need a ride ` +
    `to ${destination} on ${pickupDateText} at ${pickupTimeText}.`;
}

async function callTransportForAppointment({ userId, transportInfo, appointment, pickupTime }) {
  const riderPhone = await getRiderPhoneForUser(userId);
  const message = buildAppointmentBridgeMessage(appointment, pickupTime, transportInfo);
  return placeBridgeCall({
    riderPhone,
    transportPhone: transportInfo.transportPhone,
    message,
  });
}

async function callTransportForLocation({ userId, transportInfo, destination, pickupDate, pickupTime }) {
  const riderPhone = await getRiderPhoneForUser(userId);
  const message = buildLocationBridgeMessage(destination, pickupDate, pickupTime, transportInfo);
  return placeBridgeCall({
    riderPhone,
    transportPhone: transportInfo.transportPhone,
    message,
  });
}

module.exports = {
  buildAppointmentBridgeMessage,
  buildLocationBridgeMessage,
  callTransportForAppointment,
  callTransportForLocation,
  formatAppointmentRideRequest,
  formatPickupDateForSpeech,
  formatLocationRideRequest,
  formatPickupTimeForSpeech,
  formatTransportForSpeech,
  getConfiguredRiderPhone,
  getConfiguredTransportPhone,
  getAmbiguousPickupTime,
  getNextAppointment,
  getUpcomingAppointments,
  filterAppointmentsByDoctor,
  formatLastFourConfirmSpeech,
  getRiderPhoneForUser,
  getTransportInfoForUser,
  normalizePickupDate,
  normalizePickupTime,
  parsePickupDate,
  phoneEnding,
  pickupDateTimeStatus,
  resolveAmbiguousPickupTime,
  resolveTransportInfoForRide,
  setRiderPhone,
  setTransportInfo,
  transportEnvKey,
  shouldAttemptRealTwilioHttp,
};
