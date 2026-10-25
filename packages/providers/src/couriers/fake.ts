// The test courier (phase-7-plan §3.2): previews, local development and
// tests book with it, and a dev route moves its parcels (§6.3), as the dev
// mailbox stands in for email. It is never offered in production. Its
// statuses are our own words. What it "knows" about a parcel comes from
// `lookup`, which the API reads from the shipment the dev route wrote.
import type { CourierUpdateKind } from '@managemind/shared/orders';
import {
  type Booked,
  CourierError,
  type CourierProvider,
  type CourierStatus,
  sameSecret,
} from './types';

export interface FakeParcelState {
  status: CourierUpdateKind;
  codCollected?: number | null;
  fee?: number | null;
  at?: string;
}

export interface FakeCourierOptions {
  apiKey: string;
  lookup?: (consignmentId: string) => Promise<FakeParcelState | null>;
  /** For tests: the consignment IDs it hands out. */
  nextId?: () => string;
}

/** A note containing this makes the booking refused; this one, unanswered. For the E2E and tests. */
export const FAKE_REFUSE = '[refuse]';
export const FAKE_NO_ANSWER = '[no-answer]';

const randomId = () =>
  `FK${Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => (b % 10).toString()).join('')}`;

export function fakeCourier(o: FakeCourierOptions): CourierProvider {
  const nextId = o.nextId ?? randomId;
  const status = async (consignmentId: string): Promise<CourierStatus> => {
    const state = (await o.lookup?.(consignmentId)) ?? null;
    if (!state) {
      throw new CourierError('not_found', { refused: true, message: 'Test courier: no parcel' });
    }
    return {
      status: state.status,
      update: state.status,
      at: state.at ? new Date(state.at) : new Date(),
      message: { en: `Test courier: ${state.status.replace(/_/g, ' ')}` },
      codCollected: state.codCollected ?? null,
      fee: state.fee ?? null,
    };
  };
  return {
    name: 'fake',
    async check() {
      if (o.apiKey === 'wrong') {
        throw new CourierError('unauthorized', {
          refused: true,
          message: 'Test courier: wrong key',
        });
      }
      return {};
    },
    async book(parcel): Promise<Booked> {
      if (parcel.note.includes(FAKE_REFUSE)) {
        throw new CourierError('refused', {
          refused: true,
          message: 'Test courier: the phone number is not valid',
        });
      }
      if (parcel.note.includes(FAKE_NO_ANSWER)) {
        throw new CourierError('no_answer', {
          refused: false,
          message: 'Test courier did not answer',
        });
      }
      const id = nextId();
      return {
        consignmentId: id,
        trackingCode: id,
        status: 'booked',
        update: 'booked',
        at: new Date(),
        message: { en: 'Test courier: booked' },
        fee: 6000,
      };
    },
    status: (ref) => {
      if (!ref.consignmentId) {
        throw new CourierError('not_found', { refused: true, message: 'Test courier: no parcel' });
      }
      return status(ref.consignmentId);
    },
    async cancel() {},
    parseWebhook(req, secret) {
      const auth = req.headers.get('authorization') ?? '';
      if (!sameSecret(auth, `Bearer ${secret}`)) return 'refused';
      const body = (req.body ?? {}) as Record<string, unknown>;
      return typeof body.consignment_id === 'string' ? { consignmentId: body.consignment_id } : {};
    },
    trackingUrl: (code) => `https://courier.invalid/track/${encodeURIComponent(code)}`,
  };
}
