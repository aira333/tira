// Profile business logic for personalization.

const {
  cleanUserName,
  getUserProfile,
  saveUserProfile,
  upsertUserProfile,
  normalizeListVerbosity,
  LIST_VERBOSITY,
} = require('../../store');

async function getPersonalizedName(userId) {
  const profile = await getUserProfile(userId);
  return profile?.userName || null;
}

async function setPersonalizedName(userId, userName) {
  return upsertUserProfile(userId, { userName });
}

async function clearPersonalizedName(userId) {
  return upsertUserProfile(userId, { userName: null });
}

async function getListVerbosity(userId) {
  const profile = await getUserProfile(userId);
  return normalizeListVerbosity(profile?.listVerbosity);
}

async function setListVerbosity(userId, verbosity) {
  return upsertUserProfile(userId, {
    listVerbosity: normalizeListVerbosity(verbosity),
  });
}

function greetingForName(userName) {
  if (userName) {
    return `Hi ${userName}. How can I help you today?`;
  }
  return 'Hi. How can I help you today? You can also tell me your name if you would like a personalized greeting.';
}

function speechForNameQuery(userName) {
  if (userName) {
    return `I call you ${userName}. You can say change my name to a new name, or forget my name.`;
  }
  return 'I do not have a name for you yet. Say call me, then your name. For example: call me Alex.';
}

function speechForVerbosity(verbosity) {
  const mode = normalizeListVerbosity(verbosity);
  if (mode === LIST_VERBOSITY.BRIEF) {
    return (
      'Appointment lists are brief: doctor, day, and time only, up to five per page. ' +
      'Say use detailed lists anytime for location and length.'
    );
  }
  return (
    'Appointment lists are detailed: doctor, day, time, location, and length, three per page. ' +
    'Say use brief lists anytime for shorter readings.'
  );
}

function speechForVerbositySet(verbosity) {
  const mode = normalizeListVerbosity(verbosity);
  if (mode === LIST_VERBOSITY.BRIEF) {
    return (
      'Okay. I will use brief appointment lists—doctor, day, and time only—and read up to five at a time. ' +
      'What else can I help you with?'
    );
  }
  return (
    'Okay. I will use detailed appointment lists with location and length, three at a time. ' +
    'What else can I help you with?'
  );
}

module.exports = {
  LIST_VERBOSITY,
  cleanUserName,
  normalizeListVerbosity,
  getPersonalizedName,
  setPersonalizedName,
  clearPersonalizedName,
  getListVerbosity,
  setListVerbosity,
  greetingForName,
  speechForNameQuery,
  speechForVerbosity,
  speechForVerbositySet,
  saveUserProfile,
  upsertUserProfile,
};
