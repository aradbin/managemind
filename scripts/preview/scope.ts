// What a preview runs (ADR 0011, amended Oct 18, Oct 23 and Oct 25). Every
// environment shares the account's 100,000 Hyperdrive queries a day, so
// previews connect to their Neon branch directly and use none, except a full
// run, which the Free plan's CPU limit stops too often on that connection:
//
// - a PR that changes only docs gets no preview;
// - by default a preview deploys and runs the smoke tests;
// - the `full-preview` label adds the E2E flows, Lighthouse and the CPU step,
//   all on a Worker bound to Hyperdrive unless today's count (UTC days, as
//   the quota resets) is past FULL_RUN_CEILING or unknown. Then the E2E flows
//   and Lighthouse run on the direct connection, without the CPU step.

/** Above this many Hyperdrive queries today, a full run would put production at risk. */
export const FULL_RUN_CEILING = 50_000;
export const FULL_LABEL = 'full-preview';

/** Markdown anywhere, and everything under docs/. */
export function docsOnly(files: readonly string[]): boolean {
  return files.length > 0 && files.every((f) => f.startsWith('docs/') || f.endsWith('.md'));
}

export interface Scope {
  deploy: boolean;
  /** The E2E flows and Lighthouse. */
  full: boolean;
  /** The E2E flows, Lighthouse and the CPU step on Hyperdrive; the CPU step runs only then. */
  hyperdrive: boolean;
  /** One line for the preview comment. */
  describe: string;
}

export function previewScope(input: {
  files: readonly string[];
  fullLabel: boolean;
  /** Today's Hyperdrive queries, asked for only when the label is on; null if unknown. */
  queriesToday?: number | null;
}): Scope {
  if (docsOnly(input.files)) {
    return {
      deploy: false,
      full: false,
      hyperdrive: false,
      describe: 'No preview: the PR changes only docs.',
    };
  }
  if (!input.fullLabel) {
    return {
      deploy: true,
      full: false,
      hyperdrive: false,
      describe: `Smoke tests only. Add the \`${FULL_LABEL}\` label for the E2E flows, the CPU step and Lighthouse.`,
    };
  }
  const used = input.queriesToday;
  if (used == null) {
    // Unknown usage: this run could be the one that takes production down.
    return {
      deploy: true,
      full: true,
      hyperdrive: false,
      describe:
        "Full run on the direct connection, without the CPU step: smoke, E2E flows, Lighthouse. Today's Hyperdrive usage was unavailable.",
    };
  }
  if (used > FULL_RUN_CEILING) {
    return {
      deploy: true,
      full: true,
      hyperdrive: false,
      describe: `Full run on the direct connection, without the CPU step: smoke, E2E flows, Lighthouse. ${used.toLocaleString('en-US')} Hyperdrive queries used today, past the ${FULL_RUN_CEILING.toLocaleString('en-US')} a run on Hyperdrive may start at. Push again after 00:00 UTC for it.`,
    };
  }
  return {
    deploy: true,
    full: true,
    hyperdrive: true,
    describe: 'Full run through Hyperdrive: smoke, E2E flows, Lighthouse, CPU step.',
  };
}

/** The start of today in UTC, when the Hyperdrive quota resets. */
export function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
