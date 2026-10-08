// src/engine/platform.js
// Device capabilities the engine needs, injected by the app at startup.
// Defaults are safe no-ops so the engine runs in Node tests.

const impl = {
  /** @returns {Promise<{ ok: boolean }>} */
  async placeCall() {
    return { ok: false };
  },
  /** @returns {Promise<{ ok: boolean, id?: string|null, reason?: string }>} */
  async scheduleReminder() {
    return { ok: false, reason: 'skipped' };
  },
  /** @returns {Promise<{ ok: boolean, reason?: string }>} */
  async cancelReminder() {
    return { ok: false, reason: 'skipped' };
  },
};

function configurePlatform(overrides = {}) {
  for (const [key, fn] of Object.entries(overrides)) {
    if (typeof fn === 'function' && key in impl) impl[key] = fn;
  }
}

module.exports = {
  configurePlatform,
  placeCall: (opts) => impl.placeCall(opts),
  scheduleReminder: (opts) => impl.scheduleReminder(opts),
  cancelReminder: (opts) => impl.cancelReminder(opts),
};
