import { describe, expect, it } from 'vitest';
import { docsOnly, FULL_RUN_CEILING, previewScope, utcDayStart } from './scope';

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
    });
  });

  it('runs everything with the label while today leaves room', () => {
    const code = ['apps/api/src/db.ts'];
    expect(
      previewScope({ files: code, fullLabel: true, queriesToday: FULL_RUN_CEILING }),
    ).toMatchObject({ deploy: true, full: true });
    const over = previewScope({ files: code, fullLabel: true, queriesToday: FULL_RUN_CEILING + 1 });
    expect(over).toMatchObject({ deploy: true, full: false });
    expect(over.describe).toContain('50,001');
    expect(previewScope({ files: code, fullLabel: true, queriesToday: null })).toMatchObject({
      deploy: true,
      full: false,
    });
  });

  it('counts the day from 00:00 UTC', () => {
    expect(utcDayStart(new Date('2026-10-18T23:30:00+06:00')).toISOString()).toBe(
      '2026-10-18T00:00:00.000Z',
    );
  });
});
