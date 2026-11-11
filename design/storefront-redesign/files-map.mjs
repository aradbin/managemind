// Prints the `files` map for publishing the canvas with Claude's Artifact
// tool: every file under canvas/project/, keyed by its served path. With
// --except=<name,...> it leaves those out (for example the file passed as
// `file_path`). Run from anywhere: `node design/storefront-redesign/files-map.mjs`.
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const project = join(here, 'canvas', 'project');
const exceptArg = process.argv.find((a) => a.startsWith('--except='));
const except = new Set(exceptArg ? exceptArg.slice('--except='.length).split(',') : []);

const map = {};
for (const name of readdirSync(project).sort()) {
  if (except.has(name)) continue;
  map[`project/${name}`] = `project/${name}`;
}
console.log(JSON.stringify(map, null, 2));
