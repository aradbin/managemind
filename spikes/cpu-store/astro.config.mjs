// Spike storefront for ADRs 0003 and 0004.
import cloudflare from '@astrojs/cloudflare';
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'server',
  // No KV sessions and no Cloudflare Images (phase-0-plan §3.5).
  session: false,
  adapter: cloudflare({ imageService: 'passthrough' }),
});
