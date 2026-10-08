// apps/skill-backend/src/dialogue/prompts.js
// VI-first one-question prompts for dialogue steps

const HELP_BY_DOMAIN = {
  appointments:
    'For appointments, say the doctor, the day, and the time when you can. For example: add an appointment with doctor Smith tomorrow at 2 P.M. Or say: list my appointments. To move one, say: change my appointment with doctor Smith to Friday at 3. You can also say call me Alex. What would you like to do?',
  rides:
    'For rides, I call your transport service and connect you—usually the state or agency service you use for doctor visits. Other services like Uber or Lyft work too if you save them. Say: my transport is, then the service name. Then: my phone number is, then your number. Then: request a ride to my next appointment. What would you like to do?',
  shopping:
    "For shopping, always say the store name. For example: add milk to my Target list. Or say: what's on my Target list. What would you like to do?",
  todos:
    "For to-dos, say the task clearly. For example: add call the pharmacy to my to do list. Or say: what's on my to do list. What would you like to do?",
};

const HELP_MENU =
  'I can help with four things. Appointments for doctor visits. Rides with your transport service for appointments. Shopping lists by store. Or to-do lists. Which one do you want help with—appointments, rides, shopping, or to-dos?';

const OPEN_REPROMPT =
  'Say appointments, rides, shopping, or to-dos. Or say what you want to do.';

/** Shared with AMAZON.FallbackIntent — keep in sync */
const UNCLEAR_SPEECH =
  "Sorry, I didn't catch that. Try a full request. For example: add an appointment with doctor Smith tomorrow at 2 P.M. Or: add milk to my Target list. Or: request a ride to my appointment. Or say help. What would you like to do?";

const UNCLEAR_REPROMPT =
  'Say a full request, like add an appointment, or add milk to my Target list, or say help.';

const WEEKLY_DECLINE_SPEECH =
  "I can't set up recurring or weekly appointments. Please give me a single date and time. For example: add an appointment with Doctor Smith next Thursday at 12 P.M.";

const WEEKLY_DECLINE_REPROMPT =
  "Say a single date and time for one appointment, with the doctor's name.";

function askDoctor() {
  return {
    speak: "What is the name of the doctor? For example, Doctor Smith.",
    reprompt: "Please tell me the doctor's name.",
  };
}

function askDate(doctorName) {
  return {
    speak: `What date is your appointment with ${doctorName}? For example, tomorrow, next Monday, or July 30.`,
    reprompt: `Please tell me the date for your appointment with ${doctorName}.`,
  };
}

function askTime(doctorName) {
  return {
    speak: `What time is your appointment with ${doctorName}? For example, 2 P.M.`,
    reprompt: 'Please tell me the appointment time.',
  };
}

function askLocation(doctorName, date, time) {
  return {
    speak: `I have your appointment with ${doctorName} on ${date} at ${time}. Would you like to add a location? Say a place, skip location, or say skip the rest to finish without location, duration, or reminder.`,
    reprompt: 'Please provide a location, say skip location, or say skip the rest.',
  };
}

function askDuration() {
  return {
    speak: 'How long will your appointment be? It defaults to 1 hour. Say a duration, or say default.',
    reprompt: 'Please tell me the duration, or say default.',
  };
}

function askReminder() {
  return {
    speak:
      'Do you want a reminder before this appointment? Say 15 minutes, 1 hour, 1 day, or no reminder.',
    reprompt: 'Please say 15 minutes, 1 hour, 1 day, or no reminder.',
  };
}

function retryReminder() {
  return {
    speak: 'Please say 15 minutes, 1 hour, 1 day, or no reminder.',
    reprompt: 'Please say 15 minutes, 1 hour, 1 day, or no reminder.',
  };
}

function retryDate() {
  return {
    speak: "I didn't catch the date. Please say a day, like tomorrow, next Monday, or July 30.",
    reprompt: 'Please say the appointment date.',
  };
}

function retryTime() {
  return {
    speak: "I didn't catch the time. Please say a time, like 2 P.M.",
    reprompt: 'Please say the appointment time.',
  };
}

function retryDoctor() {
  return {
    speak: "I didn't catch the doctor's name. Please say the name, for example Doctor Smith.",
    reprompt: "Please tell me the doctor's name.",
  };
}

function cancelledOpen() {
  return {
    speak: 'Okay, I cancelled that. What would you like to do?',
    reprompt: OPEN_REPROMPT,
  };
}

function unclearIdle() {
  return {
    speak: UNCLEAR_SPEECH,
    reprompt: UNCLEAR_REPROMPT,
  };
}

function weeklyDecline() {
  return {
    speak: WEEKLY_DECLINE_SPEECH,
    reprompt: WEEKLY_DECLINE_REPROMPT,
  };
}

/**
 * Re-speak the active dialogue question (context-sensitive Help).
 * @param {{ speak: string, reprompt?: string }} stepPrompt
 */
function contextualHelp(stepPrompt) {
  const body = stepPrompt?.speak || UNCLEAR_SPEECH;
  const reprompt = stepPrompt?.reprompt || OPEN_REPROMPT;
  return {
    speak: `Here's what I need next. ${body} Or say cancel to stop.`,
    reprompt,
  };
}

/**
 * Coach after an empty mid-flow turn (Fallback/Greeting with no spoken text).
 * @param {{ domain?: string|null, step?: string|null }} dialogue
 */
function emptyMidflowCoach(dialogue) {
  const domain = dialogue?.domain;
  const step = dialogue?.step || '';
  if (
    domain === 'shopping' &&
    (step === 'awaiting_items' || step === 'awaiting_more_items')
  ) {
    return {
      speak:
        'I did not catch that. Say add, then the items. For example, add milk. Or say cancel.',
      reprompt: 'Say add, then the items. For example, add milk. Or say cancel.',
    };
  }
  if (
    domain === 'todo' &&
    (step === 'awaiting_items' || step === 'awaiting_more_items')
  ) {
    return {
      speak:
        'I did not catch that. Say add, then the task. For example, add call the pharmacy. Or say cancel.',
      reprompt:
        'Say add, then the task. For example, add call the pharmacy. Or say cancel.',
    };
  }
  if (domain === 'appointment' && step === 'awaiting_doctor') {
    return {
      speak:
        "I did not catch that. Say doctor, then the name. For example, doctor Smith. Or say cancel.",
      reprompt: "Say doctor, then the name. Or say cancel.",
    };
  }
  if (domain === 'appointment' && step === 'awaiting_date') {
    return {
      speak:
        'I did not catch that. Say a date, for example tomorrow or next Monday. Or say cancel.',
      reprompt: 'Say a date, or say cancel.',
    };
  }
  if (domain === 'appointment' && step === 'awaiting_time') {
    return {
      speak:
        'I did not catch that. Say a time, for example 2 P.M. Or say cancel.',
      reprompt: 'Say a time, or say cancel.',
    };
  }
  return {
    speak:
      'I did not catch that. Please answer the question, or say cancel to stop.',
    reprompt: 'Please answer, or say cancel.',
  };
}

function emptyMidflowGiveUp() {
  return {
    speak:
      "I still did not catch that. I've cancelled this for now. Say a full request, like add milk to my Target list, or say help.",
    reprompt: UNCLEAR_REPROMPT,
  };
}

module.exports = {
  HELP_BY_DOMAIN,
  HELP_MENU,
  OPEN_REPROMPT,
  UNCLEAR_SPEECH,
  UNCLEAR_REPROMPT,
  WEEKLY_DECLINE_SPEECH,
  WEEKLY_DECLINE_REPROMPT,
  askDoctor,
  askDate,
  askTime,
  askLocation,
  askDuration,
  askReminder,
  retryReminder,
  retryDate,
  retryTime,
  retryDoctor,
  cancelledOpen,
  unclearIdle,
  weeklyDecline,
  contextualHelp,
  emptyMidflowCoach,
  emptyMidflowGiveUp,
};
