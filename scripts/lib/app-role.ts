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

/** Creates mm_app in app_rw, or sets its password if it exists. Run as the owner role. */
export async function setAppRole(owner: pg.Client, password: string): Promise<void> {
  const literal = owner.escapeLiteral(password);
  await owner.query(`
    do $$ begin
      if exists (select from pg_roles where rolname = '${APP_ROLE}') then
        alter role ${APP_ROLE} login password ${literal};
      else
        create role ${APP_ROLE} login password ${literal};
      end if;
    end $$`);
  await owner.query(`grant app_rw to ${APP_ROLE}`);
}
