// apps/skill-backend/src/dialogue/classify.js
// Local-first intent classification when dialogue is idle (no LLM)

const { parseFreeForm } = require('../smart-logic/smartDateParser');
const {
  parseHelpDomain,
  parseNameAnswer,
  parseListVerbosityAnswer,
  normalizeUtterance,
  sanitizeDoctorName,
  utteranceHasExplicitTime,
} = require('./parsers');
const {
  isPastAppointmentsQuery,
  isRecurringAppointmentRequest,
  parseRideUtterance,
  parseRemoveOrClearUtterance,
  parseMarkCompleteUtterance,
  parseGetListUtterance,
  parseTodoAddUtterance,
  parseShoppingAddUtterance,
} = require('./classifyParsers');

/** Actions that start a new feature goal (used for mid-flow feature switching). */
const FEATURE_SWITCH_ACTIONS = new Set([
  'help_menu',
  'help_domain',
  'set_name',
  'get_name',
  'clear_name',
  'set_list_verbosity',
  'get_list_verbosity',
  // greeting intentionally omitted — mid-flow "hi" should not abandon add
  'add_appointment',
  'list_appointments',
  'list_past_appointments',
  'list_all_appointments',
  'find_by_doctor',
  'delete_appointment',
  'reschedule_appointment',
  'decline_recurring_appointment',
  'add_todo',
  'get_todo',
  'mark_todo_done',
  'remove_todo_item',
  'clear_todo_completed',
  'add_shopping',
  'get_shopping',
  'mark_shopping_done',
  'remove_shopping_item',
  'clear_shopping_completed',
  'request_ride_appointment',
  'request_ride_location',
  'set_transport',
  'set_rider_phone',
]);

const DATE_CUE =
  /\b(yesterday|today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|\d)\b/;

function extractDoctorFromUtterance(text) {
  const m =
    text.match(/\b(?:Dr\.?|Doctor)\s+([A-Za-z]+(?:'[A-Za-z]+)?)/i) ||
    text.match(/\bwith\s+(?:Dr\.?|Doctor)\s+([A-Za-z]+(?:'[A-Za-z]+)?)/i) ||
    text.match(/\b(?:with|for)\s+([A-Za-z]+(?:'[A-Za-z]+)?)\b/i);
  if (!m) return null;
  const candidate = m[1];
  if (
    /^(my|the|an|a|me|him|her|them|next|this|doctor|dr)$/i.test(candidate)
  ) {
    // "with doctor smith" — first with-capture may be "doctor"; try again after title
    const afterTitle = text.match(
      /\b(?:with|for)\s+(?:Dr\.?|Doctor)\s+([A-Za-z]+(?:'[A-Za-z]+)?)/i,
    );
    if (afterTitle) return sanitizeDoctorName(afterTitle[1]);
    return null;
  }
  return sanitizeDoctorName(candidate);
}

/**
 * @returns {{ action: string, slots?: Object } | null}
 */
function classifyIdleUtterance(text) {
  const u = normalizeUtterance(text).toLowerCase();
  if (!u) return null;

  // Name get / clear / set (before greeting so "hi" is separate)
  if (
    /\b(what do you call me|what'?s my name|what is my name|do you know my name)\b/.test(
      u,
    )
  ) {
    return { action: 'get_name' };
  }
  if (
    /\b(forget my name|clear my name|erase my name|remove my name|don'?t (use|call me by) my name)\b/.test(
      u,
    )
  ) {
    return { action: 'clear_name' };
  }
  if (
    /^(?:my name is|call me|i am|i'm|set my name to|remember my name as|change my name to)\s+/.test(
      u,
    )
  ) {
    const userName = parseNameAnswer(text);
    if (userName) {
      return { action: 'set_name', slots: { userName } };
    }
  }

  // List verbosity preference
  if (
    /\b(use|set|switch to|make)\b.*\b(brief|short|detailed|longer)\b.*\b(list|lists|mode|speech|readings?)\b/.test(
      u,
    ) ||
    /^(use )?(brief|detailed) lists?\b/.test(u) ||
    /^be (brief|more detailed|detailed)\b/.test(u) ||
    /\b(speak|read)\s+(briefly|in detail)\b/.test(u)
  ) {
    const verbosity = parseListVerbosityAnswer(text);
    if (verbosity) {
      return { action: 'set_list_verbosity', slots: { verbosity } };
    }
  }
  if (
    /\b(are you brief or detailed|what is my list (mode|setting)|how detailed (are|is) (my )?lists?|list (mode|verbosity|setting))\b/.test(
      u,
    )
  ) {
    return { action: 'get_list_verbosity' };
  }

  // Greeting
  if (/^(hi|hello|hey|good (morning|afternoon|evening))\b/.test(u)) {
    return { action: 'greeting' };
  }

  // Help domain word alone
  const domain = parseHelpDomain(u);
  if (
    domain &&
    /^(appointments?|rides?|transport|shopping|to-?dos?|todos?|to do)$/.test(u)
  ) {
    return { action: 'help_domain', slots: { domain } };
  }

  if (/^help\b/.test(u) || u === 'what can you do') {
    return { action: 'help_menu' };
  }

  // Rides setup + request (before list/get so "ride" is not lost)
  const ride = parseRideUtterance(text, u);
  if (ride) return ride;

  // Weekly / recurring — decline before add/list steals the utterance
  if (isRecurringAppointmentRequest(u)) {
    return { action: 'decline_recurring_appointment' };
  }

  // Remove item / clear completed (before mark — different verbs)
  const removeOrClear = parseRemoveOrClearUtterance(text, u);
  if (removeOrClear) return removeOrClear;

  // Mark complete (before get/add)
  const mark = parseMarkCompleteUtterance(text, u);
  if (mark) return mark;

  // To-do / shopping add before get (so "shopping list for Target" is add, not get)
  const todoAdd = parseTodoAddUtterance(text, u);
  if (todoAdd) return todoAdd;

  const shoppingAdd = parseShoppingAddUtterance(text, u);
  if (shoppingAdd) {
    const blob = `${shoppingAdd.slots?.items || ''} ${u}`;
    // Do not let shopping steal "add a doctor appointment" (Items / reconstructed text)
    if (
      !/\b(appointments?|appoinments?|dr\.?|doctor|checkup)\b/i.test(blob)
    ) {
      return shoppingAdd;
    }
  }

  // Get lists
  const getList = parseGetListUtterance(text, u);
  if (getList) return getList;

  // Past appointments (before upcoming "what appointments")
  if (isPastAppointmentsQuery(u)) {
    return { action: 'list_past_appointments' };
  }
  if (
    (/\ball\b/.test(u) && /\bappointments?\b/.test(u)) ||
    /\b(list|show)\s+all\b.*\bappointments?\b/.test(u)
  ) {
    return { action: 'list_all_appointments' };
  }

  // List upcoming appointments (before find — "when is my next appointment")
  // Do not treat "…appointment… shopping list" / add phrases as a list query.
  if (
    !/\b(add|put|create|schedule|book|make|need|set\s*up)\b/.test(u) &&
    !/\bshopping\s+lists?\b/.test(u) &&
    (
      /\bwhen is my (next )?appointments?\b/.test(u) ||
      /\b(do i have|check|tell me|read)\b.*\bappointments?\b/.test(u) ||
      (/\b(list|show|get|what|give me)\b/.test(u) && /\bappointments?\b/.test(u)) ||
      /\bupcoming\b.*\bappointments?\b/.test(u) ||
      /\bmy next appointment\b/.test(u)
    )
  ) {
    return { action: 'list_appointments' };
  }

  // Delete (plural appointments; also "delete doctor X" without appointment word)
  if (
    (/\b(delete|cancel|remove)\b/.test(u) && /\bappointments?\b/.test(u)) ||
    (/\b(delete|cancel|remove)\b/.test(u) && /\b(dr\.?|doctor)\b/.test(u))
  ) {
    const m = text.match(/\b(?:Dr\.?|Doctor)\s+([A-Za-z]+(?:'[A-Za-z]+)?)/i);
    const cleaned = String(text || '')
      .replace(/^(delete|cancel|remove)\s+/i, '')
      .replace(/\b(my|the|an|a)\b/gi, ' ')
      .replace(/\bappointments?\b/gi, ' ')
      .replace(/\b(with|of|for)\b/gi, ' ')
      .replace(/^(doctor|dr\.?)\s+/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    return {
      action: 'delete_appointment',
      slots: {
        doctorName: sanitizeDoctorName(m ? m[1] : cleaned) || null,
        raw: text,
      },
    };
  }

  // Reschedule / change / move (before find/add)
  if (
    (/\b(change|reschedule|move|update)\b/.test(u) &&
      /\bappointments?\b/.test(u)) ||
    (/\b(change|reschedule|move|update)\b/.test(u) && /\b(dr\.?|doctor)\b/.test(u))
  ) {
    const m = text.match(/\b(?:Dr\.?|Doctor)\s+([A-Za-z]+(?:'[A-Za-z]+)?)/i);
    let doctorName = m ? sanitizeDoctorName(m[1]) : null;
    if (!doctorName) {
      doctorName = extractDoctorFromUtterance(text);
    }
    // Prefer date/time after "to" / "for"
    const toPart =
      text.match(/\b(?:to|for)\s+(.+)$/i) ||
      text.match(/\b(?:on|at)\s+(.+)$/i);
    const parseTarget = toPart ? toPart[1] : text;
    const parsed = parseFreeForm(parseTarget);
    const slots = { doctorName, raw: text };
    if (parsed.date) slots.date = parsed.date;
    if (
      parsed.time &&
      /\b(\d|noon|midnight|a\.?m\.?|p\.?m\.?)\b/i.test(parseTarget)
    ) {
      slots.time = parsed.time;
    }
    return { action: 'reschedule_appointment', slots };
  }

  // Find by doctor — require doctor/appointment cues (not bare "find milk")
  if (
    (/^(find|search|look up)\b/.test(u) &&
      (/\bappointments?\b/.test(u) || /\b(dr\.?|doctor)\b/.test(u))) ||
    /\b(when do i see|when is my appointment with)\b/.test(u)
  ) {
    const doctorName = extractDoctorFromUtterance(text);
    return {
      action: 'find_by_doctor',
      slots: { doctorName: doctorName || null, raw: text },
    };
  }

  // Bare or partial add appointment (incl. FreeForm remainders with doctor+date)
  const addVerb =
    /\b(add|schedule|book|create|make|need|set\s*up|set up)\b/.test(u) ||
    /\bnew\b/.test(u);
  const appointmentCue =
    /\bappointments?\b|\bappoinments?\b|\bcheckup\b|\bcheck-?up\b/.test(u);
  const doctorCue = /\b(dr\.?|doctor)\b/.test(u);
  const seeVisitDoctor =
    /\b(see|visit|meet)\b/.test(u) && /\b(dr\.?|doctor)\b/.test(u);
  const doctorWithDate =
    doctorCue &&
    DATE_CUE.test(u) &&
    !/\b(list|show|find|delete|remove|what|ride|transport)\b/.test(u);
  // Truncated FreeForm remainder: "with Dr Smith tomorrow at 3"
  const remainderAdd =
    /\bwith\b/.test(u) &&
    (doctorCue || /\b[a-z]+(?:'[a-z]+)?\b/.test(u)) &&
    DATE_CUE.test(u) &&
    !/\b(list|show|find|delete|remove|ride|transport)\b/.test(u);

  if (
    (addVerb &&
      appointmentCue &&
      !/\b(show|find|delete|remove|what|upcoming|past)\b/.test(u) &&
      // "list" alone steals, but "shopping list" + appointment is still an add
      !( /\blist\b/.test(u) && !/\b(shopping|grocery|appointments?|appoinments?)\b/.test(u) )) ||
    (addVerb && doctorCue && !appointmentCue && !/\b(list|show|find|delete|remove)\b/.test(u)) ||
    seeVisitDoctor ||
    doctorWithDate ||
    remainderAdd
  ) {
    const parsed = parseFreeForm(text);
    // "doctor appointment" is a type of visit, not a doctor named Appointment
    const hasDoctorCue =
      /\bwith\b/.test(u) ||
      /\bfor\b/.test(u) ||
      (/\b(dr\.?|doctor)\b/.test(u) &&
        !/\b(dr\.?|doctor)(?:'s)?\s+appointments?\b/.test(u) &&
        !/\b(dr\.?|doctor)(?:'s)?\s+appoinments?\b/.test(u));
    const slots = {};
    let doctorName = null;
    if (hasDoctorCue && parsed.doctorName) {
      doctorName = sanitizeDoctorName(parsed.doctorName);
    }
    if (!doctorName && hasDoctorCue) {
      doctorName = extractDoctorFromUtterance(text);
    }
    if (doctorName) slots.doctorName = doctorName;
    if (parsed.date) slots.date = parsed.date;
    if (parsed.time && utteranceHasExplicitTime(text)) {
      slots.time = parsed.time;
    }
    if (
      !hasDoctorCue &&
      !DATE_CUE.test(u)
    ) {
      delete slots.date;
      delete slots.time;
    }
    return { action: 'add_appointment', slots };
  }

  return null;
}

/**
 * Mid-flow: clear current dialogue and start another feature when utterance is a clear new goal.
 */
function shouldSwitchFromActiveDialogue(dialogue, classified) {
  if (!classified || !dialogue?.step) return false;
  if (!FEATURE_SWITCH_ACTIONS.has(classified.action)) return false;

  // Stay in help domain elicitation
  if (
    dialogue.domain === 'help' &&
    (classified.action === 'help_domain' || classified.action === 'help_menu')
  ) {
    return false;
  }
  // Stay in shopping/todo only for the same mode (don't treat mark/remove as add-more answers)
  if (dialogue.domain === 'shopping') {
    const mode = dialogue.slots?.mode;
    if (classified.action === 'add_shopping' && (!mode || mode === 'add')) return false;
    if (classified.action === 'mark_shopping_done' && mode === 'mark') return false;
    if (classified.action === 'remove_shopping_item' && mode === 'remove') return false;
    if (classified.action === 'clear_shopping_completed' && mode === 'clear') return false;
    if (classified.action === 'get_shopping' && mode === 'read') return false;
  }
  if (dialogue.domain === 'todo') {
    const mode = dialogue.slots?.mode;
    if (classified.action === 'add_todo' && (!mode || mode === 'add')) return false;
    if (classified.action === 'mark_todo_done' && mode === 'mark') return false;
    if (classified.action === 'remove_todo_item' && mode === 'remove') return false;
    if (classified.action === 'clear_todo_completed' && mode === 'clear') return false;
    if (classified.action === 'get_todo' && mode === 'read') return false;
  }
  if (
    dialogue.domain === 'ride' &&
    (classified.action === 'request_ride_appointment' ||
      classified.action === 'request_ride_location' ||
      classified.action === 'set_transport' ||
      classified.action === 'set_rider_phone')
  ) {
    return false;
  }
  if (
    dialogue.domain === 'reschedule' &&
    classified.action === 'reschedule_appointment'
  ) {
    return false;
  }
  // Appointment add mid-flow: Alexa often rebuilds answers as add ("doctor Mason", "for PT1H", "remind me P1D")
  if (dialogue.domain === 'appointment' && classified.action === 'add_appointment') {
    return false;
  }

  return true;
}

module.exports = {
  classifyIdleUtterance,
  shouldSwitchFromActiveDialogue,
  FEATURE_SWITCH_ACTIONS,
};
