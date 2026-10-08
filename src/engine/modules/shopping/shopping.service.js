// apps/skill-backend/src/modules/shopping/shopping.service.js
// Shopping List Business Logic Service
// @Backend Protocol — Intent Handler → Service → Repository
// Follows: local-first, thin handlers, structured logging

const {
  generateListId,
  generateItemId,
  normalizeStoreName,
  getAllShoppingLists,
  getShoppingListsByStore,
  saveShoppingList,
} = require('../../store');
const safeLog = require('../../log');

const MAX_STORE_CHARS = 40;
const MAX_ITEM_CHARS = 80;

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function clampName(value, maxChars) {
  const t = String(value || '').trim();
  if (!t) return '';
  return t.length > maxChars ? t.slice(0, maxChars).trim() : t;
}

/**
 * Fuzzy store name match: "trader" matches "Trader Joe's"
 * Returns the best matching list or null.
 */
function findBestMatch(lists, storeName) {
  if (!lists || lists.length === 0) return null;
  const needle = (storeName || '').toLowerCase().trim();
  // Prioritise exact storeName match first
  const exact = lists.find(
    (l) => l.storeName.toLowerCase() === needle
  );
  if (exact) return exact;
  // Partial match
  return lists.find((l) => l.storeName.toLowerCase().includes(needle)) || lists[0];
}

/**
 * Parse a comma/and-separated items string into an array of trimmed names.
 * e.g. "milk, eggs and butter" → ["milk", "eggs", "butter"]
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
 * Add items to a store's shopping list (creates list if none exists).
 * Design: ONE list per store per user (merge items into existing).
 *
 * @param {string} userId
 * @param {string} storeName
 * @param {string|string[]} rawItems  — "milk, eggs and butter" or ["milk","eggs"]
 * @returns {Promise<{list: Object, addedCount: number, existingList: boolean}>}
 */
async function addItemsToList(userId, storeName, rawItems) {
  const store = clampName(storeName, MAX_STORE_CHARS);
  if (!store) {
    throw new Error('Store name is required.');
  }

  const itemNames = (Array.isArray(rawItems)
    ? rawItems.map((i) => i.trim()).filter(Boolean)
    : parseItemsList(rawItems)
  )
    .map((n) => clampName(n, MAX_ITEM_CHARS))
    .filter(Boolean);

  if (itemNames.length === 0) {
    throw new Error('No items provided to add.');
  }

  const existing = await getShoppingListsByStore(userId, store);
  let list = findBestMatch(existing, store);

  const isNew = !list;
  if (isNew) {
    list = {
      listId: generateListId(store),
      storeName: store,
      items: [],
      createdAt: new Date().toISOString(),
    };
  }

  const now = new Date().toISOString();
  const newItems = itemNames.map((name) => ({
    itemId: generateItemId(),
    name,
    completed: false,
    addedAt: now,
  }));

  list.items = [...(list.items || []), ...newItems];
  const saved = await saveShoppingList(userId, list);

  safeLog.info('shopping_add_items', {
    addedCount: newItems.length,
    isNew,
    budget: 'dynamo',
  });
  return { list: saved, addedCount: newItems.length, existingList: !isNew };
}

/**
 * Get the shopping list for a specific store.
 * Returns null if no list found.
 *
 * @param {string} userId
 * @param {string} storeName
 * @returns {Promise<Object|null>}
 */
async function getListByStore(userId, storeName) {
  const lists = await getShoppingListsByStore(userId, storeName);
  return findBestMatch(lists, storeName) || null;
}

/**
 * Get all shopping lists for user.
 * @param {string} userId
 * @returns {Promise<Array>}
 */
async function getAllLists(userId) {
  return getAllShoppingLists(userId);
}

/**
 * Mark an item as completed by name (case-insensitive).
 * Tries exact match first, then partial.
 *
 * @param {string} userId
 * @param {string} storeName
 * @param {string} itemName
 * @returns {Promise<{success: boolean, itemName: string|null, alreadyDone: boolean}>}
 */
async function markItemCompleted(userId, storeName, itemName) {
  const lists = await getShoppingListsByStore(userId, storeName);
  const list = findBestMatch(lists, storeName);

  if (!list) {
    safeLog.warn('shopping_mark_missing_list', { budget: 'dynamo' });
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
    safeLog.warn('shopping_mark_missing_item', { budget: 'dynamo' });
    return { success: false, itemName: null, alreadyDone: false };
  }

  const found = items[idx];
  if (found.completed) {
    return { success: true, itemName: found.name, alreadyDone: true };
  }

  // Optimistic in-memory update then save
  list.items[idx] = { ...found, completed: true, completedAt: new Date().toISOString() };
  await saveShoppingList(userId, list);

  safeLog.info('shopping_mark_complete', { budget: 'dynamo' });
  return { success: true, itemName: found.name, alreadyDone: false };
}

/**
 * Remove an item by name (exact then partial).
 * @returns {Promise<{success: boolean, itemName: string|null}>}
 */
async function removeItem(userId, storeName, itemName) {
  const lists = await getShoppingListsByStore(userId, storeName);
  const list = findBestMatch(lists, storeName);
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
  await saveShoppingList(userId, list);
  safeLog.info('shopping_remove_item', { budget: 'dynamo' });
  return { success: true, itemName: found.name };
}

/**
 * Remove all completed items from a store list.
 * @returns {Promise<{success: boolean, clearedCount: number, storeName: string|null}>}
 */
async function clearCompletedItems(userId, storeName) {
  const lists = await getShoppingListsByStore(userId, storeName);
  const list = findBestMatch(lists, storeName);
  if (!list) {
    return { success: false, clearedCount: 0, storeName: null };
  }
  const before = (list.items || []).length;
  list.items = (list.items || []).filter((i) => !i.completed);
  const clearedCount = before - list.items.length;
  await saveShoppingList(userId, list);
  safeLog.info('shopping_clear_completed', { clearedCount, budget: 'dynamo' });
  return { success: true, clearedCount, storeName: list.storeName };
}

const LIST_ITEM_PAGE_SIZE = 5;

/**
 * Format a shopping list for Alexa speech.
 * Pending items first (paginated); completed summarized unless few.
 *
 * @param {Object} list
 * @param {{ page?: number, pageSize?: number, includeDoneNames?: boolean }} [opts]
 * @returns {{ speech: string, more: boolean, page: number, totalPending: number }}
 */
function formatListForSpeech(list, opts = {}) {
  if (!list) {
    return {
      speech: "I couldn't find that shopping list.",
      more: false,
      page: 0,
      totalPending: 0,
    };
  }
  const items = list.items || [];
  const pageSize = opts.pageSize || LIST_ITEM_PAGE_SIZE;
  const page = Math.max(0, opts.page || 0);

  if (items.length === 0) {
    return {
      speech: `Your ${list.storeName} list is empty.`,
      more: false,
      page: 0,
      totalPending: 0,
    };
  }

  const pending = items.filter((i) => !i.completed);
  const done = items.filter((i) => i.completed);
  const PAUSE = "<break time='500ms'/>";

  let speech = `Your ${list.storeName} list has ${items.length} ${items.length === 1 ? 'item' : 'items'}. `;

  if (pending.length === 0) {
    speech += 'Nothing left to get. ';
  } else {
    const start = page * pageSize;
    const slice = pending.slice(start, start + pageSize);
    const end = start + slice.length;
    const more = end < pending.length;
    if (pending.length > pageSize) {
      speech += `Still to get, ${start + 1} through ${end} of ${pending.length}: `;
    } else {
      speech += 'Still to get: ';
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
      speech += `Already checked off: ${done.map((i) => i.name).join(`, ${PAUSE}`)}.`;
    } else {
      speech += `And ${done.length} already checked off.`;
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
 * @param {string} storeName
 * @param {string[]} itemNames
 * @param {boolean} existingList
 * @returns {string}
 */
function formatAddConfirmationForSpeech(storeName, itemNames, existingList) {
  const itemList = itemNames.join(', ');
  const verb = existingList ? 'added to your' : 'created a new';
  return `I've ${verb} ${storeName} list${existingList ? '' : ' and added'}: ${itemList}.`;
}

module.exports = {
  addItemsToList,
  getListByStore,
  getAllLists,
  markItemCompleted,
  removeItem,
  clearCompletedItems,
  parseItemsList,
  formatListForSpeech,
  formatAddConfirmationForSpeech,
  LIST_ITEM_PAGE_SIZE,
  MAX_STORE_CHARS,
  MAX_ITEM_CHARS,
  clampName,
};
