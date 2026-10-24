// The backup's round trip in CI (phase-5b-plan §3.14, §10): the test
// database is dumped, encrypted to an age key, decrypted and restored into
// another database, and the restore checks pass.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect, testUrls } from '@managemind/db/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { checkRestore } from './checks';
import { decrypt, dump, encrypt, restore } from './tools';

const { ownerUrl } = testUrls('managemind_test_scripts');
const dir = mkdtempSync(join(tmpdir(), 'backup-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('a nightly backup', () => {
  it('restores from the encrypted dump and passes the checks', async () => {
    // A key pair, as the owner makes one with age-keygen.
    const keyFile = join(dir, 'key.txt');
    execFileSync(process.env.AGE_KEYGEN || 'age-keygen', ['-o', keyFile], { stdio: 'ignore' });
    const recipient = readFileSync(keyFile, 'utf8').match(/public key: (age1\w+)/)?.[1] ?? '';
    expect(recipient).toMatch(/^age1/);

    const [plain, sealed, opened] = ['db.dump', 'db.dump.age', 'restored.dump'].map((f) =>
      join(dir, f),
    ) as [string, string, string];
    await dump(ownerUrl, plain);
    await encrypt(recipient, plain, sealed);
    expect(statSync(sealed).size).toBeGreaterThan(1000);
    // What leaves the runner is not readable without the key.
    expect(readFileSync(sealed).subarray(0, 21).toString()).toBe('age-encryption.org/v1');
    await decrypt(keyFile, sealed, opened);

    const target = new URL(ownerUrl);
    const name = `restore_check_${Date.now().toString(36)}`;
    const admin = await connect(ownerUrl);
    await admin.query(
      `create database ${name} template template0 encoding 'UTF8' locale 'C.UTF-8'`,
    );
    target.pathname = `/${name}`;
    try {
      await restore(target.toString(), opened);
      const restored = await connect(target.toString());
      try {
        const report = await checkRestore(admin, restored);
        expect(report.problems).toEqual([]);
        expect(report.tables).toBeGreaterThan(50);
        expect(report.rows.restored).toBe(report.rows.source);
      } finally {
        await restored.end();
      }
    } finally {
      await admin.query(`drop database if exists ${name} with (force)`);
      await admin.end();
    }
  }, 120_000);
});
