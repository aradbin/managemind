// Colour dots on product cards (design/storefront-redesign: ProductCard).
// Option values carry no colour of their own, so common colour names in
// English and Bangla map to a swatch; other names get no dot, and the card
// still shows "3 colours".
const SWATCHES: Record<string, string> = {
  black: '#23262d',
  white: '#ffffff',
  grey: '#8a8f98',
  gray: '#8a8f98',
  silver: '#c0c4cc',
  red: '#a3302a',
  maroon: '#6d1f2a',
  pink: '#e58fb0',
  orange: '#e07b2a',
  yellow: '#e8c21f',
  gold: '#c9a227',
  green: '#2f7d4a',
  olive: '#6b7a2e',
  blue: '#3a6bb0',
  navy: '#1f2f5c',
  sky: '#7ab8e6',
  purple: '#6f4a9e',
  brown: '#7a4e2d',
  beige: '#e3d3b4',
  cream: '#f3ead3',
  কালো: '#23262d',
  সাদা: '#ffffff',
  ধূসর: '#8a8f98',
  লাল: '#a3302a',
  মেরুন: '#6d1f2a',
  গোলাপি: '#e58fb0',
  কমলা: '#e07b2a',
  হলুদ: '#e8c21f',
  সোনালি: '#c9a227',
  সবুজ: '#2f7d4a',
  নীল: '#3a6bb0',
  বেগুনি: '#6f4a9e',
  বাদামি: '#7a4e2d',
};

/** A swatch for a normalized colour name ("navy blue" finds "navy"), or null. */
export function swatch(key: string): string | null {
  if (SWATCHES[key]) return SWATCHES[key];
  for (const word of key.split(/\s+/)) if (SWATCHES[word]) return SWATCHES[word];
  return null;
}
