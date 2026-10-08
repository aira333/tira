// src/engine/store/index.js
// On-device data layer — same surface as Day Buddy's libs/aws-utils so the
// dialogue engine and domain services run unchanged.

const db = require('./db');
const platform = require('../platform');

const APT_PREFIX = 'APT#';
const LEGACY_STG_PREFIX = 'STG_';
const USER_META_BASE = 'USER#META';

const LIST_VERBOSITY = {
  BRIEF: 'brief',
  DETAILED: 'detailed',
};

function getEnvMode() {
  return 'DEVICE';
}

function isStaging() {
  return false;
}

// ────────────────────────────────────────────────────────────
// Appointments
// ────────────────────────────────────────────────────────────

/** Strip APT# / legacy STG_ wrappers → logical id (e.g. apt_123) */
function toLogicalAppointmentId(storageOrLogicalId) {
  if (!storageOrLogicalId) return storageOrLogicalId;
  let id = String(storageOrLogicalId);
  if (id.startsWith(LEGACY_STG_PREFIX)) id = id.slice(LEGACY_STG_PREFIX.length);
  if (id.startsWith(APT_PREFIX)) id = id.slice(APT_PREFIX.length);
  return id;
}

function toStorageAppointmentId(rawAppointmentId) {
  if (!rawAppointmentId) return rawAppointmentId;
  return `${APT_PREFIX}${toLogicalAppointmentId(rawAppointmentId)}`;
}

function appointmentSkPrefix() {
  return APT_PREFIX;
}

function filterAppointmentRecords(items) {
  return (items || []).filter((item) => {
    if (!String(item.appointmentId || '').startsWith(APT_PREFIX)) return false;
    if (item.recordType && item.recordType !== 'APPOINTMENT') return false;
    if (
      ['CANCELLED', 'CANCELED', 'DELETED'].includes(
        String(item.status || '').toUpperCase(),
      )
    ) {
      return false;
    }
    return Boolean(item.doctorName && item.date && item.time && item.dateTime);
  });
}

function byDateTime(ascending = true) {
  return (a, b) => {
    const cmp = String(a.dateTime || '').localeCompare(String(b.dateTime || ''));
    return ascending ? cmp : -cmp;
  };
}

async function saveAppointment(userId, appointment) {
  const storageId = toStorageAppointmentId(appointment.appointmentId);
  const now = new Date().toISOString();
  const item = {
    userId,
    appointmentId: storageId,
    recordType: 'APPOINTMENT',
    doctorName: appointment.doctorName,
    date: appointment.date,
    time: appointment.time,
    dateTime: appointment.dateTime,
    location: appointment.location || '',
    notes: appointment.notes || '',
    reminderLeadMinutes:
      appointment.reminderLeadMinutes === undefined
        ? null
        : appointment.reminderLeadMinutes,
    // Field name kept from Day Buddy; holds the local notification id on device.
    alexaReminderId: appointment.alexaReminderId || null,
    durationMinutes: appointment.durationMinutes || 60,
    status: appointment.status || 'ACTIVE',
    createdAt: appointment.createdAt || now,
    updatedAt: now,
    env: getEnvMode(),
  };
  await db.putRow('appointments', userId, storageId, item);
  return { appointmentId: storageId, aws: {} };
}

async function getAppointments(userId) {
  const rows = await db.rowsForUser('appointments', userId);
  return filterAppointmentRecords(rows).sort(byDateTime(true));
}

/**
 * @param {string} userId
 * @param {{ fromIso?: string|null, toIso?: string|null, ascending?: boolean }} [opts]
 */
async function queryAppointmentsByDateRange(userId, opts = {}) {
  const { fromIso = null, toIso = null, ascending = true } = opts;
  const all = await getAppointments(userId);
  return all
    .filter((apt) => {
      const t = String(apt.dateTime || '');
      if (fromIso && toIso) return t >= fromIso && t <= toIso;
      if (fromIso) return t >= fromIso;
      if (toIso) return t < toIso;
      return true;
    })
    .sort(byDateTime(ascending));
}

async function getAppointmentsByDoctor(userId, doctorName) {
  const all = await getAppointments(userId);
  // DynamoDB `contains` is case-sensitive; keep that contract.
  return all.filter((apt) => String(apt.doctorName || '').includes(doctorName));
}

async function deleteAppointment(userId, appointmentId) {
  await db.deleteRow('appointments', userId, toStorageAppointmentId(appointmentId));
  return {};
}

// ────────────────────────────────────────────────────────────
// Shared list helpers (shopping + todo)
// ────────────────────────────────────────────────────────────

function normalizeListKey(name) {
  return (name || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function generateListId(name) {
  return `list_${normalizeListKey(name)}_${Date.now()}`;
}

function generateItemId() {
  return `item_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

async function allLists(table, userId) {
  const rows = await db.rowsForUser(table, userId);
  return rows
    .filter((row) => String(row.listId || '').startsWith('list_'))
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}

async function listsByName(table, userId, name, nameField) {
  const prefix = `list_${normalizeListKey(name)}_`;
  const all = await allLists(table, userId);
  const exact = all.filter((row) => row.listId.startsWith(prefix));
  if (exact.length > 0) return exact;
  const needle = String(name || '').toLowerCase();
  return all.filter((row) => String(row[nameField] || '').toLowerCase().includes(needle));
}

async function updateListItem(table, userId, listId, itemIndex, updates) {
  const row = await db.getRow(table, userId, listId);
  if (!row || !Array.isArray(row.items) || !row.items[itemIndex]) return;
  row.items[itemIndex] = { ...row.items[itemIndex], ...updates };
  row.updatedAt = new Date().toISOString();
  await db.putRow(table, userId, listId, row);
}

// ────────────────────────────────────────────────────────────
// Shopping lists
// ────────────────────────────────────────────────────────────

const SHOPPING_TABLE = 'shopping';

const normalizeStoreName = normalizeListKey;

async function getAllShoppingLists(userId) {
  return allLists(SHOPPING_TABLE, userId);
}

async function getShoppingListsByStore(userId, storeName) {
  return listsByName(SHOPPING_TABLE, userId, storeName, 'storeName');
}

async function getShoppingList(userId, listId) {
  return db.getRow(SHOPPING_TABLE, userId, listId);
}

async function saveShoppingList(userId, list) {
  const now = new Date().toISOString();
  const item = {
    userId,
    listId: list.listId,
    storeName: list.storeName,
    items: list.items || [],
    createdAt: list.createdAt || now,
    updatedAt: now,
    env: getEnvMode(),
  };
  return db.putRow(SHOPPING_TABLE, userId, item.listId, item);
}

async function updateItemInList(userId, listId, itemIndex, updates) {
  return updateListItem(SHOPPING_TABLE, userId, listId, itemIndex, updates);
}

async function deleteShoppingList(userId, listId) {
  return db.deleteRow(SHOPPING_TABLE, userId, listId);
}

// ────────────────────────────────────────────────────────────
// To-do lists
// ────────────────────────────────────────────────────────────

const TODO_TABLE = 'todo';

const normalizeListName = normalizeListKey;

async function getAllTodoLists(userId) {
  return allLists(TODO_TABLE, userId);
}

async function getTodoListsByName(userId, listName) {
  return listsByName(TODO_TABLE, userId, listName, 'listName');
}

async function getTodoList(userId, listId) {
  return db.getRow(TODO_TABLE, userId, listId);
}

async function saveTodoList(userId, list) {
  const now = new Date().toISOString();
  const item = {
    userId,
    listId: list.listId,
    listName: list.listName,
    items: list.items || [],
    createdAt: list.createdAt || now,
    updatedAt: now,
    env: getEnvMode(),
  };
  return db.putRow(TODO_TABLE, userId, item.listId, item);
}

async function updateTodoItemInList(userId, listId, itemIndex, updates) {
  return updateListItem(TODO_TABLE, userId, listId, itemIndex, updates);
}

async function deleteTodoList(userId, listId) {
  return db.deleteRow(TODO_TABLE, userId, listId);
}

// ────────────────────────────────────────────────────────────
// User profile (name, list verbosity, ride contacts)
// ────────────────────────────────────────────────────────────

function userMetaSk() {
  return USER_META_BASE;
}

function cleanUserName(userName) {
  if (!userName || typeof userName !== 'string') return null;
  const cleaned = userName
    .replace(/[^a-zA-Z .'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  return cleaned.length > 40 ? cleaned.slice(0, 40).trim() : cleaned;
}

function normalizeListVerbosity(value) {
  const t = String(value || '').toLowerCase().trim();
  if (['brief', 'short', 'shorter', 'concise'].includes(t)) {
    return LIST_VERBOSITY.BRIEF;
  }
  return LIST_VERBOSITY.DETAILED;
}

async function getUserMeta(userId) {
  return db.getRow('users', userId, userMetaSk());
}

/** Merge-update the single user record. Pass userName: null to clear the name. */
async function upsertUserMeta(userId, updates = {}) {
  const existing = (await getUserMeta(userId)) || {};
  const now = new Date().toISOString();

  let userName = existing.userName ?? null;
  if (Object.prototype.hasOwnProperty.call(updates, 'userName')) {
    if (updates.userName === null || updates.userName === '') {
      userName = null;
    } else {
      const cleaned = cleanUserName(updates.userName);
      if (!cleaned) throw new Error('A valid user name is required');
      userName = cleaned;
    }
  }

  let listVerbosity = normalizeListVerbosity(existing.listVerbosity);
  if (updates.listVerbosity !== undefined) {
    listVerbosity = normalizeListVerbosity(updates.listVerbosity);
  }

  const pick = (field) =>
    updates[field] !== undefined ? updates[field] : existing[field] || null;

  const item = {
    userId,
    appointmentId: userMetaSk(),
    recordType: 'USER',
    userName,
    listVerbosity,
    transportName: pick('transportName'),
    transportPhone: pick('transportPhone'),
    riderPhone: pick('riderPhone'),
    createdAt: existing.createdAt || now,
    updatedAt: now,
    env: getEnvMode(),
  };
  await db.putRow('users', userId, userMetaSk(), item);
  return item;
}

async function getUserProfile(userId) {
  return getUserMeta(userId);
}

async function upsertUserProfile(userId, updates = {}) {
  return upsertUserMeta(userId, updates);
}

/** @deprecated Prefer upsertUserProfile */
async function saveUserProfile(userId, userName) {
  return upsertUserProfile(userId, { userName });
}

// ────────────────────────────────────────────────────────────
// Calls (phone dialer replaces the Twilio bridge)
// ────────────────────────────────────────────────────────────

function normalizePhoneNumber(rawPhone) {
  if (!rawPhone || typeof rawPhone !== 'string') return null;
  const trimmed = rawPhone.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('+')) {
    const digits = trimmed.replace(/[^\d]/g, '');
    return digits ? `+${digits}` : null;
  }

  const digits = trimmed.replace(/[^\d]/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits ? `+${digits}` : null;
}

/**
 * Day Buddy asked Twilio to ring the rider, then bridge to transport.
 * On the phone Tira simply opens the dialer to the transport number;
 * the rider is holding the phone. `riderPhone` is optional here.
 */
async function placeBridgeCall({ riderPhone, transportPhone, message }) {
  const normalizedTransportPhone = normalizePhoneNumber(transportPhone);
  const normalizedRiderPhone = normalizePhoneNumber(riderPhone) || null;

  if (!normalizedTransportPhone) {
    return {
      placed: false,
      provider: 'device',
      reason: 'DESTINATION_PHONE_NOT_CONFIGURED',
      riderPhone: normalizedRiderPhone,
      transportPhone: null,
    };
  }

  const result = await platform.placeCall({
    phone: normalizedTransportPhone,
    message,
  });

  if (!result?.ok) {
    return {
      placed: false,
      provider: 'device',
      reason: 'CALL_PROVIDER_NOT_CONFIGURED',
      riderPhone: normalizedRiderPhone,
      transportPhone: normalizedTransportPhone,
    };
  }

  return {
    placed: true,
    provider: 'device',
    riderPhone: normalizedRiderPhone,
    transportPhone: normalizedTransportPhone,
    sid: 'device-dialer',
    message: message || '',
  };
}

/** Dialer hand-off is instant; no slow HTTP to cover with progressive speech. */
function shouldAttemptRealTwilioHttp() {
  return false;
}

// ────────────────────────────────────────────────────────────
// Ride contacts
// ────────────────────────────────────────────────────────────

async function saveTransportInfo(userId, transportName, transportPhone) {
  return upsertUserMeta(userId, {
    transportName: transportName || 'My Ride',
    transportPhone: normalizePhoneNumber(transportPhone) || '',
  });
}

async function getTransportInfo(userId) {
  const meta = await getUserMeta(userId);
  if (!meta || (!meta.transportName && !meta.transportPhone)) return null;
  return {
    userId,
    transportName: meta.transportName || 'My Ride',
    transportPhone: meta.transportPhone || '',
    recordType: 'USER',
    updatedAt: meta.updatedAt,
  };
}

async function saveRiderPhone(userId, riderPhone) {
  const normalizedPhone = normalizePhoneNumber(riderPhone);
  if (!normalizedPhone) throw new Error('A valid rider phone number is required');
  return upsertUserMeta(userId, { riderPhone: normalizedPhone });
}

async function getRiderPhone(userId) {
  const meta = await getUserMeta(userId);
  if (!meta?.riderPhone) return null;
  return {
    userId,
    riderPhone: meta.riderPhone,
    recordType: 'USER',
    updatedAt: meta.updatedAt,
  };
}

module.exports = {
  initStore: db.initStore,
  clearAll: db.clearAll,
  memoryAdapter: db.memoryAdapter,

  getEnvMode,
  isStaging,
  APT_PREFIX,
  toLogicalAppointmentId,
  toStorageAppointmentId,
  appointmentSkPrefix,
  saveAppointment,
  getAppointments,
  queryAppointmentsByDateRange,
  getAppointmentsByDoctor,
  deleteAppointment,

  SHOPPING_TABLE,
  normalizeStoreName,
  getAllShoppingLists,
  getShoppingListsByStore,
  getShoppingList,
  saveShoppingList,
  updateItemInList,
  deleteShoppingList,

  TODO_TABLE,
  normalizeListName,
  getAllTodoLists,
  getTodoListsByName,
  getTodoList,
  saveTodoList,
  updateTodoItemInList,
  deleteTodoList,

  generateListId,
  generateItemId,

  LIST_VERBOSITY,
  USER_META_BASE,
  userMetaSk,
  cleanUserName,
  normalizeListVerbosity,
  getUserMeta,
  upsertUserMeta,
  getUserProfile,
  upsertUserProfile,
  saveUserProfile,

  normalizePhoneNumber,
  placeBridgeCall,
  shouldAttemptRealTwilioHttp,

  saveTransportInfo,
  getTransportInfo,
  saveRiderPhone,
  getRiderPhone,
};
