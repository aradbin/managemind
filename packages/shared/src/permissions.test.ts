import { describe, expect, it } from 'vitest';
import {
  canManageRole,
  coversRole,
  isPlatformRole,
  isStoreRole,
  PERMISSIONS,
  type Permission,
  permissionsOf,
  STORE_ROLES,
  type StoreRole,
} from './permissions';

describe('role matrix', () => {
  // The reviewed matrix (phase-1-plan §5.2, approved Oct 11). A change to any
  // role must change this list on purpose.
  const expected: Record<StoreRole, Permission[]> = {
    owner: [...PERMISSIONS],
    manager: PERMISSIONS.filter((p) => p !== 'staff.manage_owners' && p !== 'billing.read'),
    staff: [
      'settings.read',
      'catalog.read',
      'catalog.write',
      'inventory.read',
      'inventory.write',
      'orders.read',
      'orders.write',
      'customers.read',
      'customers.write',
      'promotions.read',
      'payments.read',
    ],
    viewer: [
      'settings.read',
      'staff.read',
      'catalog.read',
      'inventory.read',
      'orders.read',
      'promotions.read',
      'payments.read',
      'reports.read',
    ],
  };

  it.each(STORE_ROLES)('%s has exactly the reviewed permissions', (role) => {
    expect([...permissionsOf(role)].sort()).toEqual([...expected[role]].sort());
  });

  it('only uses known permissions, each named resource.action', () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
    for (const p of PERMISSIONS) expect(p).toMatch(/^[a-z]+\.[a-z_]+$/);
  });

  it('keeps every role inside the next one up', () => {
    expect(coversRole(permissionsOf('owner'), 'manager')).toBe(true);
    expect(coversRole(permissionsOf('manager'), 'staff')).toBe(true);
    expect(coversRole(permissionsOf('staff'), 'viewer')).toBe(false); // Viewer reads reports
  });
});

describe('canManageRole (no escalation)', () => {
  const cases: [StoreRole, StoreRole, boolean][] = [
    ['owner', 'owner', true],
    ['owner', 'manager', true],
    ['owner', 'staff', true],
    ['owner', 'viewer', true],
    ['manager', 'owner', false],
    ['manager', 'manager', false],
    ['manager', 'staff', true],
    ['manager', 'viewer', true],
    ['staff', 'staff', false],
    ['staff', 'viewer', false],
    ['viewer', 'viewer', false],
  ];
  it.each(cases)('%s managing %s: %s', (actor, target, allowed) => {
    expect(canManageRole(permissionsOf(actor), target)).toBe(allowed);
  });

  it('refuses a role with permissions the actor lacks', () => {
    const held = new Set<Permission>(['staff.write', 'catalog.read']);
    expect(canManageRole(held, 'viewer')).toBe(false);
  });
});

describe('role guards', () => {
  it('recognises store and platform roles', () => {
    expect(isStoreRole('manager')).toBe(true);
    expect(isStoreRole('super_admin')).toBe(false);
    expect(isPlatformRole('super_admin')).toBe(true);
    expect(isPlatformRole('owner')).toBe(false);
    expect(isPlatformRole(undefined)).toBe(false);
  });
});
