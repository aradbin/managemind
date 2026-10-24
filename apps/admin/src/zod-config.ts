// Imported first by main.tsx, before any schema is built: zod's compiled
// parsers need eval, which the admin's Content Security Policy refuses
// (public/_headers). Without this, zod's probe for eval reports a violation.
import { config } from 'zod';

config({ jitless: true });
