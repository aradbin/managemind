// Which store the admin works in. A new session has none, so the shell picks
// the one this device used last, else the first: never a store reached only
// through a support grant, which needs a deliberate choice.
import type { QueryClient } from '@tanstack/react-query';
import { api, type Me, meQuery, unwrap } from './api';

const KEY = 'mm.store';

export function rememberStore(tenantId: string): void {
  try {
    localStorage.setItem(KEY, tenantId);
  } catch {
    // Not remembered on this device.
  }
}

function lastStore(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export async function switchStore(queryClient: QueryClient, tenantId: string): Promise<Me> {
  const me = unwrap(await api.PUT('/v1/admin/me/active-store', { body: { tenantId } }));
  rememberStore(tenantId);
  queryClient.setQueryData(meQuery.queryKey, me);
  return me;
}

export async function chooseStore(queryClient: QueryClient, me: Me): Promise<void> {
  if (me.activeStore) {
    rememberStore(me.activeStore);
    return;
  }
  const own = me.stores.filter((s) => !s.supportUntil);
  const pick = own.find((s) => s.tenantId === lastStore()) ?? own[0];
  // Best effort: without a store the shell still works, and the user can pick one.
  if (pick) await switchStore(queryClient, pick.tenantId).catch(() => undefined);
}

/**
 * After the user's access changed (left a store, ended support): drop every
 * store's data and refetch /me in place. Not queryClient.clear(): mounted
 * screens would keep showing the removed queries' old data.
 */
export async function refreshAccess(queryClient: QueryClient): Promise<Me> {
  queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
  const me = await queryClient.fetchQuery({ ...meQuery, staleTime: 0 });
  await chooseStore(queryClient, me);
  return me;
}
