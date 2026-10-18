// The geography file for the checkout's dropdowns (phase-4-plan §3.2),
// prerendered at build time into a static asset: Cloudflare serves it
// without running the Worker, and its name changes with its content.
import { GEO_VERSION, geoFile } from '@managemind/shared/geo';
import type { APIRoute } from 'astro';

export const prerender = true;

export const getStaticPaths = () => [{ params: { file: `bd-${GEO_VERSION}.json` } }];

export const GET: APIRoute = () =>
  new Response(JSON.stringify(geoFile()), { headers: { 'Content-Type': 'application/json' } });
