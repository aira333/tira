// apps/skill-backend/src/dialogue/state.js
// Session dialogue state for VI multi-turn intake

const DIALOGUE_KEY = 'dialogue';

/**
 * @typedef {Object} DialogueState
 * @property {string|null} domain
 * @property {string|null} step
 * @property {Object} slots
 * @property {string|null} [promptId]
 */

function emptyDialogue() {
  return {
    domain: null,
    step: null,
    slots: {},
    promptId: null,
    emptyMissCount: 0,
  };
}

function getDialogue(sessionAttributes = {}) {
  const d = sessionAttributes[DIALOGUE_KEY];
  if (!d || typeof d !== 'object') {
    return emptyDialogue();
  }
  return {
    domain: d.domain || null,
    step: d.step || null,
    slots: d.slots && typeof d.slots === 'object' ? { ...d.slots } : {},
    promptId: d.promptId || null,
    emptyMissCount: Number(d.emptyMissCount) > 0 ? Number(d.emptyMissCount) : 0,
  };
}

function setDialogue(sessionAttributes, dialogue) {
  const next = { ...sessionAttributes };
  if (!dialogue || (!dialogue.step && !dialogue.domain)) {
    delete next[DIALOGUE_KEY];
    return next;
  }
  const payload = {
    domain: dialogue.domain || null,
    step: dialogue.step || null,
    slots: dialogue.slots ? { ...dialogue.slots } : {},
    promptId: dialogue.promptId || null,
  };
  const misses = Number(dialogue.emptyMissCount) || 0;
  if (misses > 0) payload.emptyMissCount = misses;
  next[DIALOGUE_KEY] = payload;
  return next;
}

function clearDialogue(sessionAttributes = {}) {
  const next = { ...sessionAttributes };
  delete next[DIALOGUE_KEY];
  // Legacy appointment add
  delete next.pendingAddAppointment;
  delete next.doctorName;
  delete next.date;
  delete next.time;
  delete next.location;
  delete next.duration;
  delete next.reminderTime;
  delete next.promptedLocation;
  delete next.promptedDuration;
  delete next.promptedReminder;
  delete next.pendingConflictOverride;
  delete next.pendingConflictAppointment;
  delete next.confirmedConflict;
  delete next.ignoreCurrentSlots;
  delete next.replacedConflictAppointment;
  delete next.pendingHelpDomain;
  // Legacy delete elicit / confirm
  delete next.pendingDeleteAppointment;
  delete next.pendingDeleteConfirmation;
  delete next.pendingDeleteCandidates;
  // Legacy shopping / todo elicit
  delete next.shoppingItems;
  delete next.shoppingStoreName;
  delete next.shoppingItemName;
  delete next.todoItems;
  delete next.todoListName;
  delete next.todoItemName;
  // Legacy ride elicit
  delete next.waitingForRidePickupDate;
  delete next.waitingForRidePickupTime;
  delete next.waitingToCall;
  delete next.pendingRidePickup;
  delete next.pendingRideCall;
  delete next.pendingRideAmbiguousTime;
  return next;
}

function hasActiveStep(sessionAttributes) {
  const d = getDialogue(sessionAttributes);
  return Boolean(d.step);
}

module.exports = {
  DIALOGUE_KEY,
  emptyDialogue,
  getDialogue,
  setDialogue,
  clearDialogue,
  hasActiveStep,
};
