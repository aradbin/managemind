// pg_dump, pg_restore and age, run with their input and output as files.
// Each can be replaced by a command line in the environment (PG_DUMP,
// PG_RESTORE, AGE): CI runs Postgres 18's own tools from its service image,
// as the runner's client is older than the server.
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';

const command = (name: 'PG_DUMP' | 'PG_RESTORE' | 'AGE', fallback: string): string[] =>
  (process.env[name] || fallback).split(' ').filter(Boolean);

/** Runs a command, stdin from `input` and stdout to `output` when given; fails on a non-zero exit. */
export function run(
  argv: readonly string[],
  files: { input?: string; output?: string } = {},
): Promise<void> {
  const [cmd = '', ...args] = argv;
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: [files.input ? 'pipe' : 'ignore', files.output ? 'pipe' : 'inherit', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (d) => {
      stderr += String(d);
    });
    if (files.input && child.stdin) createReadStream(files.input).pipe(child.stdin);
    if (files.output && child.stdout) child.stdout.pipe(createWriteStream(files.output));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${stderr.slice(0, 500)}`)),
    );
  });
}

/** A custom-format dump of one database. */
export const dump = (url: string, output: string) =>
  run([...command('PG_DUMP', 'pg_dump'), '--format=custom', '--no-password', `--dbname=${url}`], {
    output,
  });

/** Restores a custom-format dump into an empty database, owned by whoever restores it. */
export const restore = (url: string, input: string) =>
  run(
    [...command('PG_RESTORE', 'pg_restore'), '--no-owner', '--exit-on-error', `--dbname=${url}`],
    {
      input,
    },
  );

export const encrypt = (recipient: string, input: string, output: string) =>
  run([...command('AGE', 'age'), '--encrypt', '--recipient', recipient], { input, output });

export const decrypt = (identityFile: string, input: string, output: string) =>
  run([...command('AGE', 'age'), '--decrypt', '--identity', identityFile], { input, output });
