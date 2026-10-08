// src/engine/store/db.js
// On-device table store for Tira (replaces DynamoDB).
//
// Tables are kept in memory and written through to a pluggable key-value
// adapter (AsyncStorage on the phone, in-memory for Node tests). Call
// `initStore(adapter)` once before the first turn.

const TABLES = ['appointments', 'shopping', 'todo', 'users'];
const KEY_PREFIX = 'tira.table.';

/** @type {{ getItem(k: string): Promise<string|null>, setItem(k: string, v: string): Promise<void> }|null} */
let adapter = null;
/** @type {Record<string, Record<string, object>>} */
let tables = emptyTables();

/** Resolves once initStore() has loaded the tables; reads/writes wait on it. */
let markReady;
let readyPromise = new Promise((resolve) => {
  markReady = resolve;
});

function emptyTables() {
  const t = {};
  for (const name of TABLES) t[name] = {};
  return t;
}

function memoryAdapter() {
  const mem = {};
  return {
    async getItem(k) {
      return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null;
    },
    async setItem(k, v) {
      mem[k] = v;
    },
  };
}

async function initStore(storageAdapter) {
  adapter = storageAdapter || memoryAdapter();
  const loaded = emptyTables();
  for (const name of TABLES) {
    try {
      const raw = await adapter.getItem(KEY_PREFIX + name);
      if (raw) loaded[name] = JSON.parse(raw) || {};
    } catch {
      loaded[name] = {};
    }
  }
  tables = loaded;
  markReady();
  readyPromise = Promise.resolve();
}

function ensureReady() {
  return readyPromise;
}

async function persist(table) {
  if (!adapter) return;
  await adapter.setItem(KEY_PREFIX + table, JSON.stringify(tables[table]));
}

function rowKey(userId, id) {
  return `${userId}#${id}`;
}

async function putRow(table, userId, id, item) {
  await ensureReady();
  tables[table][rowKey(userId, id)] = JSON.parse(JSON.stringify(item));
  await persist(table);
  return item;
}

async function getRow(table, userId, id) {
  await ensureReady();
  const row = tables[table][rowKey(userId, id)];
  return row ? JSON.parse(JSON.stringify(row)) : null;
}

async function deleteRow(table, userId, id) {
  await ensureReady();
  delete tables[table][rowKey(userId, id)];
  await persist(table);
}

/** All rows for a user in a table (copies). */
async function rowsForUser(table, userId) {
  await ensureReady();
  return Object.values(tables[table])
    .filter((row) => row.userId === userId)
    .map((row) => JSON.parse(JSON.stringify(row)));
}

/** Wipe every table (settings "erase all data"). */
async function clearAll() {
  await ensureReady();
  tables = emptyTables();
  for (const name of TABLES) await persist(name);
}

module.exports = {
  TABLES,
  initStore,
  putRow,
  getRow,
  deleteRow,
  rowsForUser,
  clearAll,
  memoryAdapter,
};
