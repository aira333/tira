#!/usr/bin/env node
// Cloud sync tests with an in-memory phone store and a fake Supabase table.
// Usage: npm run test:cloud

const assert = require('assert');
const { accountAdapter, guestAdapter, pullAccount } = require('../src/tira/cloud.js');
const { createTira, initStore, store } = require('../src/engine');

function memoryLocal() {
  const m = new Map();
  return {
    m,
    getItem: async (k) => (m.has(k) ? m.get(k) : null),
    setItem: async (k, v) => void m.set(k, v),
    removeItem: async (k) => void m.delete(k),
  };
}

/** Just enough of supabase.from('user_data') for cloud.js. */
function fakeSupabase({ online = true } = {}) {
  const rows = new Map(); // `${user}|${table}` → row
  const api = {
    rows,
    online,
    from(name) {
      assert.strictEqual(name, 'user_data');
      return {
        upsert: async (list) => {
          if (!api.online) return { error: new Error('offline') };
          for (const r of list) rows.set(`${r.user_id}|${r.table_name}`, r);
          return { error: null };
        },
        select: () => ({
          eq: async (_col, userId) => {
            if (!api.online) return { data: null, error: new Error('offline') };
            return { data: [...rows.values()].filter((r) => r.user_id === userId), error: null };
          },
        }),
      };
    },
  };
  return api;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`✅ ${name}`);
  } catch (e) {
    failed += 1;
    console.log(`❌ ${name}\n   ${e.stack}`);
  }
}

async function addShopping(tira) {
  await tira.turn('add milk and eggs to my Target shopping list');
}

(async () => {
  // Quiet engine logs.
  const log = console.log;
  console.log = (...a) => (typeof a[0] === 'string' && a[0].startsWith('{') ? undefined : log(...a));

  await test('saves go to the phone and then the cloud', async () => {
    const local = memoryLocal();
    const sb = fakeSupabase();
    const adapter = accountAdapter({ local, supabase: sb, userId: 'u1' });
    await initStore(adapter);
    await addShopping(createTira({ userId: 'device-user' }));
    assert.ok(local.m.has('tira.acct.u1.tira.table.shopping'), 'local cache written');
    await adapter.flush();
    const row = sb.rows.get('u1|shopping');
    assert.ok(row, 'cloud row written');
    assert.match(JSON.stringify(row.data), /milk/);
  });

  await test('signing in on a new phone restores the customer from the cloud', async () => {
    const sb = fakeSupabase();
    // Phone A
    const a = accountAdapter({ local: memoryLocal(), supabase: sb, userId: 'u2' });
    await initStore(a);
    const tiraA = createTira({ userId: 'device-user' });
    await tiraA.turn('my name is Priya');
    await addShopping(tiraA);
    await a.flush();
    // Phone B
    const localB = memoryLocal();
    const res = await pullAccount({ local: localB, supabase: sb, userId: 'u2' });
    assert.strictEqual(res.source, 'cloud');
    await initStore(accountAdapter({ local: localB, supabase: sb, userId: 'u2' }));
    const tiraB = createTira({ userId: 'device-user' });
    const hello = await tiraB.launch();
    assert.match(hello.speech, /Priya/);
    const list = await tiraB.turn("what's on my Target list");
    assert.match(list.speech, /milk/);
  });

  await test('first sign-in moves guest data into the account and clears it from guest', async () => {
    const local = memoryLocal();
    const sb = fakeSupabase();
    await initStore(guestAdapter(local));
    await addShopping(createTira({ userId: 'device-user' }));
    assert.ok(local.m.has('tira.table.shopping'));
    const res = await pullAccount({ local, supabase: sb, userId: 'u3' });
    assert.strictEqual(res.source, 'migrated-guest');
    assert.ok(sb.rows.get('u3|shopping'), 'uploaded');
    assert.ok(!local.m.has('tira.table.shopping'), 'guest copy removed');
    await initStore(accountAdapter({ local, supabase: sb, userId: 'u3' }));
    const lists = await store.getAllShoppingLists('device-user');
    assert.strictEqual(lists.length, 1);
  });

  await test('customers on the same phone do not see each other’s data', async () => {
    const local = memoryLocal();
    const sb = fakeSupabase();
    await initStore(accountAdapter({ local, supabase: sb, userId: 'alice' }));
    await addShopping(createTira({ userId: 'device-user' }));
    await pullAccount({ local, supabase: sb, userId: 'bob' });
    await initStore(accountAdapter({ local, supabase: sb, userId: 'bob' }));
    const lists = await store.getAllShoppingLists('device-user');
    assert.strictEqual(lists.length, 0);
  });

  await test('offline saves are kept and uploaded later', async () => {
    const local = memoryLocal();
    const sb = fakeSupabase({ online: false });
    const states = [];
    const adapter = accountAdapter({ local, supabase: sb, userId: 'u4', onSyncState: (s) => states.push(s) });
    await initStore(adapter);
    await addShopping(createTira({ userId: 'device-user' }));
    await adapter.flush();
    assert.ok(states.includes('offline'));
    assert.ok(adapter.hasPending());
    sb.online = true;
    await adapter.flush();
    assert.ok(sb.rows.get('u4|shopping'));
    assert.strictEqual(adapter.hasPending(), false);
  });

  await test('debounced push happens without an explicit flush', async () => {
    const sb = fakeSupabase();
    const adapter = accountAdapter({ local: memoryLocal(), supabase: sb, userId: 'u5' });
    await initStore(adapter);
    await addShopping(createTira({ userId: 'device-user' }));
    await wait(1200);
    assert.ok(sb.rows.get('u5|shopping'));
  });

  console.log = log;
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
