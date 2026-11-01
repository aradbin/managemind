import { describe, expect, it } from 'vitest';
import { pageList } from './paged';

describe('pageList', () => {
  it('lists every page when there are few', () => {
    expect(pageList(1, 1)).toEqual([1]);
    expect(pageList(2, 5)).toEqual([1, 2, 3, 4, 5]);
  });
  it('keeps five numbers near either end', () => {
    expect(pageList(1, 20)).toEqual([1, 2, 3, 4, 'gap', 20]);
    expect(pageList(20, 20)).toEqual([1, 'gap', 17, 18, 19, 20]);
  });
  it('shows the pages beside this one in the middle', () => {
    expect(pageList(10, 20)).toEqual([1, 'gap', 9, 10, 11, 'gap', 20]);
  });
  it('fills a gap of one page with its number', () => {
    expect(pageList(4, 20)).toEqual([1, 2, 3, 4, 5, 'gap', 20]);
  });
});
