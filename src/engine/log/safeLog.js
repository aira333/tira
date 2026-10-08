// libs/log/safeLog.js
// Structured, privacy-safe logging for Day Buddy (Lambda + local tests)

/**
 * Never log: full Alexa userId, phone numbers, freeform utterances,
 * doctor names, shopping/todo item names, or raw request envelopes.
 *
 * Prefer: requestId, intent/request type, durationMs, counts, error.message.
 */

function redactUserId(userId) {
  if (userId == null || userId === '') return undefined;
  const s = String(userId);
  if (s.length <= 8) return '***';
  return `…${s.slice(-6)}`;
}

function redactPhone(phone) {
  if (phone == null || phone === '') return undefined;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return `***-${digits.slice(-4)}`;
}

/** Strip common PII keys from a shallow fields object. */
function sanitizeFields(fields = {}) {
  if (!fields || typeof fields !== 'object') return {};
  const out = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    const k = key.toLowerCase();
    if (
      k === 'userid' ||
      k === 'user_id' ||
      k.endsWith('userid')
    ) {
      out[key] = redactUserId(value);
      continue;
    }
    if (
      k.includes('phone') ||
      k === 'riderphone' ||
      k === 'transportphone'
    ) {
      out[key] = redactPhone(value);
      continue;
    }
    if (
      k === 'utterance' ||
      k === 'freeform' ||
      k === 'speech' ||
      k === 'doctorname' ||
      k === 'itemname' ||
      k === 'items' ||
      k === 'envelope' ||
      k === 'event'
    ) {
      continue; // drop
    }
    out[key] = value;
  }
  return out;
}

function emit(level, event, fields) {
  const payload = {
    event,
    ...sanitizeFields(fields),
  };
  const line = JSON.stringify(payload);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

const safeLog = {
  info(event, fields) {
    emit('info', event, fields);
  },
  warn(event, fields) {
    emit('warn', event, fields);
  },
  error(event, fields) {
    emit('error', event, fields);
  },
  redactUserId,
  redactPhone,
  sanitizeFields,
};

module.exports = safeLog;
