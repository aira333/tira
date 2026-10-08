// apps/skill-backend/src/dialogue/listShared.js
// Shared shopping/todo dialogue helpers (extracted from listFlow.js)

const prompts = require('./prompts');
const { normalizeUtterance } = require('./parsers');

const SHOPPING_STEPS = {
  STORE: 'awaiting_store',
  ITEMS: 'awaiting_items',
  MORE: 'awaiting_more_items',
  MARK_STORE: 'awaiting_mark_store',
  MARK_ITEM: 'awaiting_mark_item',
  REMOVE_STORE: 'awaiting_remove_store',
  REMOVE_ITEM: 'awaiting_remove_item',
  CLEAR_STORE: 'awaiting_clear_store',
  READ_PAGE: 'awaiting_list_page',
};

const TODO_STEPS = {
  LIST: 'awaiting_list',
  ITEMS: 'awaiting_items',
  MORE: 'awaiting_more_items',
  MARK_LIST: 'awaiting_mark_list',
  MARK_ITEM: 'awaiting_mark_item',
  REMOVE_LIST: 'awaiting_remove_list',
  REMOVE_ITEM: 'awaiting_remove_item',
  CLEAR_LIST: 'awaiting_clear_list',
  READ_PAGE: 'awaiting_list_page',
};

function formatSpeech(result) {
  if (!result) return "I couldn't find that list.";
  return typeof result === 'string' ? result : result.speech;
}

function isNextPageUtterance(text) {
  const t = normalizeUtterance(text).toLowerCase();
  return /^(next|more|continue)\b/.test(t) || /\bnext\b/.test(t);
}

function isPrevPageUtterance(text) {
  const t = normalizeUtterance(text).toLowerCase();
  return /\b(previous|back)\b/.test(t);
}

function isStopReadUtterance(text) {
  const t = normalizeUtterance(text).toLowerCase();
  return /^(stop|done|finished|that's all|thats all|no|nope)\b/.test(t);
}

function isDoneAddingMore(text) {
  const t = normalizeUtterance(text).toLowerCase();
  return /^(no|nope|nothing|none|that's all|thats all|that is all|done|finished|stop|never mind|no thanks|no thank you)\b/.test(
    t,
  );
}

function isReadListUtterance(text) {
  const t = normalizeUtterance(text).toLowerCase();
  if (!/\blist\b/.test(t)) return false;
  // Do not treat "list" alone as a read verb — "add milk to my Target list"
  // must stay an add answer, not a get.
  return (
    /\b(read|show|recap|repeat)\b/.test(t) ||
    /\bwhat(?:'|’)s\s+on\b/.test(t) ||
    /\bwhat\s+is\s+on\b/.test(t) ||
    /\bread\s+me\s+back\b/.test(t)
  );
}

function openReprompt(kind, name) {
  if (kind === 'shopping' && name) {
    return {
      speakExtra: ` Anything else for your ${name} list?`,
      reprompt: `Anything else for ${name}? Or say what you want to do.`,
    };
  }
  if (kind === 'todo' && name) {
    const label =
      String(name).toLowerCase() === 'to do' ? 'to do list' : `${name} to do list`;
    return {
      speakExtra: ` Anything else for your ${label}?`,
      reprompt: `Anything else for your ${label}? Or say what you want to do.`,
    };
  }
  return { speakExtra: ' What else can I help you with?', reprompt: prompts.OPEN_REPROMPT };
}

function cleanNameAnswer(text) {
  const t = normalizeUtterance(text);
  if (!t) return null;
  return t.replace(/^(?:my|the|for|from)\s+/i, '').trim() || null;
}

module.exports = {
  SHOPPING_STEPS,
  TODO_STEPS,
  formatSpeech,
  isNextPageUtterance,
  isPrevPageUtterance,
  isStopReadUtterance,
  isDoneAddingMore,
  isReadListUtterance,
  openReprompt,
  cleanNameAnswer,
};
