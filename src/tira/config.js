// src/tira/config.js
// Cloud settings come from .env (see .env.example). Without them, Tira runs
// in on-device mode: everything works, nothing syncs.

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

export const cloudEnabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
