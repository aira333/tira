// src/tira/AuthProvider.js
// Who is using Tira (Google account or guest) and where their data lives.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { accountAdapter, clearAccountCache, guestAdapter, pullAccount } from './cloud';
import { cloudEnabled } from './config';
import { cancelAllReminders } from './device';
import {
  deleteMyAccount,
  profileFromUser,
  signInWithGoogle,
  signOut as supabaseSignOut,
  supabase,
  upsertProfile,
} from './supabase';

const MODE_KEY = 'tira.auth.mode'; // 'guest' once someone taps "Continue without an account"

const local = {
  getItem: (k) => AsyncStorage.getItem(k),
  setItem: (k, v) => AsyncStorage.setItem(k, v),
  removeItem: (k) => AsyncStorage.removeItem(k),
};

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  /** loading | signedOut | guest | signedIn */
  const [status, setStatus] = useState('loading');
  const [profile, setProfile] = useState(null);
  const [adapter, setAdapter] = useState(null);
  /** synced | syncing | offline */
  const [syncState, setSyncState] = useState('synced');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const adapterRef = useRef(null);
  const userIdRef = useRef(null);

  const switchToGuest = useCallback(() => {
    const a = guestAdapter(local);
    a.key = 'guest';
    adapterRef.current = a;
    userIdRef.current = null;
    setAdapter(a);
    setProfile(null);
    setStatus('guest');
  }, []);

  const switchToAccount = useCallback(async (user) => {
    const p = profileFromUser(user);
    if (userIdRef.current === p.id) {
      setProfile(p); // already loading or loaded this account
      return;
    }
    userIdRef.current = p.id;
    setSyncState('syncing');
    const result = await pullAccount({ local, supabase, userId: p.id });
    setSyncState(result.source === 'offline' ? 'offline' : 'synced');
    upsertProfile(p).catch(() => {});
    const a = accountAdapter({ local, supabase, userId: p.id, onSyncState: setSyncState });
    a.key = `acct:${p.id}`;
    adapterRef.current = a;
    setAdapter(a);
    setProfile(p);
    setStatus('signedIn');
  }, []);

  // Restore the last session on launch.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!cloudEnabled) {
        switchToGuest(); // no backend configured: on-device mode
        return;
      }
      const { data } = await supabase.auth.getSession();
      if (!alive) return;
      if (data?.session?.user) {
        await switchToAccount(data.session.user);
        return;
      }
      const mode = await AsyncStorage.getItem(MODE_KEY);
      if (mode === 'guest') switchToGuest();
      else setStatus('signedOut');
    })();

    const sub = supabase?.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user) switchToAccount(session.user);
    });
    return () => {
      alive = false;
      sub?.data?.subscription?.unsubscribe();
    };
  }, [switchToAccount, switchToGuest]);

  // Push pending changes when the app goes to the background.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') adapterRef.current?.flush?.();
    });
    return () => sub.remove();
  }, []);

  const signIn = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await signInWithGoogle();
      if (!res.ok && !res.cancelled) setError(res.error || 'Google sign-in did not finish. Please try again.');
      if (res.ok) {
        await AsyncStorage.removeItem(MODE_KEY);
        const { data } = await supabase.auth.getSession();
        if (data?.session?.user) await switchToAccount(data.session.user);
      }
    } catch (e) {
      setError(e?.message || 'Google sign-in failed. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }, [switchToAccount]);

  const continueAsGuest = useCallback(async () => {
    await AsyncStorage.setItem(MODE_KEY, 'guest');
    switchToGuest();
  }, [switchToGuest]);

  const leaveAccount = useCallback(async () => {
    const id = userIdRef.current;
    await adapterRef.current?.flush?.();
    await cancelAllReminders().catch(() => {});
    if (id) await clearAccountCache(local, id);
    adapterRef.current = null;
    userIdRef.current = null;
    setAdapter(null);
    setProfile(null);
    await AsyncStorage.removeItem(MODE_KEY);
    setStatus('signedOut');
  }, []);

  const signOut = useCallback(async () => {
    await leaveAccount();
    await supabaseSignOut();
  }, [leaveAccount]);

  /** Deletes the Google-linked account and every row it owns. */
  const deleteAccount = useCallback(async () => {
    setBusy(true);
    try {
      const res = await deleteMyAccount();
      if (!res.ok) {
        setError(res.error);
        return false;
      }
      await leaveAccount();
      return true;
    } finally {
      setBusy(false);
    }
  }, [leaveAccount]);

  /** From guest mode: show the sign-in screen again. */
  const goToSignIn = useCallback(async () => {
    await AsyncStorage.removeItem(MODE_KEY);
    setStatus('signedOut');
  }, []);

  const value = useMemo(
    () => ({
      status,
      profile,
      adapter,
      syncState,
      busy,
      error,
      cloudEnabled,
      signIn,
      continueAsGuest,
      signOut,
      deleteAccount,
      goToSignIn,
      clearError: () => setError(null),
    }),
    [status, profile, adapter, syncState, busy, error, signIn, continueAsGuest, signOut, deleteAccount, goToSignIn],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
