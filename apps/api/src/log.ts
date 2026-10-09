// One JSON object per line, picked up by Workers Logs. Never log secrets or
// personal data: no request bodies, headers, cookies or query strings.
export type Level = 'debug' | 'info' | 'warn' | 'error';

export function log(level: Level, message: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, message, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
