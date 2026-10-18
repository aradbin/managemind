// AES-256-GCM for stored credentials (phase-5a-plan §3.1), through Web
// Crypto so it runs the same in Workers and in Node's tests. The additional
// data binds a ciphertext to its store and kind: a blob copied to another
// store's row, or to another kind, fails to decrypt.

/** The key from `CREDENTIALS_KEY`, and the version written with every blob. */
export interface Keyring {
  version: number;
  key: CryptoKey;
}

export interface Sealed {
  ciphertext: Uint8Array;
  iv: Uint8Array;
  keyVersion: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value.trim());
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Imports 32 random bytes in base64, as `pnpm credentials-key` prints them. */
export async function importKeyring(base64: string, version = 1): Promise<Keyring> {
  const raw = base64ToBytes(base64);
  if (raw.length !== 32) throw new Error('CREDENTIALS_KEY must be 32 bytes in base64');
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { version, key };
}

const additionalData = (tenantId: string, kind: string, version: number) =>
  encoder.encode(`${tenantId}:${kind}:${version}`);

export async function sealCredentials(
  keyring: Keyring,
  tenantId: string,
  kind: string,
  value: unknown,
): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: additionalData(tenantId, kind, keyring.version) },
    keyring.key,
    encoder.encode(JSON.stringify(value)),
  );
  return { ciphertext: new Uint8Array(ciphertext), iv, keyVersion: keyring.version };
}

/** Throws when the key, the store, the kind or the bytes don't match. */
export async function openCredentials(
  keyring: Keyring,
  tenantId: string,
  kind: string,
  sealed: Sealed,
): Promise<unknown> {
  if (sealed.keyVersion !== keyring.version) {
    throw new Error(`credentials were sealed with key version ${sealed.keyVersion}`);
  }
  const plain = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: sealed.iv,
      additionalData: additionalData(tenantId, kind, sealed.keyVersion),
    },
    keyring.key,
    sealed.ciphertext,
  );
  return JSON.parse(decoder.decode(plain));
}
