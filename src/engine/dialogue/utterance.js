// apps/skill-backend/src/dialogue/utterance.js
// Rebuild best-effort spoken text from FreeForm + Alexa slots (hints, not truth)

const Alexa = require('../ask');

function slot(envelope, name) {
  return Alexa.getSlotValue(envelope, name) || '';
}

function joinNonEmpty(parts) {
  return parts
    .map((p) => String(p || '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function joinSlotValues(envelope, names) {
  return names
    .map((name) => Alexa.getSlotValue(envelope, name))
    .filter(Boolean)
    .join(' ');
}

function doctorPhrase(doctorRaw) {
  const d = String(doctorRaw || '').trim();
  if (!d) return '';
  if (/^(doctor|dr\.?)\b/i.test(d)) return d;
  return `doctor ${d}`;
}

/**
 * Intent-specific reconstruction so classify/chrono see a sentence even when
 * Alexa stuffed date/time into Person/SearchQuery slots.
 */
function reconstructFromIntent(envelope, intentName) {
  switch (intentName) {
    case 'AddAppointmentIntent': {
      const doctor = slot(envelope, 'DoctorName');
      const date = slot(envelope, 'Date');
      const time = slot(envelope, 'Time');
      const location = slot(envelope, 'Location');
      const duration = slot(envelope, 'Duration');
      const reminder = slot(envelope, 'ReminderTime');
      return joinNonEmpty([
        doctor ? doctorPhrase(doctor) : '',
        date,
        time ? `at ${time}` : '',
        location ? `in ${location}` : '',
        duration ? `for ${duration}` : '',
        reminder ? `remind me ${reminder} before` : '',
      ]);
    }
    case 'DeleteAppointmentIntent': {
      const doctor = slot(envelope, 'DoctorName');
      return doctor
        ? `delete appointment with ${doctorPhrase(doctor)}`
        : 'delete appointment';
    }
    case 'RescheduleAppointmentIntent': {
      const doctor = slot(envelope, 'DoctorName');
      const date = slot(envelope, 'Date');
      const time = slot(envelope, 'Time');
      return joinNonEmpty([
        'reschedule appointment',
        doctor ? `with ${doctorPhrase(doctor)}` : '',
        date ? `to ${date}` : '',
        time ? `at ${time}` : '',
      ]);
    }
    case 'FindAppointmentByDoctorIntent': {
      const doctor = slot(envelope, 'DoctorName');
      return doctor
        ? `find appointment with ${doctorPhrase(doctor)}`
        : 'find appointment';
    }
    case 'AddShoppingListIntent': {
      const items = slot(envelope, 'Items');
      const store = slot(envelope, 'StoreName');
      if (items && store) {
        return `add ${items} to my ${store} shopping list`;
      }
      // Items-only: keep raw for mid-flow awaiting_items (do not wrap as "add … list").
      if (items) return items;
      if (store) return `shopping list for ${store}`;
      return '';
    }
    case 'GetShoppingListIntent': {
      const store = slot(envelope, 'StoreName');
      return store
        ? `what's on my ${store} shopping list`
        : 'show my shopping lists';
    }
    case 'AddTodoListIntent': {
      const items = slot(envelope, 'Items');
      const list = slot(envelope, 'ListName');
      if (items && list) return `add ${items} to my ${list} to do list`;
      // Items-only: keep raw for mid-flow awaiting_items.
      if (items) return items;
      if (list) return `create a ${list} to do list`;
      return '';
    }
    case 'GetTodoListIntent': {
      const list = slot(envelope, 'ListName');
      return list
        ? `what's on my ${list} to do list`
        : "what's on my to do list";
    }
    case 'MarkItemCompletedIntent': {
      const item = slot(envelope, 'ItemName');
      const store = slot(envelope, 'StoreName');
      return joinNonEmpty([
        item ? `mark ${item} as done` : 'mark done',
        store ? `on my ${store} shopping list` : 'on my shopping list',
      ]);
    }
    case 'MarkTodoItemCompletedIntent': {
      const item = slot(envelope, 'ItemName');
      const list = slot(envelope, 'ListName');
      return joinNonEmpty([
        item ? `mark ${item} as done` : 'mark done',
        list ? `on my ${list} to do list` : 'on my to do list',
      ]);
    }
    case 'RemoveShoppingItemIntent': {
      const item = slot(envelope, 'ItemName');
      const store = slot(envelope, 'StoreName');
      return joinNonEmpty([
        item ? `remove ${item}` : 'remove',
        store ? `from my ${store} shopping list` : 'from my shopping list',
      ]);
    }
    case 'RemoveTodoItemIntent': {
      const item = slot(envelope, 'ItemName');
      const list = slot(envelope, 'ListName');
      return joinNonEmpty([
        item ? `remove ${item}` : 'remove',
        list ? `from my ${list} to do list` : 'from my to do list',
      ]);
    }
    case 'ClearShoppingCompletedIntent': {
      const store = slot(envelope, 'StoreName');
      return store
        ? `clear completed from my ${store} shopping list`
        : 'clear completed from my shopping list';
    }
    case 'ClearTodoCompletedIntent': {
      const list = slot(envelope, 'ListName');
      return list
        ? `clear completed from my ${list} to do list`
        : 'clear completed from my to do list';
    }
    case 'RequestRideToAppointmentIntent':
      return 'request a ride to my appointment';
    case 'RequestRideToLocationIntent': {
      const dest = slot(envelope, 'Destination');
      return dest ? `request a ride to ${dest}` : 'request a ride';
    }
    case 'SetTransportInfoIntent': {
      const name = slot(envelope, 'TransportName');
      const phone =
        slot(envelope, 'TransportPhone') || slot(envelope, 'PhoneNumber');
      return joinNonEmpty([
        name ? `my transport is ${name}` : 'set transport',
        phone ? `number ${phone}` : '',
      ]);
    }
    case 'SetRiderPhoneIntent': {
      const phone =
        slot(envelope, 'RiderPhone') || slot(envelope, 'PhoneNumber');
      return phone ? `my phone number is ${phone}` : 'set my phone number';
    }
    case 'SetUserNameIntent': {
      const name = slot(envelope, 'UserName');
      return name ? `my name is ${name}` : '';
    }
    case 'SetListVerbosityIntent': {
      const verbosity = slot(envelope, 'Verbosity');
      return verbosity ? `use ${verbosity} lists` : '';
    }
    case 'HelpDomainIntent': {
      return slot(envelope, 'Domain');
    }
    default:
      return '';
  }
}

/**
 * Best-effort spoken text for classify / step parsers.
 * FreeForm first; then intent reconstruction; then generic slot harvest.
 */
function buildSpokenText(handlerInput) {
  const envelope = handlerInput.requestEnvelope;
  const intentName = Alexa.getIntentName(envelope) || '';

  if (intentName === 'AMAZON.YesIntent') return 'yes';
  if (intentName === 'AMAZON.NoIntent') return 'no';
  if (intentName === 'ReplaceConflictingAppointmentIntent') return 'replace';
  if (intentName === 'KeepBothAppointmentsIntent') return 'keep both';

  const freeForm = slot(envelope, 'FreeForm');
  if (freeForm) {
    const ff = freeForm.trim();
    // Tira passes the full transcript as FreeForm, so the Alexa carrier rebuild
    // ("milk to my Target" → "add … list") would corrupt sentences like
    // "request a ride to the library". Only keep the bare "X to my Y list" case.
    if (
      ff &&
      !/\b(add|put)\b/i.test(ff) &&
      /^[^,]+?\s+to\s+(?:my\s+|the\s+)?.+\s+list\b/i.test(ff) &&
      !/\b(ride|go|get|take|drive|pick|appointment|doctor|dr)\b/i.test(ff)
    ) {
      return `add ${ff}`;
    }
    return ff;
  }

  const reconstructed = reconstructFromIntent(envelope, intentName);
  if (reconstructed) return reconstructed;

  return joinSlotValues(envelope, [
    'FreeForm',
    'DoctorName',
    'UserName',
    'Date',
    'Time',
    'Location',
    'Items',
    'ItemName',
    'StoreName',
    'ListName',
    'Domain',
    'Verbosity',
    'Destination',
    'TransportName',
    'TransportPhone',
    'RiderPhone',
    'PhoneNumber',
    'SkipKeyword',
  ]);
}

/** Intents that bypass classify (crisp, low-ambiguity). */
const CRISP_IDLE_INTENTS = new Set([
  'AMAZON.HelpIntent',
  'GreetingIntent',
  'GetUpcomingAppointmentsIntent',
  'GetPastAppointmentsIntent',
  'GetAllAppointmentsIntent',
  'GetUserNameIntent',
  'ClearUserNameIntent',
  'GetListVerbosityIntent',
  'AMAZON.YesIntent',
  'AMAZON.NoIntent',
  'ReplaceConflictingAppointmentIntent',
  'KeepBothAppointmentsIntent',
]);

function isCrispIdleIntent(intentName) {
  return CRISP_IDLE_INTENTS.has(intentName);
}

module.exports = {
  buildSpokenText,
  reconstructFromIntent,
  isCrispIdleIntent,
  CRISP_IDLE_INTENTS,
  joinSlotValues,
};
