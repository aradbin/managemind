// The mm_app login role behind Hyperdrive (ADR 0009): created with SQL, never
// through the Neon console or API, so it is not a member of neon_superuser.
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { mask } from './actions';

export const APP_ROLE = 'mm_app';

/** A new random password for mm_app, masked in the job log. */
export function newPassword(): string {
  const password = randomBytes(24).toString('base64url');
  mask(password);
  return password;
}

/**
 * Creates a login role in app_rw (mm_app by default), or sets its password if
 * it exists. Run as the owner role.
 */
export async function setAppRole(
  owner: pg.Client,
  password: string,
  role: string = APP_ROLE,
): Promise<void> {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(role)) throw new Error(`bad role name ${role}`);
  const literal = owner.escapeLiteral(password);
  await owner.query(`
    do $$ begin
      if exists (select from pg_roles where rolname = '${role}') then
        alter role ${role} login password ${literal};
      else
        create role ${role} login password ${literal};
      end if;
    end $$`);
  await owner.query(`grant app_rw to ${role}`);
}
