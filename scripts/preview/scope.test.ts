import { describe, expect, it } from 'vitest';
import { addedSpecs, docsOnly, FULL_RUN_CEILING, previewScope, utcDayStart } from './scope';

describe('what a preview runs', () => {
  it('skips a PR that changes only docs', () => {
    expect(docsOnly(['docs/PLAN.md', 'README.md', 'docs/adr/0011-previews.md'])).toBe(true);
    expect(docsOnly(['docs/PLAN.md', 'apps/api/src/db.ts'])).toBe(false);
    expect(docsOnly([])).toBe(false);
    expect(previewScope({ files: ['README.md'], fullLabel: true })).toMatchObject({
      deploy: false,
      full: false,
    });
  });

  it('runs the smoke tests only without the label', () => {
    expect(previewScope({ files: ['apps/api/src/db.ts'], fullLabel: false })).toMatchObject({
      deploy: true,
      full: false,
      hyperdrive: false,
    });
  });

  it('runs everything with the label while today leaves room', () => {
    const code = ['apps/api/src/db.ts'];
    expect(
      previewScope({ files: code, fullLabel: true, queriesToday: FULL_RUN_CEILING }),
    ).toMatchObject({ deploy: true, full: true, hyperdrive: true });
  });

  it('runs the E2E flows on the direct connection, without the CPU step, when Hyperdrive has no room', () => {
    // Only a full run uses Hyperdrive queries (ADR 0011, amended Oct 25).
    const code = ['apps/api/src/db.ts'];
    const over = previewScope({ files: code, fullLabel: true, queriesToday: FULL_RUN_CEILING + 1 });
    expect(over).toMatchObject({ deploy: true, full: true, hyperdrive: false });
    expect(over.describe).toContain('50,001');
    expect(previewScope({ files: code, fullLabel: true, queriesToday: null })).toMatchObject({
      deploy: true,
      full: true,
      hyperdrive: false,
    });
  });

  it('narrows a full run to the smoke tests and the specs the PR adds', () => {
    const narrow = previewScope({
      files: ['apps/api/src/db.ts', 'e2e/tests/couriers.spec.ts'],
      fullLabel: true,
      queriesToday: 0,
      narrowLabel: true,
      added: ['e2e/tests/couriers.spec.ts', 'e2e/tests/helpers/x.ts', 'apps/api/src/new.ts'],
    });
    expect(narrow).toMatchObject({
      full: true,
      hyperdrive: true,
      specs: ['tests/smoke.spec.ts', 'tests/couriers.spec.ts'],
    });
    expect(narrow.describe).toContain('`couriers.spec.ts`');
    expect(addedSpecs(['e2e/tests/a.spec.ts', 'e2e/tests/sub/b.spec.ts', 'e2e/a.spec.ts'])).toEqual(
      ['tests/a.spec.ts'],
    );
  });

  it('runs the whole suite when nothing is narrowed or no spec is new', () => {
    const code = ['apps/api/src/db.ts'];
    const added = ['e2e/tests/couriers.spec.ts'];
    expect(previewScope({ files: code, fullLabel: true, queriesToday: 0, added }).specs).toEqual(
      [],
    );
    expect(
      previewScope({ files: code, fullLabel: true, queriesToday: 0, narrowLabel: true, added: [] })
        .specs,
    ).toEqual([]);
    // Without full-preview the run is smoke only anyway.
    expect(previewScope({ files: code, fullLabel: false, narrowLabel: true, added }).specs).toEqual(
      [],
    );
  });

  it('counts the day from 00:00 UTC', () => {
    expect(utcDayStart(new Date('2026-10-18T23:30:00+06:00')).toISOString()).toBe(
      '2026-10-18T00:00:00.000Z',
    );
  });
});
