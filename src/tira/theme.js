// src/tira/theme.js
// High-contrast palette and large type (Tira is built for low-vision users).

export const colors = {
  bg: '#0A0F1E',
  bgTop: '#141E3C',
  surface: '#131B31',
  surfaceRaised: '#1C2744',
  border: '#2C3A5E',
  text: '#F8FAFC',
  textMuted: '#AEBAD3',
  accent: '#FBBF24',
  accentDeep: '#F59E0B',
  accentText: '#111827',
  listening: '#34D399',
  listeningDeep: '#059669',
  thinking: '#818CF8',
  danger: '#F87171',
  userBubble: '#FBBF24',
  userBubbleText: '#111827',
  tiraBubble: '#1C2744',
};

export const gradients = {
  screen: [colors.bgTop, colors.bg],
  accent: [colors.accent, colors.accentDeep],
  listening: [colors.listening, colors.listeningDeep],
  thinking: ['#A5B4FC', '#6366F1'],
  card: ['#1E2A4A', '#151E36'],
};

export const type = {
  hero: 34,
  title: 30,
  heading: 22,
  body: 20,
  small: 17,
  tiny: 15,
};

export const radius = {
  card: 20,
  pill: 999,
};

export const space = (n) => n * 8;
