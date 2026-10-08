/**
 * Tira brand — change THIS FILE to rename the assistant.
 *
 * - displayName: what Tira says in speech and shows in the app
 * - invocationName: the wake word the user starts a request with ("Tira, …")
 * - wakeWordVariants: common speech-to-text mis-hearings of the wake word
 */
module.exports = {
  displayName: 'Tira',

  invocationName: 'tira',

  wakeWordVariants: ['tira', 'tiara', 'tyra', 'teera', 'tera', 'terra', 'tiera', 'keira'],

  summary: 'Voice helper for appointments, rides, shopping, and to-dos',

  description:
    'Tira helps with doctor appointments, transport calls, shopping lists, and to-dos — built for voice-first use.',

  examplePhrases: [
    'Tira, add an appointment',
    'Tira, what is on my shopping list',
    'Tira, request a ride to my appointment',
  ],
};
