// src/tira/theme.js
// High-contrast palette and large type (Tira is built for low-vision users).

export const colors = {
  bg: '#0B1220',
  surface: '#16213A',
  surfaceRaised: '#1F2D4D',
  border: '#33456E',
  text: '#F8FAFC',
  textMuted: '#B6C2D9',
  accent: '#FBBF24',
  accentText: '#111827',
  listening: '#34D399',
  danger: '#F87171',
  userBubble: '#FBBF24',
  userBubbleText: '#111827',
  tiraBubble: '#1F2D4D',
};

export const type = {
  title: 30,
  heading: 22,
  body: 20,
  small: 17,
};

export const space = (n) => n * 8;
