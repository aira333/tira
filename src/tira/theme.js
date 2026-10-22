// src/tira/theme.js
// Neutral stone palette with phthalo green as the single highlight.
// Type: Bricolage Grotesque for the wordmark and headings, Atkinson Hyperlegible
// (designed by the Braille Institute for low-vision readers) for everything else.

export const colors = {
  // Neutrals (warm stone, slightly green-biased so the accent sits naturally)
  bg: '#F4F3EF',
  bgTop: '#F4F3EF',
  surface: '#FFFFFF',
  surfaceRaised: '#ECEBE6',
  border: '#DEDCD4',
  text: '#151917',
  textMuted: '#5A605C',
  // Phthalo green
  accent: '#123524',
  accentDeep: '#0B2418',
  accentMid: '#1E5A3E',
  accentSoft: '#E2ECE6',
  accentText: '#FFFFFF',
  // States
  listening: '#2E8B62',
  listeningDeep: '#1F6B4A',
  thinking: '#7A807C',
  danger: '#B42318',
  // Chat
  userBubble: '#123524',
  userBubbleText: '#FFFFFF',
  tiraBubble: '#FFFFFF',
};

export const gradients = {
  screen: [colors.bg, colors.bg],
  accent: ['#1E5A3E', '#123524'],
  listening: ['#3BA176', '#1F6B4A'],
  thinking: ['#9AA09C', '#6B716D'],
  card: ['#FFFFFF', '#FFFFFF'],
  hero: ['#1A4A33', '#123524', '#0B2418'],
};

export const fonts = {
  brand: 'BricolageGrotesque_800ExtraBold',
  display: 'BricolageGrotesque_700Bold',
  displaySemi: 'BricolageGrotesque_600SemiBold',
  body: 'AtkinsonHyperlegible_400Regular',
  bodyBold: 'AtkinsonHyperlegible_700Bold',
};

export const type = {
  hero: 34,
  title: 28,
  heading: 22,
  body: 20,
  small: 17,
  tiny: 15,
};

export const radius = {
  card: 22,
  control: 16,
  pill: 999,
};

export const shadow = {
  card: {
    shadowColor: '#1B231F',
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
};

export const space = (n) => n * 8;
