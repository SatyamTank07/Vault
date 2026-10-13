import { useSyncExternalStore } from 'react';

export type ThemePref = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'vault_theme';
const THEME_EVENT = 'vault:theme';
const darkQuery = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

export function getThemePref(): ThemePref {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // Storage can be blocked (private mode, site data off); fall back to the system theme.
  }
  return 'system';
}

function applyPref(pref: ThemePref) {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
}

/** Call once before the first render so the stored theme applies without a flash. */
export function applyStoredTheme() {
  applyPref(getThemePref());
}

export function setThemePref(pref: ThemePref) {
  try {
    if (pref === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    // Not persisted, but still applied for this session.
  }
  applyPref(pref);
  window.dispatchEvent(new Event(THEME_EVENT));
}

function resolve(): ResolvedTheme {
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'light' || attr === 'dark') return attr;
  return darkQuery?.matches ? 'dark' : 'light';
}

function subscribe(onChange: () => void) {
  window.addEventListener(THEME_EVENT, onChange);
  darkQuery?.addEventListener('change', onChange);
  return () => {
    window.removeEventListener(THEME_EVENT, onChange);
    darkQuery?.removeEventListener('change', onChange);
  };
}

/** The theme actually on screen, following the OS when the preference is "system". */
export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribe, resolve, () => 'light');
}

/** The stored preference (light / dark / system), for the account menu. */
export function useThemePref(): ThemePref {
  return useSyncExternalStore(subscribe, getThemePref, () => 'system');
}
