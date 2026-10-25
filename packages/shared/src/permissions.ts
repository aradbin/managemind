// Permissions and roles as data (after Vendure's permission list and Saleor's
// permission groups). Code checks permissions, never role names, so fixed
// roles can later become per-store custom roles without touching any check
// (phase-1-plan §5).

/** Every permission, grouped by resource. Later phases' entries are declared now so the role matrix is reviewed once. */
export const PERMISSIONS = [
  'settings.read',
  'settings.write',
  /** Payment gateway, SMS and email credentials (phase-5a-plan §3.1): Owner and Manager. */
  'settings.credentials',
  'staff.read',
  'staff.write',
  'staff.manage_owners',
  'catalog.read',
  'catalog.write',
  /** Cost prices, wherever they appear (phase-2-plan Q5): Owner and Manager. */
  'catalog.cost',
  'inventory.read',
  'inventory.write',
  'orders.read',
  'orders.write',
  'orders.export',
  'customers.read',
  'customers.write',
  'customers.export',
  /** Anonymizing a shopper on their request (phase-5b-plan §3.13): Owner and Manager. */
  'customers.delete',
  'promotions.read',
  'promotions.write',
  'payments.read',
  'payments.refund',
  /** Recording and importing couriers' COD payouts (phase-7-plan §3.7, Q13): Owner and Manager. */
  'payments.reconcile',
  'reports.read',
  /** Our plan, usage and invoices (phase-5b-plan §3.17): Owner and Manager. */
  'billing.read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const STORE_ROLES = ['owner', 'manager', 'staff', 'viewer'] as const;
export type StoreRole = (typeof STORE_ROLES)[number];

/** Platform roles are separate from store roles and grant no store data by themselves. */
export const PLATFORM_ROLES = ['support', 'super_admin'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

const all = (except: readonly Permission[] = []): Permission[] =>
  PERMISSIONS.filter((p) => !except.includes(p));

const ROLE_PERMISSIONS: Record<StoreRole, ReadonlySet<Permission>> = {
  owner: new Set(all()),
  manager: new Set(all(['staff.manage_owners'])),
  staff: new Set<Permission>([
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
    'settings.read',
  ]),
  // Shoppers' personal data and our invoices stay out of read-only access.
  viewer: new Set(
    PERMISSIONS.filter(
      (p) => p.endsWith('.read') && p !== 'customers.read' && p !== 'billing.read',
    ),
  ),
};

export const isStoreRole = (value: unknown): value is StoreRole =>
  typeof value === 'string' && (STORE_ROLES as readonly string[]).includes(value);

export const isPlatformRole = (value: unknown): value is PlatformRole =>
  typeof value === 'string' && (PLATFORM_ROLES as readonly string[]).includes(value);

/** The permissions a store role grants. */
export const permissionsOf = (role: StoreRole): ReadonlySet<Permission> => ROLE_PERMISSIONS[role];

/** True when every permission of `role` is in `held`. */
export function coversRole(held: ReadonlySet<Permission>, role: StoreRole): boolean {
  for (const p of ROLE_PERMISSIONS[role]) if (!held.has(p)) return false;
  return true;
}

/**
 * Whether someone holding `held` may give `role` to a member, or change or
 * remove a member who has `role`. No escalation (after Saleor): only a role
 * whose permissions you hold yourself. A role that can itself manage staff
 * (Owner, Manager) can be managed only with `staff.manage_owners`.
 */
export function canManageRole(held: ReadonlySet<Permission>, role: StoreRole): boolean {
  if (!held.has('staff.write')) return false;
  if (ROLE_PERMISSIONS[role].has('staff.write') && !held.has('staff.manage_owners')) return false;
  return coversRole(held, role);
}
