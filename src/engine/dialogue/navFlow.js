// apps/skill-backend/src/dialogue/navFlow.js
// Delete choice + list pagination dialogue (Step 3 delete UX; Step 4 list nav)

const prompts = require('./prompts');
const {
  parseDateAnswer,
  parseTimeAnswer,
  normalizeUtterance,
} = require('./parsers');
const {
  findByDoctor,
  deleteUserAppointment,
  formatAppointmentForSpeech,
  getAppointmentById,
  getAppointmentsByIds,
  LIST_PAGE_SIZE,
  listPageSizeForVerbosity,
} = require('../modules/appointment/appointment.service');
const { getListVerbosity } = require('../modules/profile/profile.service');
const { cancelReminderForAppointment } = require('../libs/remindersClient');
const safeLog = require('../log');

const DELETE_STEPS = {
  DOCTOR: 'awaiting_delete_doctor',
  CHOICE: 'awaiting_delete_choice',
  CONFIRM: 'awaiting_delete_confirm',
};

const LIST_STEPS = {
  NAV: 'awaiting_list_nav',
};

function candidateFromAppointment(apt, index) {
  return {
    index,
    appointmentId: apt.appointmentId,
    doctorName: apt.doctorName,
    date: apt.date,
    time: apt.time,
    dateTime: apt.dateTime,
    location: apt.location,
    durationMinutes: apt.durationMinutes,
  };
}

/**
 * Start multi-match delete choice dialogue.
 * @param {Array} candidates - appointments with doctor/date/time
 */
function startDeleteChoice(candidates = []) {
  return {
    domain: 'delete',
    step: DELETE_STEPS.CHOICE,
    slots: {
      candidates: candidates.map((c, i) => candidateFromAppointment(c, i + 1)),
    },
    promptId: DELETE_STEPS.CHOICE,
  };
}

function startDeleteConfirm(appointment) {
  const selected = candidateFromAppointment(appointment, 1);
  return {
    domain: 'delete',
    step: DELETE_STEPS.CONFIRM,
    slots: {
      selected,
      candidates: [selected],
    },
    promptId: DELETE_STEPS.CONFIRM,
  };
}

function startDeleteDoctorElicit() {
  return {
    domain: 'delete',
    step: DELETE_STEPS.DOCTOR,
    slots: {},
    promptId: DELETE_STEPS.DOCTOR,
  };
}

function promptDeleteDoctor() {
  return {
    speak: "Which doctor's appointment would you like to delete? For example, Doctor Smith.",
    reprompt: "Please say the doctor's name.",
  };
}

function promptDeleteChoice(dialogue) {
  const list = (dialogue.slots.candidates || [])
    .map(
      (c) =>
        `Number ${c.index}: ${c.doctorName} on ${c.date} at ${c.time}`,
    )
    .join('. ');
  return {
    speak: `I found more than one match. ${list}. Say a number, or say the date and time.`,
    reprompt: 'Say number 1, or the date and time of the appointment to delete.',
  };
}

function promptDeleteConfirm(selected) {
  return {
    speak: `Just to confirm: delete ${selected.doctorName} on ${selected.date} at ${selected.time}? Say yes or no.`,
    reprompt: 'Say yes to delete, or no to cancel.',
  };
}

function normalizeTimeToken(t) {
  return String(t || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/\./g, '');
}

function timesLooselyMatch(a, b) {
  const na = normalizeTimeToken(a);
  const nb = normalizeTimeToken(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // "14:00" vs "2:00pm" — compare hour if both parse
  const parseHour = (s) => {
    const m12 = s.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/);
    if (!m12) return null;
    let h = parseInt(m12[1], 10);
    const min = m12[2] || '00';
    const ap = m12[3];
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    return `${h}:${min}`;
  };
  const ha = parseHour(na);
  const hb = parseHour(nb);
  return ha && hb && ha === hb;
}

function datesLooselyMatch(a, b) {
  const sa = String(a || '').toLowerCase().trim();
  const sb = String(b || '').toLowerCase().trim();
  if (!sa || !sb) return false;
  if (sa === sb) return true;
  // YYYY-MM-DD vs spoken fragments already parsed to same form by chrono
  return sa.includes(sb) || sb.includes(sa);
}

/**
 * Match a candidate by spoken number or date/time.
 * @returns {object|null}
 */
function matchDeleteCandidate(candidates, utterance) {
  const text = normalizeUtterance(utterance).toLowerCase();
  if (!text || !(candidates || []).length) return null;

  const num = text.match(/\b(?:number\s+|option\s+|#\s*)?(\d+)\b/);
  if (num) {
    const index = parseInt(num[1], 10);
    const byIndex = candidates.find((c) => c.index === index);
    if (byIndex) return byIndex;
  }

  const parsedDate = parseDateAnswer(text);
  const parsedTime = parseTimeAnswer(text);
  const dateVal = parsedDate?.date || null;
  const timeVal = parsedTime?.time || parsedDate?.time || null;

  const scored = candidates
    .map((c) => {
      let score = 0;
      if (dateVal && datesLooselyMatch(c.date, dateVal)) score += 2;
      if (timeVal && timesLooselyMatch(c.time, timeVal)) score += 2;
      // raw substring fallback
      if (text.includes(String(c.date || '').toLowerCase())) score += 1;
      if (text.includes(String(c.time || '').toLowerCase())) score += 1;
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 1) return scored[0].c;
  if (scored.length > 1 && scored[0].score > scored[1].score) {
    return scored[0].c;
  }
  // Exact date+time both present and unique
  if (dateVal && timeVal) {
    const both = candidates.filter(
      (c) =>
        datesLooselyMatch(c.date, dateVal) && timesLooselyMatch(c.time, timeVal),
    );
    if (both.length === 1) return both[0];
  }
  return null;
}

function cleanDeleteDoctorName(value) {
  return String(value || '')
    .replace(/^(delete|cancel|remove)\s+/i, '')
    .replace(/\b(my|the|an|a)\b/gi, ' ')
    .replace(/\bappointment\b/gi, ' ')
    .replace(/\b(with|of|for)\b/gi, ' ')
    .replace(/^(doctor|dr\.?)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolve delete by doctor name into dialogue or a finished “none found” prompt.
 * @returns {Promise<{ dialogue?, prompt, done }>}
 */
async function beginDeleteByDoctor(userId, doctorName) {
  const normalized = cleanDeleteDoctorName(doctorName);
  if (!normalized) {
    const dialogue = startDeleteDoctorElicit();
    return {
      dialogue,
      done: false,
      prompt: promptDeleteDoctor(),
    };
  }

  const appointments = await findByDoctor(userId, normalized);
  if (appointments.length === 0) {
    return {
      dialogue: { domain: null, step: null, slots: {} },
      done: true,
      prompt: {
        speak: `You don't have any appointments with ${normalized} to delete. What else can I help you with?`,
        reprompt: prompts.OPEN_REPROMPT,
      },
    };
  }

  if (appointments.length === 1) {
    const dialogue = startDeleteConfirm(appointments[0]);
    return {
      dialogue,
      done: false,
      prompt: promptDeleteConfirm(dialogue.slots.selected),
    };
  }

  const dialogue = startDeleteChoice(appointments);
  return {
    dialogue,
    done: false,
    prompt: promptDeleteChoice(dialogue),
  };
}

function startListNav({
  items = [],
  page = 0,
  pageSize = LIST_PAGE_SIZE,
  listKind = 'upcoming',
  verbosity = 'detailed',
} = {}) {
  const appointmentIds = (items || [])
    .map((apt) => apt && apt.appointmentId)
    .filter(Boolean);
  return {
    domain: 'list',
    step: LIST_STEPS.NAV,
    slots: {
      appointmentIds,
      page,
      pageSize,
      listKind,
      verbosity,
    },
    promptId: LIST_STEPS.NAV,
  };
}

/**
 * Build list-nav speech from an in-memory ordered appointment list.
 * Used on the turn that already fetched Dynamo; later turns re-hydrate by id.
 */
function promptListNavFromItems(items, dialogue) {
  const { page, pageSize, listKind, verbosity = 'detailed' } = dialogue.slots;
  const total = (items || []).length;
  const maxPage = Math.max(0, Math.ceil(total / pageSize) - 1);
  const safePage = Math.min(Math.max(0, page || 0), maxPage);
  dialogue.slots.page = safePage;

  const start = safePage * pageSize;
  const slice = (items || []).slice(start, start + pageSize);
  const end = start + slice.length;
  const more = end < total;
  const hasPrev = safePage > 0;

  if (!slice.length) {
    return {
      speak: `There are no more ${listKind} appointments. What else can I help you with?`,
      reprompt: prompts.OPEN_REPROMPT,
      empty: total === 0,
    };
  }

  const lines = slice
    .map(
      (apt, i) =>
        `Number ${start + i + 1}: ${formatAppointmentForSpeech(apt, { verbosity })}`,
    )
    .join('. ');

  let speak =
    listKind === 'matching'
      ? `I found ${total} matching appointment${total === 1 ? '' : 's'}. `
      : `You have ${total} ${listKind} appointment${total === 1 ? '' : 's'}. `;
  speak += `Here are ${start + 1} through ${end} of ${total}. ${lines}.`;

  if (more) {
    speak += ' Say next for more';
    if (hasPrev) speak += ', or previous to go back';
    speak += '.';
  } else if (hasPrev) {
    speak += ' That is the last page. Say previous to go back, or say what you want to do.';
  } else {
    speak += ' What else can I help you with?';
  }

  return {
    speak,
    reprompt: more || hasPrev
      ? 'Say next, previous, or what you want to do.'
      : prompts.OPEN_REPROMPT,
    empty: false,
  };
}

/**
 * Re-hydrate appointments from session ids, then speak the current page.
 * @returns {Promise<{ speak: string, reprompt: string, empty?: boolean }>}
 */
async function promptListNav(dialogue, userId) {
  const ids = dialogue.slots.appointmentIds || [];
  if (!ids.length) {
    return {
      speak: `There are no more ${dialogue.slots.listKind || 'upcoming'} appointments. What else can I help you with?`,
      reprompt: prompts.OPEN_REPROMPT,
      empty: true,
    };
  }
  const items = await getAppointmentsByIds(userId, ids);
  // Drop ids that no longer exist so session stays honest
  dialogue.slots.appointmentIds = items.map((apt) => apt.appointmentId);
  return promptListNavFromItems(items, dialogue);
}

/**
 * Present appointments: short lists in one turn; longer lists use awaiting_list_nav.
 * @returns {{ dialogue, prompt, done }}
 */
function presentAppointmentList(appointments, {
  listKind = 'upcoming',
  emptySpeak = null,
  pageSize = null,
  verbosity = 'detailed',
} = {}) {
  const list = appointments || [];
  const resolvedPageSize =
    pageSize != null ? pageSize : listPageSizeForVerbosity(verbosity);
  if (list.length === 0) {
    return {
      dialogue: { domain: null, step: null, slots: {} },
      done: true,
      prompt: {
        speak:
          emptySpeak ||
          `You have no ${listKind} appointments. What else can I help you with?`,
        reprompt: prompts.OPEN_REPROMPT,
      },
    };
  }

  if (list.length <= resolvedPageSize) {
    const oneLead =
      listKind === 'matching'
        ? 'I found one matching appointment'
        : `You have one ${listKind} appointment`;
    const manyLead =
      listKind === 'matching'
        ? `I found ${list.length} matching appointments`
        : `You have ${list.length} ${listKind} appointments`;
    const body =
      list.length === 1
        ? `${oneLead}: ${formatAppointmentForSpeech(list[0], { verbosity })}.`
        : `${manyLead}: ${list
            .map(
              (apt, idx) =>
                `Number ${idx + 1}: ${formatAppointmentForSpeech(apt, { verbosity })}`,
            )
            .join('. ')}.`;
    return {
      dialogue: { domain: null, step: null, slots: {} },
      done: true,
      prompt: {
        speak: `${body} What else can I help you with?`,
        reprompt: prompts.OPEN_REPROMPT,
      },
    };
  }

  const dialogue = startListNav({
    items: list,
    page: 0,
    pageSize: resolvedPageSize,
    listKind,
    verbosity,
  });
  return {
    dialogue,
    done: false,
    // First page from in-memory list (already fetched this turn)
    prompt: promptListNavFromItems(list, dialogue),
  };
}

/**
 * Apply list presentation to handlerInput session + response.
 * Loads list verbosity from profile when not provided.
 */
async function respondWithAppointmentList(handlerInput, appointments, options = {}) {
  const { setDialogue, clearDialogue } = require('./state');
  const userId =
    handlerInput.requestEnvelope.context?.System?.user?.userId ||
    handlerInput.requestEnvelope.session?.user?.userId;
  let verbosity = options.verbosity;
  if (!verbosity && userId) {
    try {
      verbosity = await getListVerbosity(userId);
    } catch (e) {
      verbosity = 'detailed';
    }
  }
  verbosity = verbosity || 'detailed';
  const pageSize =
    options.pageSize != null
      ? options.pageSize
      : listPageSizeForVerbosity(verbosity);
  const result = presentAppointmentList(appointments, {
    ...options,
    verbosity,
    pageSize,
  });
  let session = handlerInput.attributesManager.getSessionAttributes();
  if (result.done) {
    session = clearDialogue(session);
  } else {
    session = clearDialogue(session);
    session = setDialogue(session, result.dialogue);
  }
  handlerInput.attributesManager.setSessionAttributes(session);
  return handlerInput.responseBuilder
    .speak(result.prompt.speak)
    .reprompt(result.prompt.reprompt)
    .getResponse();
}

/**
 * Apply answer for delete/list dialogue domains.
 * @returns {Promise<{ dialogue, prompt, done }>}
 */
async function applyNavAnswer(handlerInput, dialogue, utterance) {
  const text = normalizeUtterance(utterance).toLowerCase();
  const userId =
    handlerInput.requestEnvelope.context?.System?.user?.userId ||
    handlerInput.requestEnvelope.session?.user?.userId;

  if (dialogue.domain === 'delete' && dialogue.step === DELETE_STEPS.DOCTOR) {
    const name = cleanDeleteDoctorName(utterance);
    if (!name) {
      return { dialogue, done: false, prompt: promptDeleteDoctor() };
    }
    return beginDeleteByDoctor(userId, name);
  }

  if (dialogue.domain === 'delete' && dialogue.step === DELETE_STEPS.CHOICE) {
    const match = matchDeleteCandidate(dialogue.slots.candidates || [], utterance);
    if (match) {
      dialogue.slots.selected = match;
      dialogue.step = DELETE_STEPS.CONFIRM;
      dialogue.promptId = dialogue.step;
      return {
        dialogue,
        done: false,
        prompt: promptDeleteConfirm(match),
      };
    }
    return {
      dialogue,
      done: false,
      prompt: {
        speak: `I didn't catch which one. ${promptDeleteChoice(dialogue).speak}`,
        reprompt: promptDeleteChoice(dialogue).reprompt,
      },
    };
  }

  if (dialogue.domain === 'delete' && dialogue.step === DELETE_STEPS.CONFIRM) {
    if (/^(yes|yeah|yep|confirm|delete)\b/.test(text) || /\byes\b/.test(text)) {
      const selected = dialogue.slots.selected;
      if (!selected?.appointmentId) {
        return {
          dialogue: { domain: null, step: null, slots: {} },
          done: true,
          prompt: {
            speak: 'I could not tell which appointment to delete. What else can I help you with?',
            reprompt: prompts.OPEN_REPROMPT,
          },
        };
      }
      try {
        const full = await getAppointmentById(userId, selected.appointmentId);
        if (!full) {
          return {
            dialogue: { domain: null, step: null, slots: {} },
            done: true,
            prompt: {
              speak:
                'I could not find that appointment anymore. What else can I help you with?',
              reprompt: prompts.OPEN_REPROMPT,
            },
          };
        }
        await cancelReminderForAppointment(handlerInput, full);
        await deleteUserAppointment(userId, full.appointmentId);
        return {
          dialogue: { domain: null, step: null, slots: {} },
          done: true,
          prompt: {
            speak: `I have deleted ${formatAppointmentForSpeech(full)}. What else can I help you with?`,
            reprompt: prompts.OPEN_REPROMPT,
          },
        };
      } catch (e) {
        safeLog.error('delete_appointment_failed', {
          errorMessage: e?.message,
          errorName: e?.name,
        });
        return {
          dialogue: { domain: null, step: null, slots: {} },
          done: true,
          prompt: {
            speak:
              'I could not delete that appointment. Please try again in a moment. What else can I help you with?',
            reprompt: prompts.OPEN_REPROMPT,
          },
        };
      }
    }
    if (/^(no|nope|cancel)\b/.test(text) || /\b(no|cancel|keep)\b/.test(text)) {
      return {
        dialogue: { domain: null, step: null, slots: {} },
        done: true,
        prompt: {
          speak: 'Okay, I will not delete that appointment. What else can I help you with?',
          reprompt: prompts.OPEN_REPROMPT,
        },
      };
    }
    return {
      dialogue,
      done: false,
      prompt: {
        speak: 'Say yes to delete, or no to cancel.',
        reprompt: 'Say yes or no.',
      },
    };
  }

  if (dialogue.domain === 'list' && dialogue.step === LIST_STEPS.NAV) {
    const pageSize = dialogue.slots.pageSize || LIST_PAGE_SIZE;
    const total = (dialogue.slots.appointmentIds || []).length;
    const maxPage = Math.max(0, Math.ceil(total / pageSize) - 1);

    if (/\bnext\b/.test(text)) {
      dialogue.slots.page = Math.min(maxPage, (dialogue.slots.page || 0) + 1);
    } else if (/\b(previous|back)\b/.test(text)) {
      dialogue.slots.page = Math.max(0, (dialogue.slots.page || 0) - 1);
    }

    const prompt = await promptListNav(dialogue, userId);
    if (prompt.empty) {
      return {
        dialogue: { domain: null, step: null, slots: {} },
        done: true,
        prompt: {
          speak: prompt.speak,
          reprompt: prompt.reprompt,
        },
      };
    }
    return { dialogue, done: false, prompt };
  }

  return {
    dialogue: { domain: null, step: null, slots: {} },
    done: true,
    prompt: prompts.unclearIdle(),
  };
}

module.exports = {
  DELETE_STEPS,
  LIST_STEPS,
  startDeleteChoice,
  startDeleteConfirm,
  startDeleteDoctorElicit,
  promptDeleteChoice,
  promptDeleteConfirm,
  promptDeleteDoctor,
  matchDeleteCandidate,
  cleanDeleteDoctorName,
  beginDeleteByDoctor,
  startListNav,
  promptListNav,
  promptListNavFromItems,
  presentAppointmentList,
  respondWithAppointmentList,
  applyNavAnswer,
};
