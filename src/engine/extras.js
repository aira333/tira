// src/engine/extras.js
// Phone-only skills layered in front of the Day Buddy engine:
// daily briefing, what's next, time/date, repeat, thanks.

const store = require('./store');
const brand = require('./brand');

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const BRIEFING_RE =
  /^(?:(?:good )?(?:morning|afternoon|evening)[,. ]+)?(?:what(?:'s| is) (?:my day(?: look(?:ing)? like)?|on (?:for )?today|(?:my )?(?:plan|schedule|agenda) (?:for )?today|happening today)|what do i have (?:on |going on )?today|(?:give me )?(?:my )?(?:daily )?(?:briefing|summary|rundown)|how(?:'s| is| does) my day(?: look(?:ing)?)?|brief me|plan my day|my day)[.?!]*$/i;
const NEXT_RE = /^(?:what(?:'s| is) next|what(?:'s| is) (?:my )?next (?:appointment|thing|up)|when is my next appointment|what(?:'s| is) up next|up next)[.?!]*$/i;
const TIME_RE = /^(?:what(?:'s| is) the time|what time is it(?: now)?|tell me the time|time please|the time)[.?!]*$/i;
const DATE_RE = /^(?:what(?:'s| is) (?:the date|today'?s date|today)|what day is (?:it|today)|what(?:'s| is) the day today|today'?s date)[.?!]*$/i;
const REPEAT_RE = /^(?:repeat(?: that)?(?: please)?|say (?:that|it) again|what did you say|come again|pardon|sorry what|once more|again)[.?!]*$/i;
const THANKS_RE = /^(?:thanks?(?: you)?(?: (?:so|very) much)?|thank you(?: tira)?|thx|cheers|great|awesome|perfect)[.!]*$/i;

function partOfDay(d = new Date()) {
  const h = d.getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

function spokenDate(d = new Date()) {
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function spokenTime(d) {
  const h = d.getHours();
  const m = d.getMinutes();
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

function doctor(name) {
  const n = String(name || '').trim();
  if (!n) return 'your doctor';
  const cased = n.replace(/\b([a-z])/g, (c) => c.toUpperCase());
  return /^(dr\.?|doctor)\b/i.test(cased) ? cased : `Doctor ${cased}`;
}

function realLocation(loc) {
  const l = String(loc || '').trim();
  return l && !/^(not specified|none|no location)$/i.test(l) ? l : '';
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function listWords(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

async function upcoming(userId) {
  return store.queryAppointmentsByDateRange(userId, { fromIso: new Date().toISOString() });
}

async function pendingCounts(userId) {
  const [shopping, todos] = await Promise.all([
    store.getAllShoppingLists(userId),
    store.getAllTodoLists(userId),
  ]);
  const count = (lists) =>
    lists.reduce((n, l) => n + (l.items || []).filter((i) => !i.completed).length, 0);
  return { shopping: count(shopping), todos: count(todos) };
}

/** Spoken + structured summary of the user's day. Also used by the app's home card. */
async function buildBriefing(userId, now = new Date()) {
  const [apts, counts, profile] = await Promise.all([
    upcoming(userId),
    pendingCounts(userId),
    store.getUserProfile(userId),
  ]);
  const today = apts.filter((a) => sameDay(new Date(a.dateTime), now));
  const later = apts.filter((a) => !sameDay(new Date(a.dateTime), now));

  const name = profile?.userName ? `, ${profile.userName}` : '';
  const parts = [`Good ${partOfDay(now)}${name}. Today is ${spokenDate(now)}.`];

  if (today.length) {
    const desc = today.map((a) => {
      const loc = realLocation(a.location);
      return `${doctor(a.doctorName)} at ${spokenTime(new Date(a.dateTime))}${loc ? ` at ${loc}` : ''}`;
    });
    parts.push(`You have ${plural(today.length, 'appointment', 'appointments')} today: ${listWords(desc)}.`);
  } else {
    parts.push('You have no appointments today.');
    if (later[0]) {
      const d = new Date(later[0].dateTime);
      parts.push(`Your next one is with ${doctor(later[0].doctorName)} on ${spokenDate(d)} at ${spokenTime(d)}.`);
    }
  }

  const listBits = [];
  if (counts.todos) listBits.push(plural(counts.todos, 'to-do', 'to-dos'));
  if (counts.shopping) listBits.push(plural(counts.shopping, 'item', 'items') + ' to buy');
  if (listBits.length) parts.push(`You also have ${listWords(listBits)}.`);

  return {
    speech: `${parts.join(' ')} What would you like to do?`,
    todayAppointments: today,
    nextAppointment: apts[0] || null,
    counts,
    userName: profile?.userName || null,
  };
}

async function nextAppointmentSpeech(userId) {
  const apts = await upcoming(userId);
  if (!apts.length) {
    return 'You have no upcoming appointments. Say add an appointment to create one.';
  }
  const a = apts[0];
  const d = new Date(a.dateTime);
  const when = sameDay(d, new Date()) ? `today at ${spokenTime(d)}` : `${spokenDate(d)} at ${spokenTime(d)}`;
  const loc = realLocation(a.location);
  return `Your next appointment is with ${doctor(a.doctorName)} ${when}${loc ? ` at ${loc}` : ''}. What else can I help you with?`;
}

/**
 * Try the phone-only skills. Returns a reply, or null to fall through to the engine.
 * @param {string} text  utterance with the wake word already removed
 * @param {{ userId: string, midDialogue: boolean, lastReply: object|null }} ctx
 */
async function handleExtras(text, ctx) {
  const t = text.trim();

  // Repeat works anywhere, including mid-question.
  if (REPEAT_RE.test(t)) {
    if (!ctx.lastReply?.speech) return reply("I haven't said anything yet. What would you like to do?");
    return { ...ctx.lastReply, repeated: true };
  }

  // The rest only when Tira isn't waiting for an answer.
  if (ctx.midDialogue) return null;

  if (BRIEFING_RE.test(t)) return reply((await buildBriefing(ctx.userId)).speech);
  if (NEXT_RE.test(t)) return reply(await nextAppointmentSpeech(ctx.userId));
  if (TIME_RE.test(t)) return reply(`It's ${spokenTime(new Date())}.`);
  if (DATE_RE.test(t)) return reply(`Today is ${spokenDate(new Date())}, ${new Date().getFullYear()}.`);
  if (THANKS_RE.test(t)) return reply(`You're welcome! ${brand.displayName} is here whenever you need me.`);
  return null;
}

function reply(speech) {
  return { speech, reprompt: 'What would you like to do?', endSession: false, needsNotificationPermission: false };
}

module.exports = {
  handleExtras,
  buildBriefing,
  partOfDay,
  spokenDate,
  spokenTime,
};
