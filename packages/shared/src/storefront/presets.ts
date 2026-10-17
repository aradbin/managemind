// Theme presets (phase-3-plan §3.4, Q6): starting section lists and tokens of
// the one `classic` theme. Choosing a preset replaces the draft; staff can
// then change anything. The owner's reference stores will refine these.
import type { Theme, ThemePreset, ThemeSection } from './theme';

const trustBadges = (id: string): ThemeSection => ({
  type: 'trust_badges',
  id,
  items: [
    {
      icon: 'cod',
      title: { bn: 'ক্যাশ অন ডেলিভারি', en: 'Cash on delivery' },
      text: { bn: 'পণ্য হাতে পেয়ে টাকা দিন', en: 'Pay when your order arrives' },
    },
    {
      icon: 'delivery',
      title: { bn: 'সারা দেশে ডেলিভারি', en: 'Delivery across Bangladesh' },
      text: { bn: 'ঢাকায় ১–২ দিন, ঢাকার বাইরে ৩–৫ দিন', en: '1–2 days in Dhaka, 3–5 days elsewhere' },
    },
    {
      icon: 'returns',
      title: { bn: 'সহজ রিটার্ন', en: 'Easy returns' },
      text: { bn: '৭ দিনের মধ্যে ফেরত দিন', en: 'Return within 7 days' },
    },
  ],
});

const base = (preset: ThemePreset): Omit<Theme, 'tokens' | 'sections'> => ({
  version: 1,
  name: 'classic',
  preset,
  announcement: null,
  pages: { product: { showRelated: true, specifications: 'table' } },
});

const PRESETS: Record<ThemePreset, () => Theme> = {
  /** A large hero and collections first. */
  fashion: () => ({
    ...base('fashion'),
    tokens: {
      colors: {
        primary: '#8b1e3f',
        onPrimary: '#ffffff',
        background: '#ffffff',
        surface: '#faf6f4',
        text: '#1f1a17',
        accent: '#d4a373',
        sale: '#b00020',
      },
      font: 'system',
      radius: 'none',
      logoMediaId: null,
      faviconMediaId: null,
      card: { imageRatio: '3:4', showCompareAt: true, showBrand: false },
    },
    sections: [
      {
        type: 'hero',
        id: 'hero1',
        size: 'large',
        slides: [
          {
            mediaId: null,
            heading: { bn: 'নতুন কালেকশন', en: 'The new collection' },
            subheading: { bn: 'এই মৌসুমের পছন্দের পোশাক', en: 'This season’s favourites' },
            button: null,
          },
        ],
      },
      {
        type: 'collection_carousel',
        id: 'collections1',
        heading: { bn: 'কালেকশন', en: 'Collections' },
        collectionIds: [],
      },
      {
        type: 'product_grid',
        id: 'newest1',
        heading: { bn: 'নতুন এসেছে', en: 'New arrivals' },
        collectionId: null,
        limit: 8,
        layout: 'grid',
      },
      trustBadges('trust1'),
    ],
  }),
  /** Categories first, a deals row and compact cards. */
  grocery: () => ({
    ...base('grocery'),
    tokens: {
      colors: {
        primary: '#1b6e3a',
        onPrimary: '#ffffff',
        background: '#ffffff',
        surface: '#f3f7f1',
        text: '#1a2419',
        accent: '#f2a900',
        sale: '#c62828',
      },
      font: 'system',
      radius: 'small',
      logoMediaId: null,
      faviconMediaId: null,
      card: { imageRatio: '1:1', showCompareAt: true, showBrand: true },
    },
    sections: [
      {
        type: 'category_grid',
        id: 'categories1',
        heading: { bn: 'ক্যাটাগরি', en: 'Shop by category' },
        categoryIds: [],
      },
      {
        type: 'hero',
        id: 'hero1',
        size: 'compact',
        slides: [
          {
            mediaId: null,
            heading: { bn: 'প্রতিদিনের বাজার, ঘরে বসে', en: 'Your daily groceries, delivered' },
            subheading: {},
            button: null,
          },
        ],
      },
      {
        type: 'product_grid',
        id: 'deals1',
        heading: { bn: 'আজকের অফার', en: 'Today’s deals' },
        collectionId: null,
        limit: 12,
        layout: 'carousel',
      },
      {
        type: 'product_grid',
        id: 'newest1',
        heading: { bn: 'সব পণ্য', en: 'All products' },
        collectionId: null,
        limit: 12,
        layout: 'grid',
      },
      trustBadges('trust1'),
    ],
  }),
  /** A balanced layout for any shop. */
  general: () => ({
    ...base('general'),
    tokens: {
      colors: {
        primary: '#1f4e8c',
        onPrimary: '#ffffff',
        background: '#ffffff',
        surface: '#f4f6f9',
        text: '#1a1f29',
        accent: '#f59e0b',
        sale: '#b42318',
      },
      font: 'system',
      radius: 'small',
      logoMediaId: null,
      faviconMediaId: null,
      card: { imageRatio: '1:1', showCompareAt: true, showBrand: false },
    },
    sections: [
      {
        type: 'hero',
        id: 'hero1',
        size: 'large',
        slides: [
          {
            mediaId: null,
            heading: { bn: 'আমাদের দোকানে স্বাগতম', en: 'Welcome to our shop' },
            subheading: {},
            button: null,
          },
        ],
      },
      {
        type: 'category_grid',
        id: 'categories1',
        heading: { bn: 'ক্যাটাগরি', en: 'Categories' },
        categoryIds: [],
      },
      {
        type: 'product_grid',
        id: 'newest1',
        heading: { bn: 'নতুন পণ্য', en: 'New products' },
        collectionId: null,
        limit: 8,
        layout: 'grid',
      },
      trustBadges('trust1'),
    ],
  }),
};

/** A fresh copy of a preset's theme. */
export const presetTheme = (preset: ThemePreset): Theme => PRESETS[preset]();

/** What a store without a saved theme shows. */
export const defaultTheme = (): Theme => presetTheme('general');
