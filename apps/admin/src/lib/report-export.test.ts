import { describe, expect, it } from 'vitest';
import { allPages, reportCsv } from './report-export';

describe('report exports', () => {
  it('writes money as taka, keeps Bangla, and starts with a byte-order mark', () => {
    const csv = reportCsv(
      ['ক্যাটাগরি', 'Amount', 'Units'],
      [
        ['ভাড়া, দোকান', { money: 1_234_56 }, 3],
        ['Ads', { money: -5 }, null],
      ],
    );
    expect(csv).toBe('﻿ক্যাটাগরি,Amount,Units\r\n"ভাড়া, দোকান",1234.56,3\r\nAds,-0.05,\r\n');
  });

  it('reads every page of a list, and stops at the limit', async () => {
    const pages: Record<string, { items: number[]; nextCursor: string | null }> = {
      '': { items: [1, 2], nextCursor: 'b' },
      b: { items: [3], nextCursor: 'c' },
      c: { items: [4], nextCursor: null },
    };
    const page = async (cursor: string | undefined) =>
      pages[cursor ?? ''] as (typeof pages)[string];
    expect(await allPages(page)).toEqual([1, 2, 3, 4]);
    expect(await allPages(page, 2)).toEqual([1, 2, 3]);
  });
});
