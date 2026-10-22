// src/tira/supabase.js
// Supabase client + Google sign-in through the system browser.

import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { AppState, Platform } from 'react-native';

import { SUPABASE_ANON_KEY, SUPABASE_URL, cloudEnabled } from './config';

WebBrowser.maybeCompleteAuthSession();

export const supabase = cloudEnabled
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: Platform.OS === 'web',
        flowType: 'pkce',
      },
    })
  : null;

// Refresh tokens only while the app is in the foreground.
if (supabase && Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

/** Where Google sends the user back: tira://auth/callback (exp://… in Expo Go). */
export function authRedirectUri() {
  return AuthSession.makeRedirectUri({ scheme: 'tira', path: 'auth/callback' });
}

/**
 * Open Google sign-in in the system browser and finish the session.
 * @returns {Promise<{ ok: boolean, cancelled?: boolean, error?: string }>}
 */
export async function signInWithGoogle() {
  if (!supabase) return { ok: false, error: 'Cloud sign-in is not configured.' };
  const redirectTo = authRedirectUri();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: Platform.OS !== 'web',
      queryParams: { prompt: 'select_account' },
    },
  });
  if (error) return { ok: false, error: error.message };
  if (Platform.OS === 'web') return { ok: true }; // the page redirects

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') return { ok: false, cancelled: true };

  const url = new URL(result.url);
  const code = url.searchParams.get('code');
  const errDesc = url.searchParams.get('error_description');
  if (errDesc) return { ok: false, error: errDesc };
  if (!code) return { ok: false, error: 'Google did not return a sign-in code.' };

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) return { ok: false, error: exchangeError.message };
  return { ok: true };
}

export async function signOut() {
  if (supabase) await supabase.auth.signOut();
}

/** Permanently delete the signed-in account and all of its cloud data. */
export async function deleteMyAccount() {
  if (!supabase) return { ok: false, error: 'Cloud is not configured.' };
  const { error } = await supabase.rpc('delete_my_account');
  if (error) return { ok: false, error: error.message };
  await supabase.auth.signOut();
  return { ok: true };
}

/** Name/photo/email from the Google identity. */
export function profileFromUser(user) {
  if (!user) return null;
  const meta = user.user_metadata || {};
  const fullName = meta.full_name || meta.name || '';
  const givenName = meta.given_name || fullName.split(' ')[0] || '';
  return {
    id: user.id,
    email: user.email || meta.email || '',
    fullName,
    givenName,
    avatarUrl: meta.avatar_url || meta.picture || '',
  };
}

/** Create/refresh the customer's row in `profiles`. */
export async function upsertProfile(profile) {
  if (!supabase || !profile) return;
  await supabase.from('profiles').upsert(
    {
      id: profile.id,
      email: profile.email,
      full_name: profile.fullName,
      given_name: profile.givenName,
      avatar_url: profile.avatarUrl,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  );
}
