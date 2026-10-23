// The stores and people the preview's E2E seed made for this run
// (scripts/preview/e2e-seed.ts names them the same way).
export const RUN = process.env.E2E_RUN ?? '';
export const DEV_TOKEN = process.env.DEV_TOKEN ?? '';

export function people(project: string) {
  const base = `e2e-${RUN}-${project}`;
  return {
    slug: base,
    storeName: `E2E ${project} ${RUN}`,
    owner: `${base}-owner@example.test`,
    admin: `${base}-admin@example.test`,
    platform: `${base}-platform@example.test`,
    staff: `${base}-staff@example.test`,
    /** The store the launch flows onboard, close and purge. */
    launchSlug: `${base}-new`,
    launchName: `E2E ${project} ${RUN} new`,
    launchOwner: `${base}-new-owner@example.test`,
    secondSlug: `${base}-2`,
    secondName: `E2E ${project} ${RUN} two`,
  };
}
