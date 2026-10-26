import { describe, expect, it } from 'vitest';
import { isStaleBuild } from './app-error';

describe('isStaleBuild', () => {
  it('knows each browser’s message for a chunk a deploy removed', () => {
    for (const message of [
      'Failed to fetch dynamically imported module: https://admin.managemind.site/assets/_shell-Dn0oQ3Mh.js',
      'error loading dynamically imported module: https://admin.managemind.site/assets/x.js',
      'Importing a module script failed.',
      'Unable to preload CSS for /assets/index-abc.css',
    ]) {
      expect(isStaleBuild(new TypeError(message))).toBe(true);
    }
  });

  it('leaves other errors alone', () => {
    expect(isStaleBuild(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isStaleBuild('Failed to fetch dynamically imported module')).toBe(false);
  });
});
