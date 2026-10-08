#!/usr/bin/env node
// Scripted conversations against the Tira engine (Node, in-memory storage).
// Usage: npm run test:engine        (add --verbose to print every turn)

const assert = require('assert');
const {
  createTira,
  initStore,
  configurePlatform,
  stripWakeWord,
} = require('../src/engine');

const verbose = process.argv.includes('--verbose');

const calls = [];
const reminders = [];
configurePlatform({
  async placeCall({ phone }) {
    calls.push(phone);
    return { ok: true };
  },
  async scheduleReminder(opts) {
    reminders.push(opts);
    return { ok: true, id: `notif-${reminders.length}` };
  },
  async cancelReminder() {
    return { ok: true };
  },
});

let passed = 0;
let failed = 0;

async function scenario(name, fn) {
  await initStore(null);
  calls.length = 0;
  reminders.length = 0;
  const tira = createTira({ userId: 'test-user' });
  const say = async (text) => {
    const r = await tira.turn(text);
    if (verbose) console.log(`   you:  ${text}\n   tira: ${r.speech}`);
    return r;
  };
  try {
    if (verbose) console.log(`\n▶ ${name}`);
    await fn({ tira, say });
    passed += 1;
    console.log(`✅ ${name}`);
  } catch (e) {
    failed += 1;
    console.log(`❌ ${name}\n   ${e.message}`);
  }
}

function has(r, re) {
  assert.match(r.speech, re, `expected ${re} in: "${r.speech}"`);
}

(async () => {
  await scenario('wake word parsing', async () => {
    assert.deepStrictEqual(stripWakeWord('Tira, add milk'), { woke: true, text: 'add milk' });
    assert.deepStrictEqual(stripWakeWord('hey tira what is on my list'), {
      woke: true,
      text: 'what is on my list',
    });
    assert.deepStrictEqual(stripWakeWord('add milk'), { woke: false, text: 'add milk' });
    assert.strictEqual(stripWakeWord('Tiara.').woke, true);
  });

  await scenario('launch greets as Tira', async ({ tira }) => {
    const r = await tira.launch();
    has(r, /Welcome to Tira/);
  });

  await scenario('bare wake word asks what to do', async ({ say }) => {
    has(await say('Tira'), /listening/i);
  });

  await scenario('add appointment in one shot with reminder', async ({ say }) => {
    let r = await say('Tira, add an appointment with doctor Smith tomorrow at 2 pm');
    for (let i = 0; i < 6 && !/saved|added|scheduled|booked/i.test(r.speech); i += 1) {
      if (/location/i.test(r.speech)) r = await say('skip location');
      else if (/reminder/i.test(r.speech)) r = await say('1 hour');
      else if (/how long|duration/i.test(r.speech)) r = await say('default');
      else if (/\?/.test(r.speech)) r = await say('yes');
      else break;
    }
    has(r, /Smith/i);
    has(r, /remind you 1 hour before/i);
    assert.strictEqual(reminders.length, 1);
    const list = await say('what appointments do I have');
    has(list, /Smith/i);
  });

  await scenario('multi-turn appointment intake', async ({ say }) => {
    let r = await say('add an appointment');
    has(r, /doctor|who/i);
    r = await say('doctor Patel');
    has(r, /day|date|when/i);
  });

  await scenario('shopping list add + read', async ({ say }) => {
    let r = await say('Tira, add milk and eggs to my Target shopping list');
    for (let i = 0; i < 3 && /\?/.test(r.speech) && !/added/i.test(r.speech); i += 1) {
      r = await say('yes');
    }
    has(r, /milk/i);
    r = await say("what's on my Target shopping list");
    has(r, /milk/i);
    has(r, /eggs/i);
  });

  await scenario('to-do list add + read', async ({ say }) => {
    let r = await say('add call the pharmacy to my errands to do list');
    for (let i = 0; i < 3 && /\?/.test(r.speech) && !/added/i.test(r.speech); i += 1) {
      r = await say('yes');
    }
    r = await say("what's on my errands to do list");
    has(r, /pharmacy/i);
  });

  await scenario('name is remembered', async ({ tira, say }) => {
    await say('my name is Rohit');
    const r = await tira.launch();
    has(r, /Rohit/);
  });

  await scenario('help menu', async ({ say }) => {
    has(await say('help'), /appointments/i);
  });

  await scenario('ride: save transport then request ride dials phone', async ({ say }) => {
    let r = await say('my transport is City Rides number 617 555 0100');
    for (let i = 0; i < 3 && /\?/.test(r.speech) && !/saved/i.test(r.speech); i += 1) {
      r = await say('yes');
    }
    r = await say('request a ride to the library tomorrow at 10 am');
    for (let i = 0; i < 8 && calls.length === 0; i += 1) {
      if (/say yes to connect/i.test(r.speech)) { r = await say('yes'); continue; }
      if (/what is your phone number/i.test(r.speech)) r = await say('617 555 0199');
      else if (/what time|pick ?up time/i.test(r.speech)) r = await say('10 am');
      else if (/what day|which day|date/i.test(r.speech)) r = await say('tomorrow');
      else if (/\?/.test(r.speech)) r = await say('yes');
      else break;
    }
    assert.deepStrictEqual(calls, ['+16175550100'], `last speech: ${r.speech}`);
  });

  await scenario('stop ends the session', async ({ say }) => {
    const r = await say('Tira, stop');
    assert.strictEqual(r.endSession, true);
  });

  await scenario('cancel mid-dialogue keeps session open', async ({ say, tira }) => {
    await say('add an appointment');
    assert.strictEqual(tira.isMidDialogue(), true);
    const r = await say('cancel');
    assert.strictEqual(r.endSession, false);
    assert.strictEqual(tira.isMidDialogue(), false);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
