// Couriers (phase-7-plan §3.2): the interface, the adapters, and the one
// place that builds a store's adapter from its saved credentials.
import type { Courier } from '@managemind/shared/orders';
import { type FakeParcelState, fakeCourier } from './fake';
import { steadfastCourier } from './steadfast';
import type { CourierProvider, Fetch } from './types';

export * from './fake';
export * from './steadfast';
export * from './types';

/** A store's saved credentials for one courier, opened. */
export interface CourierConnection {
  courier: Courier;
  mode: 'sandbox' | 'live' | null;
  secrets: Record<string, unknown>;
  config: Record<string, unknown>;
}

export interface CourierDeps {
  fetch?: Fetch;
  /** The test courier's parcels (§6.3). */
  fakeLookup?: (consignmentId: string) => Promise<FakeParcelState | null>;
  /** Seals renewed tokens back with the store's credentials (Pathao). */
  saveSecrets?: (patch: Record<string, unknown>) => Promise<void>;
}

const text = (v: unknown) => (typeof v === 'string' ? v : '');

/** The store's adapter for one courier. */
export function courierProvider(c: CourierConnection, deps: CourierDeps = {}): CourierProvider {
  switch (c.courier) {
    case 'steadfast':
      return steadfastCourier({
        apiKey: text(c.secrets.apiKey),
        secretKey: text(c.secrets.secretKey),
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
      });
    case 'fake':
      return fakeCourier({
        apiKey: text(c.secrets.apiKey),
        ...(deps.fakeLookup ? { lookup: deps.fakeLookup } : {}),
      });
    default:
      throw new Error(`${c.courier}: no adapter yet`);
  }
}

export type { CourierProvider };
