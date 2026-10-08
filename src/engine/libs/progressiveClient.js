// src/engine/libs/progressiveClient.js
// Alexa progressive responses have no equivalent in Tira: the app shows a
// "thinking" state while a turn runs. Kept as a no-op for engine parity.

async function sendProgress() {}

module.exports = {
  sendProgress,
};
