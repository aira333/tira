// apps/skill-backend/src/dialogue/parsers.js
// Parse spoken answers for the active dialogue step

const { parseFreeForm } = require('../smart-logic/smartDateParser');
const { cleanUserName } = require('../modules/profile/profile.service');

const VISIT_TYPE_DOCTOR_TOKENS = new Set([
  'appointment',
  'appointments',
  'appoinment',
  'appoinments',
  'checkup',
  'checkups',
  'please',
  'schedule',
  'visit',
  'visits',
]);

const NAME_DATE_STOP_WORDS = new Set([
  'today',
  'tomorrow',
  'tonight',
  'yesterday',
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
  'this',
  'on',
  'at',
  'am',
  'pm',
  'a.m',
  'p.m',
  'a.m.',
  'p.m.',
]);

function normalizeUtterance(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .trim();
}

function isCancelUtterance(text) {
  const t = normalizeUtterance(text).toLowerCase();
  return /^(cancel|stop|never mind|nevermind|forget it|quit|exit)\b/.test(t)
    || /\b(cancel|never mind|nevermind|stop adding|forget it)\b/.test(t);
}

function utteranceHasExplicitTime(text) {
  const t = String(text || '');
  return /\b(\d{1,2}(:\d{2})?\s*(a\.?m\.?|p\.?m\.?)|noon|midnight|\d{1,2}\s*o'?clock)\b/i.test(
    t,
  ) ||
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(a\.?m\.?|p\.?m\.?|o'?clock)\b/i.test(
      t,
    );
}

/** Reject visit-type / date-time words mistaken for a doctor name. */
function sanitizeDoctorName(name) {
  let cleaned = String(name || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  // Strip leading title so "doctor smith" / AMAZON.Person "Doctor Smith" survives
  cleaned = cleaned.replace(/^(doctor|dr\.?)(?:'s)?\s+/i, '').trim();
  if (!cleaned) return null;
  if (
    /^(yes|no|skip|please|hello|hi|appointment|appointments|appoinment|schedule|visit|checkup)$/i.test(
      cleaned,
    )
  ) {
    return null;
  }

  const timeWords = new Set([
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
    'ten',
    'eleven',
    'twelve',
    'noon',
    'midnight',
    'oclock',
    "o'clock",
  ]);

  const kept = [];
  for (const part of cleaned.split(/\s+/)) {
    const lower = part.toLowerCase();
    const stripped = lower.replace(/\./g, '');
    if (VISIT_TYPE_DOCTOR_TOKENS.has(lower)) break;
    if (NAME_DATE_STOP_WORDS.has(lower) || NAME_DATE_STOP_WORDS.has(stripped)) {
      break;
    }
    if (timeWords.has(lower) || timeWords.has(stripped)) break;
    if (/^\d{1,2}(:\d{2})?$/.test(part)) break;
    kept.push(part);
  }

  const joined = kept.join(' ').trim();
  if (!joined) return null;
  if (VISIT_TYPE_DOCTOR_TOKENS.has(joined.toLowerCase())) return null;
  if (NAME_DATE_STOP_WORDS.has(joined.toLowerCase())) return null;
  // NFR input bound — avoid oversized Dynamo attributes
  return joined.length > 80 ? joined.slice(0, 80).trim() : joined;
}

function parseDoctorAnswer(text) {
  let name = normalizeUtterance(text)
    .replace(/^(doctor|dr\.?)(?:'s)?\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return sanitizeDoctorName(name);
}

function parseAlexaDateSlot(value) {
  const raw = normalizeUtterance(value);
  if (!raw) return null;

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return { date: raw, time: null };
  }

  // Alexa week: 2026-W32 or 2026-W32-1 (ISO day 1=Monday … 7=Sunday)
  const week = raw.match(/^(\d{4})-W(\d{2})(?:-(\d))?$/i);
  if (week) {
    const year = Number(week[1]);
    const weekNum = Number(week[2]);
    const isoDay = week[3] ? Number(week[3]) : 1;
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const jan4Day = jan4.getUTCDay() || 7;
    const week1Monday = new Date(jan4);
    week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
    const target = new Date(week1Monday);
    target.setUTCDate(week1Monday.getUTCDate() + (weekNum - 1) * 7 + (isoDay - 1));
    const yyyy = target.getUTCFullYear();
    const mo = String(target.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(target.getUTCDate()).padStart(2, '0');
    return { date: `${yyyy}-${mo}-${dd}`, time: null };
  }

  // Alexa month: 2026-08
  const monthOnly = raw.match(/^(\d{4})-(\d{2})$/);
  if (monthOnly) {
    return { date: `${monthOnly[1]}-${monthOnly[2]}-01`, time: null };
  }

  return null;
}

function parseDateAnswer(text) {
  const spoken = normalizeUtterance(text);
  if (!spoken) return null;

  const alexa = parseAlexaDateSlot(spoken);
  if (alexa) return alexa;

  const parsed = parseFreeForm(spoken);
  if (parsed.date) {
    // FreeForm sample "next {FreeForm}" often yields only "monday". If chrono
    // lands on today for a bare weekday, prefer next week's occurrence.
    if (/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i.test(spoken)) {
      const now = new Date();
      const yyyy = now.getFullYear();
      const mo = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const today = `${yyyy}-${mo}-${dd}`;
      if (parsed.date === today) {
        const nextTry = parseFreeForm(`next ${spoken}`);
        if (nextTry.date && nextTry.date !== today) {
          return { date: nextTry.date, time: null };
        }
      }
    }
    return {
      date: parsed.date,
      time: utteranceHasExplicitTime(spoken) && parsed.time ? parsed.time : null,
    };
  }

  return null;
}

function parseTimeAnswer(text) {
  const spoken = normalizeUtterance(text);
  if (!spoken) return null;
  const parsed = parseFreeForm(spoken);
  if (!parsed.time) return null;
  return { time: parsed.time };
}

function looksLikeDateOrTimeName(raw) {
  const t = String(raw || '').toLowerCase().trim();
  if (!t) return true;
  if (NAME_DATE_STOP_WORDS.has(t)) return true;
  if (/\b(today|tomorrow|tonight|yesterday)\b/.test(t)) return true;
  if (
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(t)
  ) {
    return true;
  }
  if (/\b\d{1,2}(:\d{2})?\s*(a\.?m\.?|p\.?m\.?)?\b/.test(t) && t.split(/\s+/).length <= 3) {
    return true;
  }
  return false;
}

function parseNameAnswer(text) {
  const spoken = normalizeUtterance(text);
  const m = spoken.match(
    /^(?:my name is|call me|i am|i'm|set my name to|remember my name as|change my name to)\s+(.+)$/i,
  );
  const raw = m ? m[1] : spoken;
  if (looksLikeDateOrTimeName(raw)) return null;
  return cleanUserName(raw) || null;
}

function parseListVerbosityAnswer(text) {
  const t = normalizeUtterance(text).toLowerCase();
  if (!t) return null;
  if (
    /\b(brief|short|shorter|concise)\b/.test(t) &&
    !/\b(detailed|longer|full)\b/.test(t)
  ) {
    return 'brief';
  }
  if (/\b(detailed|longer|full detail|more detail)\b/.test(t)) {
    return 'detailed';
  }
  return null;
}

function parseHelpDomain(text) {
  const t = normalizeUtterance(text).toLowerCase();
  if (!t) return null;
  if (/\b(appointments?|doctor visits?|schedule)\b/.test(t) || t === 'appointment') {
    return 'appointments';
  }
  if (/\b(rides?|transport|transportation|agency ride)\b/.test(t) || t === 'ride') {
    return 'rides';
  }
  if (/\b(shopping|store list|grocery)\b/.test(t) || t === 'shop' || t === 'stores') {
    return 'shopping';
  }
  if (/\b(to[\s-]?dos?|todos?|to do list)\b/.test(t)) {
    return 'todos';
  }
  return null;
}

function parseSkipLocation(text) {
  const t = normalizeUtterance(text).toLowerCase();
  return /\b(skip|no location|none|no)\b/.test(t) && !/\b(yes)\b/.test(t);
}

/** Skip remaining optional add steps (location / duration / reminder). */
function parseSkipOptionalAdd(text) {
  const t = normalizeUtterance(text).toLowerCase();
  return (
    /\b(skip (the )?rest|skip optional|no thanks|that's all|that is all|done|finish|just save|save it)\b/.test(
      t,
    ) || t === 'skip'
  );
}

function cleanLocationAnswer(value) {
  const cleaned = normalizeUtterance(value)
    .replace(/\b(yes|yeah|yep)\b/gi, ' ')
    .replace(/\b(location|city)\b/gi, ' ')
    .replace(/^(doctor|dr\.?)\s+/i, '')
    .replace(/^(in|at|to)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned || /\b(skip|none|no location|default)\b/i.test(cleaned)) {
    return 'Not specified';
  }

  return cleaned;
}

function parseNoReminder(text) {
  const t = normalizeUtterance(text).toLowerCase();
  return /\b(no reminder|no|skip|none)\b/.test(t);
}

/**
 * Map Alexa AMAZON.DURATION (ISO-8601) to discrete reminder leads only.
 * e.g. PT15M → 15, PT1H / PT60M → 60, P1D / PT24H → 1440
 * @returns {15|60|1440|null}
 */
function leadMinutesFromAlexaDuration(text) {
  const t = String(text || '').toLowerCase();
  const m = t.match(
    /\bp(?:(\d+(?:\.\d+)?)d)?(?:t(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?)?\b/,
  );
  if (!m || (!m[1] && !m[2] && !m[3] && !m[4])) return null;
  const days = parseFloat(m[1] || '0');
  const hours = parseFloat(m[2] || '0');
  const minutes = parseFloat(m[3] || '0');
  const seconds = parseFloat(m[4] || '0');
  const total = Math.round(days * 1440 + hours * 60 + minutes + seconds / 60);
  if (total === 15) return 15;
  if (total === 60) return 60;
  if (total === 1440) return 1440;
  return null;
}

/**
 * Discrete reminder lead times for Alexa Reminders (Step 2).
 * Accepts spoken forms and AMAZON.DURATION ISO values (P1D, PT1H, PT15M).
 * @returns {{ valid: boolean, leadMinutes: 15|60|1440|null }}
 */
function parseReminderLead(text) {
  const t = normalizeUtterance(text).toLowerCase().trim();
  if (!t) return { valid: false, leadMinutes: null };

  if (/\b(no reminder|no|skip|none)\b/.test(t)) {
    return { valid: true, leadMinutes: null };
  }

  // Alexa ReminderTime / Duration slots often arrive as ISO-8601 (not "one day")
  const isoLead = leadMinutesFromAlexaDuration(t);
  if (isoLead != null) {
    return { valid: true, leadMinutes: isoLead };
  }

  // 15 minutes
  if (
    /\b(15|fifteen)\s*(minutes?|mins?)?\b/.test(t) ||
    /\ba quarter\s*(of\s+)?(an?\s+)?hour\b/.test(t)
  ) {
    return { valid: true, leadMinutes: 15 };
  }

  // 1 day (before 1 hour — "one day" / "a day" / "tomorrow" as lead)
  if (
    /\b(1|one|a)\s*days?\b/.test(t) ||
    /\b(one day|a day)\s*(before)?\b/.test(t) ||
    /\btomorrow\b/.test(t) ||
    /\bday before\b/.test(t) ||
    /\b24\s*hours?\b/.test(t)
  ) {
    return { valid: true, leadMinutes: 1440 };
  }

  // 1 hour
  if (
    /\b(1|one|an?)\s*hours?\b/.test(t) ||
    /\ban?\s+hour\b/.test(t) ||
    /\b60\s*(minutes?|mins?)\b/.test(t)
  ) {
    return { valid: true, leadMinutes: 60 };
  }

  return { valid: false, leadMinutes: null };
}

module.exports = {
  normalizeUtterance,
  isCancelUtterance,
  utteranceHasExplicitTime,
  sanitizeDoctorName,
  parseDoctorAnswer,
  parseDateAnswer,
  parseTimeAnswer,
  parseNameAnswer,
  parseListVerbosityAnswer,
  parseHelpDomain,
  parseSkipLocation,
  parseSkipOptionalAdd,
  cleanLocationAnswer,
  parseNoReminder,
  parseReminderLead,
  VISIT_TYPE_DOCTOR_TOKENS,
};
