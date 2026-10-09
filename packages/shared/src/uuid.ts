// UUIDv7 (RFC 9562): 48-bit Unix time in ms, version 7, 74 random bits.
// Monotonic within one isolate: IDs generated in the same millisecond use
// rand_a as a 12-bit counter (RFC 9562 §6.2, method 1), so they sort in order.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let lastMs = 0;
let counter = 0;

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export function uuidv7(now: number = Date.now()): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let ms = Math.max(now, lastMs);
  if (ms === lastMs) {
    counter += 1;
    if (counter > 0xfff) {
      // Counter exhausted within one millisecond: borrow the next millisecond.
      ms += 1;
      counter = (bytes[6] ?? 0) & 0x7f;
    }
  } else {
    // Start each millisecond low in the range so it can count up.
    counter = (((bytes[6] ?? 0) & 0x07) << 8) | (bytes[7] ?? 0);
  }
  lastMs = ms;

  for (let i = 5; i >= 0; i -= 1) {
    bytes[i] = ms % 256;
    ms = Math.floor(ms / 256);
  }
  bytes[6] = 0x70 | (counter >> 8);
  bytes[7] = counter & 0xff;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const h = hex(bytes);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** True for any RFC 9562 UUID in lowercase canonical form. */
export const isUuid = (value: string): boolean => UUID_PATTERN.test(value);

/** The Unix time in ms encoded in a UUIDv7. */
export function uuidv7Time(id: string): number {
  if (!isUuid(id) || id[14] !== '7') throw new TypeError(`Not a UUIDv7: ${id}`);
  return Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
}
