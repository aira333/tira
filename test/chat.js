#!/usr/bin/env node
// Talk to Tira in the terminal (in-memory data; resets when you quit).
// Usage: npm run chat            Type "quit" to exit.
//        npm run chat -- --mute  Text only, no voice.

const readline = require('readline');
const { spawn } = require('child_process');
const { createTira, initStore, configurePlatform } = require('../src/engine');

// Engine logs are JSON lines; keep the chat readable.
const realLog = console.log;
console.log = (...args) => {
  if (typeof args[0] === 'string' && args[0].startsWith('{')) return;
  realLog(...args);
};
console.info = () => {};
console.warn = () => {};

const muted = process.argv.includes('--mute');

/** Speak with the OS voice (Windows SAPI, macOS say, Linux espeak). Resolves when done. */
function speak(text) {
  if (muted || !text) return Promise.resolve();
  let cmd;
  let args;
  if (process.platform === 'win32') {
    cmd = 'powershell';
    args = [
      '-NoProfile',
      '-Command',
      'Add-Type -AssemblyName System.Speech; ' +
        '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ' +
        '$s.Speak([Console]::In.ReadToEnd())',
    ];
  } else if (process.platform === 'darwin') {
    cmd = 'say';
    args = [];
  } else {
    cmd = 'espeak';
    args = ['--stdin'];
  }
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('error', () => resolve());
    child.on('close', () => resolve());
    child.stdin.end(text);
  });
}

configurePlatform({
  async placeCall({ phone }) {
    realLog(`   📞 [would open the dialer to ${phone}]`);
    return { ok: true };
  },
  async scheduleReminder({ fireAtIso, title }) {
    realLog(`   🔔 [would notify "${title}" at ${new Date(fireAtIso).toLocaleString()}]`);
    return { ok: true, id: `reminder-${Date.now()}` };
  },
  async cancelReminder() {
    return { ok: true };
  },
});

(async () => {
  await initStore(null);
  const tira = createTira({ userId: 'terminal-user' });
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'you › ' });
  // Grab the iterator now so piped lines are buffered while Tira speaks.
  const lines = rl[Symbol.asyncIterator]();

  let closed = false;
  rl.on('close', () => {
    closed = true;
  });
  const prompt = () => {
    if (!closed) rl.prompt();
  };

  const welcome = await tira.launch();
  realLog(`tira › ${welcome.speech}\n`);
  await speak(welcome.speech);
  prompt();

  for await (const line of lines) {
    const text = line.trim();
    if (!process.stdin.isTTY && text) realLog(text);
    if (/^(quit|exit)$/i.test(text)) break;
    if (text) {
      const reply = await tira.turn(text);
      realLog(`tira › ${reply.speech}${reply.endSession ? '  [session ended]' : ''}
`);
      await speak(reply.speech);
    }
    prompt();
  }
  rl.close();
  process.exit(0);
})();
