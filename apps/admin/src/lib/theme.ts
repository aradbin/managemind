// Light or dark (ADR 0029): the device's setting unless this device chose
// one. The choice is applied to <html data-theme> before the first render, so
// the tokens in styles.css never flash the other theme once the app starts.
import { useSyncExternalStore } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';
export const THEME_CHOICES: readonly ThemeChoice[] = ['system', 'light', 'dark'];

const KEY = 'mm.theme';
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
    return parseThemeChoice(localStorage.getItem(KEY));
  } catch {
    return 'system';
  }
}

let current: ThemeChoice = 'system';

function themeChoice(): ThemeChoice {
  return current;
}

function apply(choice: ThemeChoice) {
  document.documentElement.dataset.theme = resolveTheme(choice, deviceDark().matches);
}

/** Applies the choice, and follows the device while it is "system". */
export function initTheme(): void {
  current = stored();
  apply(current);
  deviceDark().addEventListener('change', () => apply(current));
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
