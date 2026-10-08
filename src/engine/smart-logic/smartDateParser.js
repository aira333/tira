// libs/smart-logic/src/dates/smartDateParser.js
// Local-first date parsing (chrono-node). No LLM.

const chrono = require('chrono-node');

const MONTH_PATTERN = '(january|jan\\.?|february|feb\\.?|march|mar\\.?|april|apr\\.?|may|june|jun\\.?|july|jul\\.?|august|aug\\.?|september|sept\\.?|sep\\.?|october|oct\\.?|november|nov\\.?|december|dec\\.?)';
const ORDINAL_ONES = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
};

function combineOrdinalDay(base, ordinal) {
  const day = Number(base) + ORDINAL_ONES[String(ordinal || '').toLowerCase()];
  return day >= 1 && day <= 31 ? String(day) : null;
}

function normalizeAlexaCompoundOrdinalDates(text) {
  if (!text || typeof text !== 'string') return text;

  const ordinalPattern = Object.keys(ORDINAL_ONES).join('|');

  return text
    .replace(new RegExp(`\\b(20|30)\\s+(${ordinalPattern})(?:\\s+of)?\\s+${MONTH_PATTERN}\\b`, 'gi'), (match, base, ordinal, month) => {
      const day = combineOrdinalDay(base, ordinal);
      return day ? `${day} ${month}` : match;
    })
    .replace(new RegExp(`\\b${MONTH_PATTERN}\\s+(?:the\\s+)?(20|30)\\s+(${ordinalPattern})\\b`, 'gi'), (match, month, base, ordinal) => {
      const day = combineOrdinalDay(base, ordinal);
      return day ? `${month} ${day}` : match;
    });
}

/**
 * Parse date from Alexa slot value
 * Handles relative dates like "tomorrow", "next week"
 *
 * @param {string} dateSlot - Date slot value from Alexa
 * @returns {Date|null} Parsed date or null
 */
function parseDate(dateSlot) {
  if (!dateSlot) return null;
  const normalizedDateSlot = normalizeAlexaCompoundOrdinalDates(dateSlot);

  const now = new Date();

  if (normalizedDateSlot.toLowerCase().includes('tomorrow')) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow;
  }

  if (normalizedDateSlot.toLowerCase().includes('next week')) {
    const nextWeek = new Date(now);
    nextWeek.setDate(nextWeek.getDate() + 7);
    return nextWeek;
  }

  if (normalizedDateSlot.includes('-')) {
    return new Date(normalizedDateSlot);
  }

  return new Date(normalizedDateSlot);
}

function normalizeSpokenClockTimes(text) {
  if (!text || typeof text !== 'string') return text;
  const words = {
    one: '1',
    two: '2',
    three: '3',
    four: '4',
    five: '5',
    six: '6',
    seven: '7',
    eight: '8',
    nine: '9',
    ten: '10',
    eleven: '11',
    twelve: '12',
  };
  const wordPattern = Object.keys(words).join('|');
  return text
    .replace(
      new RegExp(`\\b(${wordPattern})\\s*(a\\.?m\\.?|p\\.?m\\.?|o'?clock)\\b`, 'gi'),
      (match, word, meridiem) => `${words[word.toLowerCase()]} ${meridiem}`,
    )
    .replace(
      new RegExp(`\\bat\\s+(${wordPattern})\\b(?!\\s*(?:a\\.?m\\.?|p\\.?m\\.?|o'?clock))`, 'gi'),
      (match, word) => `at ${words[word.toLowerCase()]}`,
    );
}

/**
 * Parse free-form text into structured appointment data (chrono-node).
 *
 * @param {string} text - Free-form utterance from user
 * @returns {Object} Parsed data: {doctorName, date, time, dateTimeISO}
 */
function parseFreeForm(text) {
  if (!text) return {};

  const normalizedText = normalizeSpokenClockTimes(
    normalizeAlexaCompoundOrdinalDates(text),
  );
  const lower = text.toLowerCase();
  const doctorNameStopWords = new Set([
    'appointment',
    'appointments',
    'appoinment',
    'appoinments',
    'at',
    'checkup',
    'for',
    'in',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
    'next',
    'on',
    'please',
    'this',
    'today',
    'tomorrow',
    'tonight',
    'yesterday',
    'visit',
    'with',
    'am',
    'pm',
    'a.m.',
    'p.m.',
  ]);

  let doctorName = null;
  // First token after Dr/Doctor only — date words must not become the name.
  // Allow apostrophes (O'Brien).
  const doctorMatch = lower.match(
    /\b(dr\.?|doctor)(?:'s)?\s+([a-z]+(?:'[a-z]+)?)/i,
  );

  if (doctorMatch) {
    const idx = text.toLowerCase().indexOf(doctorMatch[0].toLowerCase());
    if (idx >= 0) {
      const originalSlice = text.substring(idx);
      const origMatch = originalSlice.match(
        /\b(?:Dr\.?|Doctor)(?:'s)?\s+([A-Za-z]+(?:'[A-Za-z]+)?)/,
      );
      doctorName = origMatch ? origMatch[1] : doctorMatch[2];
    } else {
      doctorName = doctorMatch[2];
    }

    if (doctorNameStopWords.has(String(doctorName).toLowerCase())) {
      doctorName = null;
    }
  }

  let dateStr = null;
  let timeStr = null;
  let iso = null;

  const parsed = chrono.parse(normalizedText, new Date(), { forwardDate: true });

  if (parsed && parsed.length > 0) {
    const component = parsed[0];
    const d = component.date();
    iso = d.toISOString();

    const yyyy = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    dateStr = `${yyyy}-${mo}-${dd}`;

    // Only keep time when chrono is certain (avoid noon default for date-only)
    if (component.start.isCertain('hour')) {
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      timeStr = `${hh}:${mm}`;
    }
  }

  return {
    doctorName,
    date: dateStr,
    time: timeStr,
    dateTimeISO: iso,
  };
}

/**
 * Parse date/time with chrono-node only.
 *
 * @param {string} dateText
 * @param {string} [timeText]
 * @returns {Promise<Date|null>}
 */
async function smartParseDateTime(dateText, timeText = '') {
  const combinedText = normalizeSpokenClockTimes(
    normalizeAlexaCompoundOrdinalDates(`${dateText} ${timeText}`.trim()),
  );
  const parsed = chrono.parse(combinedText, new Date(), { forwardDate: true });
  if (parsed && parsed.length > 0) {
    return parsed[0].date();
  }
  return null;
}

/** @deprecated Alias of smartParseDateTime (no LLM). */
async function parseWithFallback(dateText) {
  return smartParseDateTime(dateText);
}

module.exports = {
  parseDate,
  parseFreeForm,
  smartParseDateTime,
  parseWithFallback,
  normalizeSpokenClockTimes,
};
