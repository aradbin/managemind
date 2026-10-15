// Catalog limits (phase-2-plan §3, Q3). Shared by the API's validation, the
// admin's forms and the import's dry run, so all three refuse the same input.
export const CATALOG_LIMITS = {
  optionsPerProduct: 3,
  valuesPerOption: 100,
  variantsPerProduct: 100,
  imagesPerProduct: 10,
  categoryDepth: 3,
  rulesPerCollection: 5,
  attributesPerStore: 100,
  valuesPerAttribute: 500,
  tagsPerProduct: 30,
  tagLength: 50,
  metadataKeys: 50,
  slugLength: 120,
  titleLength: 200,
  nameLength: 100,
  skuLength: 64,
  barcodeLength: 64,
  seoTitleLength: 120,
  seoDescriptionLength: 320,
  /** Characters of text across a whole description. */
  descriptionText: 20_000,
  bulkVariantEdits: 200,
  /** 10 crore taka in poisha: far above any real price, far below unsafe integers. */
  maxPrice: 10_000_000_000,
  maxStock: 1_000_000_000,
} as const;
