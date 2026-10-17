import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast';
import { defaultTheme, presetTheme } from './presets';
import {
  contrastIssues,
  THEME_PRESETS,
  type Theme,
  themeLinkTargets,
  themeMediaIds,
  themeSchema,
} from './theme';

describe('contrast', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    // #767676 on white is the classic 4.54:1 grey.
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });

  it('names the pairs below 4.5:1', () => {
    const colors = { ...presetTheme('general').tokens.colors, primary: '#f0f0f0' };
    const issues = contrastIssues(colors);
    expect(issues.map((i) => i.use)).toEqual(['button labels', 'links']);
    expect(issues[0]?.ratio).toBeLessThan(4.5);
  });
});

describe.each(THEME_PRESETS)('preset %s', (preset) => {
  const theme = presetTheme(preset);

  it('parses as a theme, unchanged', () => {
    expect(themeSchema.parse(theme)).toEqual(theme);
  });

  it('passes the contrast check', () => {
    expect(contrastIssues(theme.tokens.colors)).toEqual([]);
  });

  it('gives a fresh copy each time', () => {
    const copy = presetTheme(preset);
    copy.sections.pop();
    expect(presetTheme(preset).sections).toHaveLength(theme.sections.length);
  });
});

describe('themeSchema', () => {
  const theme = defaultTheme();

  it('lowercases colours and refuses bad ones', () => {
    const parsed = themeSchema.parse({
      ...theme,
      tokens: { ...theme.tokens, colors: { ...theme.tokens.colors, primary: '#1F4E8C' } },
    });
    expect(parsed.tokens.colors.primary).toBe('#1f4e8c');
    const bad = {
      ...theme,
      tokens: { ...theme.tokens, colors: { ...theme.tokens.colors, text: 'red' } },
    };
    expect(themeSchema.safeParse(bad).success).toBe(false);
  });

  it('refuses repeated section IDs, more than 12 sections and unknown keys', () => {
    const [first] = theme.sections;
    expect(themeSchema.safeParse({ ...theme, sections: [first, first] }).success).toBe(false);
    const many = Array.from({ length: 13 }, (_, i) => ({ ...first, id: `sec${i}x` }));
    expect(themeSchema.safeParse({ ...theme, sections: many }).success).toBe(false);
    expect(themeSchema.safeParse({ ...theme, extra: 1 }).success).toBe(false);
  });

  it('drops empty translations and refuses non-https links', () => {
    const parsed = themeSchema.parse({
      ...theme,
      announcement: { text: { bn: '  ঈদ অফার  ', en: '' }, link: null },
    });
    expect(parsed.announcement?.text).toEqual({ bn: 'ঈদ অফার' });
    const http = {
      ...theme,
      announcement: { text: {}, link: { type: 'url', url: 'http://x.com' } },
    };
    expect(themeSchema.safeParse(http).success).toBe(false);
  });
});

describe('theme references', () => {
  const ids = {
    logo: '01900000-0000-7000-8000-000000000001',
    slide: '01900000-0000-7000-8000-000000000002',
    category: '01900000-0000-7000-8000-000000000003',
    page: '01900000-0000-7000-8000-000000000004',
    collection: '01900000-0000-7000-8000-000000000005',
  };
  const theme: Theme = {
    ...defaultTheme(),
    tokens: { ...defaultTheme().tokens, logoMediaId: ids.logo },
    announcement: { text: { en: 'Sale' }, link: { type: 'page', id: ids.page } },
    sections: [
      {
        type: 'hero',
        id: 'hero1',
        size: 'large',
        slides: [
          {
            mediaId: ids.slide,
            heading: {},
            subheading: {},
            button: { label: { en: 'Shop' }, link: { type: 'category', id: ids.category } },
          },
        ],
      },
      {
        type: 'product_grid',
        id: 'grid1',
        heading: {},
        collectionId: ids.collection,
        limit: 8,
        layout: 'grid',
      },
    ],
  };

  it('lists the media a theme uses', () => {
    expect(themeMediaIds(theme).sort()).toEqual([ids.logo, ids.slide].sort());
  });

  it('lists the records a theme links to', () => {
    expect(themeLinkTargets(theme)).toEqual({
      category: [ids.category],
      collection: [ids.collection],
      product: [],
      page: [ids.page],
    });
  });
});
