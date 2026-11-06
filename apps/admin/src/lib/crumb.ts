// The record a page shows (ADR 0034). On desktops its name ends the header
// breadcrumb ("Orders › Order #1053"); on phones the page brings its own
// header (back, name, ⋯) in place of the store's, and, as drawn on most
// record boards, the tab bar steps aside for the page's own actions.
import { useEffect, useSyncExternalStore } from 'react';

export interface RecordPage {
  path: string;
  title: string | undefined;
  /** The phone tab bar stays under the page. */
  tabBar: boolean;
}

let current: RecordPage | null = null;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

/** Marks the page as a record's, named `title` once it has loaded. */
export function useRecordPage(title: string | undefined, { tabBar = false } = {}): void {
  useEffect(() => {
    const mine: RecordPage = { path: window.location.pathname, title, tabBar };
    current = mine;
    emit();
    return () => {
      if (current === mine) {
        current = null;
        emit();
      }
    };
  }, [title, tabBar]);
}

/** The record page at this address, if one is open. */
export function useRecord(path: string): RecordPage | null {
  const c = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
  return c && c.path === path ? c : null;
}
