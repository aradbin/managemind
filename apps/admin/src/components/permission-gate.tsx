// Hides what the user's role can't do. Only a convenience: the server checks
// every request itself (phase-1-plan §7.3).
import type { Permission } from '@managemind/shared/permissions';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { meQuery } from '../lib/api';

export function usePermission(permission: Permission): boolean {
  const { data } = useQuery(meQuery);
  return data?.permissions.includes(permission) ?? false;
}

export function PermissionGate({
  allow,
  children,
  fallback = null,
}: {
  allow: Permission;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return usePermission(allow) ? children : fallback;
}
