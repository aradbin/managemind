// A phone code before cash on delivery (phase-5a-plan §3.14): one object per
// store and phone holds the code's hash, its expiry and the tries left, and
// after a right answer the hash of a token that checkout shows.
// Codes never reach the database. Plain TypeScript, so tests run it in
// Node; the Durable Object only wraps it.

export const CODE_TTL_MS = 10 * 60_000;
export const TOKEN_TTL_MS = 15 * 60_000;
export const MAX_TRIES = 5;

interface Stored {
  codeHash: string | null;
  codeExpires: number;
  tries: number;
  tokenHash: string | null;
  tokenExpires: number;
}

export interface OtpStore {
  get(): Promise<Stored | undefined>;
  put(value: Stored): Promise<void>;
}

const EMPTY: Stored = {
  codeHash: null,
  codeExpires: 0,
  tries: 0,
  tokenHash: null,
  tokenExpires: 0,
};

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A 6-digit code, uniform over 000000–999999. */
export function newCode(): string {
  const limit = 4_294_000_000; // a multiple of 10^6 under 2^32, so no digit is favoured
  for (;;) {
    const [n] = crypto.getRandomValues(new Uint32Array(1));
    if ((n as number) < limit) return String((n as number) % 1_000_000).padStart(6, '0');
  }
}

export type VerifyResult =
  | { ok: true; token: string }
  | { ok: false; reason: 'wrong' | 'expired' | 'locked' };

export class OtpState {
  constructor(private readonly store: OtpStore) {}

  private async load(): Promise<Stored> {
    return (await this.store.get()) ?? { ...EMPTY };
  }

  /** A new code replaces the last one and its tries; returns the code to send. */
  async issue(now = Date.now()): Promise<string> {
    const s = await this.load();
    const code = newCode();
    await this.store.put({
      ...s,
      codeHash: await sha256(code),
      codeExpires: now + CODE_TTL_MS,
      tries: 0,
    });
    return code;
  }

  /** The right code once gives a token; five wrong ones spend the code. */
  async verify(code: string, now = Date.now()): Promise<VerifyResult> {
    const s = await this.load();
    if (!s.codeHash || s.codeExpires <= now) return { ok: false, reason: 'expired' };
    if (s.tries >= MAX_TRIES) return { ok: false, reason: 'locked' };
    if ((await sha256(code)) !== s.codeHash) {
      await this.store.put({ ...s, tries: s.tries + 1 });
      return { ok: false, reason: s.tries + 1 >= MAX_TRIES ? 'locked' : 'wrong' };
    }
    const token = [...crypto.getRandomValues(new Uint8Array(24))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    await this.store.put({
      codeHash: null,
      codeExpires: 0,
      tries: 0,
      tokenHash: await sha256(token),
      tokenExpires: now + TOKEN_TTL_MS,
    });
    return { ok: true, token };
  }

  /**
   * Whether a verified token is good for this phone. It stays good until it
   * expires, so an order that fails for another reason (a price changed) can
   * be placed again without a new code.
   */
  async check(token: string, now = Date.now()): Promise<boolean> {
    const s = await this.load();
    if (!s.tokenHash || s.tokenExpires <= now) return false;
    return (await sha256(token)) === s.tokenHash;
  }
}
