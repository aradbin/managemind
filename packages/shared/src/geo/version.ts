// The geography file's version and path, apart from the data itself, so a
// page can link the file without bundling it (phase-4-plan §3.2).

/**
 * The hash of the data (`geoHash(JSON.stringify(GEOGRAPHY))`), which names
 * the browser file (`/geo/bd-<version>.json`) so it can be cached for a year.
 * A test recomputes it: change both together.
 */
export const GEO_VERSION = 'e133ce81';

export const geoFilePath = (version: string = GEO_VERSION) => `/geo/bd-${version}.json`;
