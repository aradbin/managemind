// GitHub Actions helpers. Outside Actions they fall back to the console, so
// the scripts also run locally.
import { appendFileSync } from 'node:fs';

/** Hides a value in every later log line of the job. */
export function mask(value: string): void {
  if (process.env.GITHUB_ACTIONS) console.log(`::add-mask::${value}`);
}

export function setOutput(name: string, value: string): void {
  const file = process.env.GITHUB_OUTPUT;
  if (file) appendFileSync(file, `${name}=${value}\n`);
  else console.log(`${name}=${value}`);
}

export function notice(message: string): void {
  console.log(process.env.GITHUB_ACTIONS ? `::notice::${message}` : message);
}

export function warning(message: string): void {
  console.log(process.env.GITHUB_ACTIONS ? `::warning::${message}` : `warning: ${message}`);
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** Parses `--key value` and `--flag` arguments. */
export function parseArgs(argv: readonly string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (!arg.startsWith('--')) throw new Error(`unexpected argument: ${arg}`);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args.set(arg.slice(2), 'true');
    else {
      args.set(arg.slice(2), next);
      i++;
    }
  }
  return args;
}

/** The PR number from --pr, as a positive integer. */
export function prNumber(args: Map<string, string>): number {
  const pr = Number(args.get('pr'));
  if (!Number.isInteger(pr) || pr <= 0) throw new Error('--pr <number> is required');
  return pr;
}

/** Appends Markdown to the run's summary page (the console outside Actions). */
export function summary(markdown: string): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) appendFileSync(file, `${markdown}\n`);
  else console.log(markdown);
}
