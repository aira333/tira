// src/tira/cloud.js
// Storage adapters for the engine store: on-device only (guest) or
// on-device + Supabase (signed in).
//
// The engine persists each table as one JSON blob under "tira.table.<name>".
// Guests use those keys as-is (same as earlier versions of Tira, so existing
// data stays). A signed-in customer gets a namespaced local cache
// ("tira.acct.<userId>.tira.table.<name>") mirrored to public.user_data.

const ENGINE_PREFIX = 'tira.table.';
const TABLES = ['appointments', 'shopping', 'todo', 'users'];
const PUSH_DELAY_MS = 800;

function tableFromKey(key) {
  return key.startsWith(ENGINE_PREFIX) ? key.slice(ENGINE_PREFIX.length) : null;
}

function accountKey(userId, key) {
  return `tira.acct.${userId}.${key}`;
}

/** On-device only. */
export function guestAdapter(local) {
  return {
    getItem: (key) => local.getItem(key),
    setItem: (key, value) => local.setItem(key, value),
  };
}

/**
 * On-device cache + background push to Supabase.
 * @param {{ local, supabase, userId: string, onSyncState?: (s: 'synced'|'syncing'|'offline') => void }} opts
 */
export function accountAdapter({ local, supabase, userId, onSyncState }) {
  const dirty = new Map(); // table → JSON string
  let timer = null;
  let inflight = null;

  async function pushNow() {
    timer = null;
    if (!dirty.size) return;
    const rows = [...dirty.entries()].map(([table_name, json]) => ({
      user_id: userId,
      table_name,
      data: JSON.parse(json),
      updated_at: new Date().toISOString(),
    }));
    dirty.clear();
    onSyncState?.('syncing');
    try {
      const { error } = await supabase.from('user_data').upsert(rows, { onConflict: 'user_id,table_name' });
      if (error) throw error;
      onSyncState?.(dirty.size ? 'syncing' : 'synced');
    } catch {
      // Keep the newest copy queued; the next save (or flush) retries.
      for (const row of rows) {
        if (!dirty.has(row.table_name)) dirty.set(row.table_name, JSON.stringify(row.data));
      }
      onSyncState?.('offline');
    }
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      inflight = pushNow().finally(() => {
        inflight = null;
      });
    }, PUSH_DELAY_MS);
  }

  return {
    getItem: (key) => local.getItem(accountKey(userId, key)),
    async setItem(key, value) {
      await local.setItem(accountKey(userId, key), value);
      const table = tableFromKey(key);
      if (table && TABLES.includes(table)) {
        dirty.set(table, value);
        schedule();
      }
    },
    /** Push anything pending right away (e.g. app going to background). */
    async flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (inflight) await inflight;
      await pushNow();
    },
    hasPending: () => dirty.size > 0,
  };
}

/**
 * Sign-in sync: cloud wins. If the account is brand new in the cloud, upload
 * whatever this phone already has (its account cache, or the guest data).
 *
 * @returns {Promise<{ source: 'cloud'|'migrated-guest'|'uploaded-cache'|'empty'|'offline' }>}
 */
export async function pullAccount({ local, supabase, userId }) {
  let rows;
  try {
    const { data, error } = await supabase.from('user_data').select('table_name, data').eq('user_id', userId);
    if (error) throw error;
    rows = data || [];
  } catch {
    return { source: 'offline' }; // keep using the local cache
  }

  if (rows.length) {
    for (const row of rows) {
      if (!TABLES.includes(row.table_name)) continue;
      await local.setItem(accountKey(userId, ENGINE_PREFIX + row.table_name), JSON.stringify(row.data || {}));
    }
    return { source: 'cloud' };
  }

  // Nothing in the cloud yet: seed it from this phone.
  const fromCache = await readTables(local, (t) => accountKey(userId, ENGINE_PREFIX + t));
  const fromGuest = await readTables(local, (t) => ENGINE_PREFIX + t);
  const seed = hasData(fromCache) ? fromCache : hasData(fromGuest) ? fromGuest : null;
  if (!seed) return { source: 'empty' };

  for (const [table, json] of Object.entries(seed)) {
    await local.setItem(accountKey(userId, ENGINE_PREFIX + table), json);
  }
  try {
    const now = new Date().toISOString();
    const { error } = await supabase.from('user_data').upsert(
      Object.entries(seed).map(([table_name, json]) => ({
        user_id: userId,
        table_name,
        data: JSON.parse(json),
        updated_at: now,
      })),
      { onConflict: 'user_id,table_name' },
    );
    if (error) throw error;
    // Guest data now belongs to this account; don't hand it to the next person
    // who signs in on this phone.
    if (seed === fromGuest) {
      for (const t of Object.keys(fromGuest)) await local.removeItem?.(ENGINE_PREFIX + t);
    }
  } catch {
    // Stays in the local cache; it uploads with the next save.
  }
  return { source: seed === fromCache ? 'uploaded-cache' : 'migrated-guest' };
}

async function readTables(local, keyFor) {
  const out = {};
  for (const t of TABLES) {
    const raw = await local.getItem(keyFor(t));
    if (raw) out[t] = raw;
  }
  return out;
}

function hasData(tables) {
  return Object.values(tables).some((json) => {
    try {
      return Object.keys(JSON.parse(json) || {}).length > 0;
    } catch {
      return false;
    }
  });
}

/** Remove this account's cached tables from the phone (sign-out / delete). */
export async function clearAccountCache(local, userId) {
  for (const t of TABLES) {
    await local.removeItem?.(accountKey(userId, ENGINE_PREFIX + t));
  }
}
