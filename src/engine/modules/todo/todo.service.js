// apps/skill-backend/src/modules/todo/todo.service.js
// To-Do List Business Logic Service
// Follows: local-first, thin handlers, structured logging

const {
  generateListId,
  generateItemId,
  normalizeListName,
  getAllTodoLists,
  getTodoListsByName,
  saveTodoList,
} = require('../../store');
const safeLog = require('../../log');

const MAX_LIST_NAME_CHARS = 40;
const MAX_ITEM_CHARS = 80;
const DEFAULT_LIST_NAME = 'to do';

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function clampName(value, maxChars) {
  const t = String(value || '').trim();
  if (!t) return '';
  return t.length > maxChars ? t.slice(0, maxChars).trim() : t;
}

/**
 * Fuzzy list name match: "work" matches "work"
 * Returns the best matching list or null.
 */
function findBestMatch(lists, listName) {
  if (!lists || lists.length === 0) return null;
  const needle = (listName || '').toLowerCase().trim();
  // Prioritise exact listName match first
  const exact = lists.find(
    (l) => l.listName.toLowerCase() === needle
  );
  if (exact) return exact;
  // Partial match
  return lists.find((l) => l.listName.toLowerCase().includes(needle)) || lists[0];
}

/**
 * Parse a comma/and-separated items string into an array of trimmed names.
 * e.g. "finish report, email john and call mom" → ["finish report", "email john", "call mom"]
 */
function parseItemsList(rawItems) {
  if (!rawItems || typeof rawItems !== 'string') return [];
  return rawItems
    .split(/,|(?:\s+and\s+)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ────────────────────────────────────────────────────────────
// Service functions
// ────────────────────────────────────────────────────────────

/**
 * Add items to a to-do list (creates list if none exists).
 * Design: ONE list per name per user (merge items into existing).
 *
 * @param {string} userId
 * @param {string} listName
 * @param {string|string[]} rawItems
 * @returns {Promise<{list: Object, addedCount: number, existingList: boolean}>}
 */
async function addItemsToList(userId, listName, rawItems) {
  const name =
    clampName(listName, MAX_LIST_NAME_CHARS) || DEFAULT_LIST_NAME;

  const itemNames = (Array.isArray(rawItems)
    ? rawItems.map((i) => i.trim()).filter(Boolean)
    : parseItemsList(rawItems)
  )
    .map((n) => clampName(n, MAX_ITEM_CHARS))
    .filter(Boolean);

  if (itemNames.length === 0) {
    throw new Error('No items provided to add.');
  }

  const existing = await getTodoListsByName(userId, name);
  let list = findBestMatch(existing, name);

  const isNew = !list;
  if (isNew) {
    list = {
      listId: generateListId(name),
      listName: name,
      items: [],
      createdAt: new Date().toISOString(),
    };
  }

  const now = new Date().toISOString();
  const newItems = itemNames.map((n) => ({
    itemId: generateItemId(),
    name: n,
    completed: false,
    addedAt: now,
  }));

  list.items = [...(list.items || []), ...newItems];
  const saved = await saveTodoList(userId, list);

  safeLog.info('todo_add_items', { addedCount: newItems.length, isNew, budget: 'dynamo' });
  return { list: saved, addedCount: newItems.length, existingList: !isNew };
}

/**
 * Get the to-do list for a specific name.
 * Returns null if no list found.
 *
 * @param {string} userId
 * @param {string} listName
 * @returns {Promise<Object|null>}
 */
async function getListByName(userId, listName) {
  const lists = await getTodoListsByName(userId, listName);
  return findBestMatch(lists, listName) || null;
}

/**
 * Get all to-do lists for user.
 * @param {string} userId
 * @returns {Promise<Array>}
 */
async function getAllLists(userId) {
  return getAllTodoLists(userId);
}

/**
 * Mark an item as completed by name (case-insensitive).
 * Tries exact match first, then partial.
 *
 * @param {string} userId
 * @param {string} listName
 * @param {string} itemName
 * @returns {Promise<{success: boolean, itemName: string|null, alreadyDone: boolean}>}
 */
async function markItemCompleted(userId, listName, itemName) {
  const lists = await getTodoListsByName(userId, listName);
  const list = findBestMatch(lists, listName);

  if (!list) {
    safeLog.warn('todo_mark_missing_list', { budget: 'dynamo' });
    return { success: false, itemName: null, alreadyDone: false };
  }

  const needle = (itemName || '').toLowerCase().trim();
  const items = list.items || [];

  // Try exact match, then partial
  let idx = items.findIndex((i) => i.name.toLowerCase() === needle);
  if (idx === -1) {
    idx = items.findIndex((i) => i.name.toLowerCase().includes(needle));
  }

  if (idx === -1) {
    safeLog.warn('todo_mark_missing_item', { budget: 'dynamo' });
    return { success: false, itemName: null, alreadyDone: false };
  }

  const found = items[idx];
  if (found.completed) {
    return { success: true, itemName: found.name, alreadyDone: true };
  }

  // Optimistic in-memory update then save
  list.items[idx] = { ...found, completed: true, completedAt: new Date().toISOString() };
  await saveTodoList(userId, list);

  safeLog.info('todo_mark_complete', { budget: 'dynamo' });
  return { success: true, itemName: found.name, alreadyDone: false };
}

/**
 * Remove an item by name (exact then partial).
 * @returns {Promise<{success: boolean, itemName: string|null}>}
 */
async function removeItem(userId, listName, itemName) {
  const lists = await getTodoListsByName(userId, listName);
  const list = findBestMatch(lists, listName);
  if (!list) {
    return { success: false, itemName: null };
  }

  const needle = (itemName || '').toLowerCase().trim();
  const items = list.items || [];
  let idx = items.findIndex((i) => i.name.toLowerCase() === needle);
  if (idx === -1) {
    idx = items.findIndex((i) => i.name.toLowerCase().includes(needle));
  }
  if (idx === -1) {
    return { success: false, itemName: null };
  }

  const found = items[idx];
  list.items = items.filter((_, i) => i !== idx);
  await saveTodoList(userId, list);
  safeLog.info('todo_remove_item', { budget: 'dynamo' });
  return { success: true, itemName: found.name };
}

/**
 * Remove all completed items from a to-do list.
 * @returns {Promise<{success: boolean, clearedCount: number, listName: string|null}>}
 */
async function clearCompletedItems(userId, listName) {
  const lists = await getTodoListsByName(userId, listName);
  const list = findBestMatch(lists, listName);
  if (!list) {
    return { success: false, clearedCount: 0, listName: null };
  }
  const before = (list.items || []).length;
  list.items = (list.items || []).filter((i) => !i.completed);
  const clearedCount = before - list.items.length;
  await saveTodoList(userId, list);
  safeLog.info('todo_clear_completed', { clearedCount, budget: 'dynamo' });
  return { success: true, clearedCount, listName: list.listName };
}

const LIST_ITEM_PAGE_SIZE = 5;

/**
 * Format a to-do list for Alexa speech.
 * Pending first (paginated); completed summarized unless few.
 *
 * @param {Object} list
 * @param {{ page?: number, pageSize?: number, includeDoneNames?: boolean }} [opts]
 * @returns {{ speech: string, more: boolean, page: number, totalPending: number }}
 */
function formatListForSpeech(list, opts = {}) {
  if (!list) {
    return {
      speech: "I couldn't find that to do list.",
      more: false,
      page: 0,
      totalPending: 0,
    };
  }
  const items = list.items || [];
  const pageSize = opts.pageSize || LIST_ITEM_PAGE_SIZE;
  const page = Math.max(0, opts.page || 0);
  const listLabel =
    list.listName.toLowerCase() === 'to do' ? 'to do list' : `${list.listName} to do list`;

  if (items.length === 0) {
    return {
      speech: `Your ${listLabel} is empty.`,
      more: false,
      page: 0,
      totalPending: 0,
    };
  }

  const pending = items.filter((i) => !i.completed);
  const done = items.filter((i) => i.completed);
  const PAUSE = "<break time='500ms'/>";

  let speech = `Your ${listLabel} has ${items.length} ${items.length === 1 ? 'item' : 'items'}. `;

  if (pending.length === 0) {
    speech += 'Nothing left to do. ';
  } else {
    const start = page * pageSize;
    const slice = pending.slice(start, start + pageSize);
    const end = start + slice.length;
    const more = end < pending.length;
    if (pending.length > pageSize) {
      speech += `Still to do, ${start + 1} through ${end} of ${pending.length}: `;
    } else {
      speech += 'Still to do: ';
    }
    speech += `${slice.map((i) => i.name).join(`, ${PAUSE}`)}. `;
    if (more) {
      return {
        speech: speech.trim(),
        more: true,
        page,
        totalPending: pending.length,
      };
    }
  }

  if (done.length > 0) {
    if (opts.includeDoneNames || done.length <= 3) {
      speech += `Already completed: ${done.map((i) => i.name).join(`, ${PAUSE}`)}.`;
    } else {
      speech += `And ${done.length} already completed.`;
    }
  }

  return {
    speech: speech.trim(),
    more: false,
    page,
    totalPending: pending.length,
  };
}

/**
 * Confirmation speech when items are added.
 *
 * @param {string} listName
 * @param {string[]} itemNames
 * @param {boolean} existingList
 * @returns {string}
 */
function formatAddConfirmationForSpeech(listName, itemNames, existingList) {
  const itemList = itemNames.join(', ');
  const verb = existingList ? 'added to your' : 'created a new';
  const listLabel = listName.toLowerCase() === 'to do' ? 'to do list' : `${listName} to do list`;
  return `I've ${verb} ${listLabel}${existingList ? '' : ' and added'}: ${itemList}.`;
}

module.exports = {
  addItemsToList,
  getListByName,
  getAllLists,
  markItemCompleted,
  removeItem,
  clearCompletedItems,
  parseItemsList,
  formatListForSpeech,
  formatAddConfirmationForSpeech,
  LIST_ITEM_PAGE_SIZE,
  MAX_LIST_NAME_CHARS,
  MAX_ITEM_CHARS,
  DEFAULT_LIST_NAME,
  clampName,
};
