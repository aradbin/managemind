// Light or dark (ADR 0029): the device's setting unless this device chose
// one. The choice is applied to <html data-theme> before the first render, so
// the tokens in styles.css never flash the other theme once the app starts.
import { useSyncExternalStore } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';
export const THEME_CHOICES: readonly ThemeChoice[] = ['system', 'light', 'dark'];

// v2: the header's old one-press toggle could only save light or dark, so
// choices saved under the first key are dropped and everyone starts on the
// device's setting again.
const KEY = 'mm.theme.v2';
const OLD_KEY = 'mm.theme';
const listeners = new Set<() => void>();

/** A stored value as a choice; anything else follows the device. */
export function parseThemeChoice(value: unknown): ThemeChoice {
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function resolveTheme(choice: ThemeChoice, deviceDark: boolean): 'light' | 'dark' {
  return choice === 'system' ? (deviceDark ? 'dark' : 'light') : choice;
}

function deviceDark() {
  return window.matchMedia('(prefers-color-scheme: dark)');
}

function stored(): ThemeChoice {
  try {
    localStorage.removeItem(OLD_KEY);
    return parseThemeChoice(localStorage.getItem(KEY));
  } catch {
    return 'system';
  }
}

let current: ThemeChoice = 'system';
let resolved: 'light' | 'dark' = 'light';

function themeChoice(): ThemeChoice {
  return current;
}

function resolvedTheme(): 'light' | 'dark' {
  return resolved;
}

function apply(choice: ThemeChoice) {
  resolved = resolveTheme(choice, deviceDark().matches);
  document.documentElement.dataset.theme = resolved;
}

/** Applies the choice, and follows the device while it is "system". */
export function initTheme(): void {
  current = stored();
  apply(current);
  deviceDark().addEventListener('change', () => {
    apply(current);
    for (const listener of listeners) listener();
  });
}

export function setThemeChoice(choice: ThemeChoice): void {
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Not remembered on this device; still switched for this visit.
  }
  current = choice;
  apply(choice);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(subscribe, themeChoice);
}

/** The theme on screen: the choice, or the device's while it is "system". */
export function useResolvedTheme(): 'light' | 'dark' {
  return useSyncExternalStore(subscribe, resolvedTheme);
}
