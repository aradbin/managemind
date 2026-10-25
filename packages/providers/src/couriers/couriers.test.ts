import { describe, expect, it } from 'vitest';
import { FAKE_NO_ANSWER, FAKE_REFUSE, fakeCourier } from './fake';
import { steadfastCourier, steadfastUpdate } from './steadfast';
import { CourierError, courierTime, type Parcel, sameSecret, takaToPoisha } from './types';

const parcel: Parcel = {
  invoice: '1001-1',
  name: 'Rahim',
  phone: '01712345678',
  address: 'House 1, Road 2, Dhanmondi, Dhaka',
  areaName: 'Dhanmondi',
  districtName: 'Dhaka',
  codTaka: 1250,
  valueTaka: 1250,
  weightGrams: 500,
  items: 'Shirt x1',
  itemCount: 1,
  note: '',
};

/** A fetch that answers from a list and remembers what it was asked. */
function fakeFetch(answers: Array<{ status?: number; body: unknown } | 'throw'>) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = answers.shift();
    if (!next || next === 'throw') throw new TypeError('network');
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const headers = (h: Record<string, string>) => new Headers(h);

describe('helpers', () => {
  it('reads taka as poisha, and nothing as null', () => {
    expect(takaToPoisha(1250)).toBe(125000);
    expect(takaToPoisha('1,250.50')).toBe(125050);
    expect(takaToPoisha('')).toBeNull();
    expect(takaToPoisha('x')).toBeNull();
    expect(takaToPoisha(-1)).toBeNull();
  });

  it('reads a courier time, or uses now', () => {
    const now = new Date('2026-10-25T00:00:00Z');
    expect(courierTime('2026-10-24T10:00:00Z', now).toISOString()).toBe('2026-10-24T10:00:00.000Z');
    expect(courierTime('not a date', now)).toBe(now);
    expect(courierTime(undefined, now)).toBe(now);
  });

  it('compares secrets', () => {
    expect(sameSecret('Bearer abc', 'Bearer abc')).toBe(true);
    expect(sameSecret('Bearer abd', 'Bearer abc')).toBe(false);
    expect(sameSecret('Bearer ab', 'Bearer abc')).toBe(false);
  });
});

describe('Steadfast', () => {
  it('maps its statuses, acting on final ones only', () => {
    expect(steadfastUpdate('in_review')).toBe('booked');
    expect(steadfastUpdate('pending')).toBe('in_transit');
    expect(steadfastUpdate('delivered_approval_pending')).toBe('on_hold');
    expect(steadfastUpdate('delivered')).toBe('delivered');
    expect(steadfastUpdate('partial_delivered')).toBe('partial_delivered');
    expect(steadfastUpdate('cancelled')).toBe('returning');
    expect(steadfastUpdate('something new')).toBe('unknown');
  });

  it('books with its headers and a free-text address', async () => {
    const { f, calls } = fakeFetch([
      {
        body: {
          status: 200,
          message: 'Consignment has been created successfully.',
          consignment: {
            consignment_id: 1424107,
            invoice: '1001-1',
            tracking_code: '15BAEB8A',
            status: 'in_review',
            created_at: '2026-10-25T08:00:00.000000Z',
          },
        },
      },
    ]);
    const booked = await steadfastCourier({ apiKey: 'k', secretKey: 's', fetch: f }).book(parcel);
    expect(booked).toMatchObject({
      consignmentId: '1424107',
      trackingCode: '15BAEB8A',
      update: 'booked',
    });
    expect(calls[0]?.url).toBe('https://portal.packzy.com/api/v1/create_order');
    const sent = JSON.parse(String(calls[0]?.init?.body));
    expect(sent).toMatchObject({
      invoice: '1001-1',
      recipient_phone: '01712345678',
      cod_amount: 1250,
    });
    expect((calls[0]?.init?.headers as Record<string, string> | undefined)?.['Api-Key']).toBe('k');
  });

  it('turns a refusal into a refused error, and silence into an unsure one', async () => {
    const refused = fakeFetch([{ status: 422, body: { message: 'Invalid phone number' } }]);
    await expect(
      steadfastCourier({ apiKey: 'k', secretKey: 's', fetch: refused.f }).book(parcel),
    ).rejects.toMatchObject({ refused: true, message: 'Steadfast: Invalid phone number' });
    const silent = fakeFetch(['throw']);
    const e = await steadfastCourier({ apiKey: 'k', secretKey: 's', fetch: silent.f })
      .book(parcel)
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(CourierError);
    expect((e as CourierError).refused).toBe(false);
  });

  it('asks by consignment, or by invoice when it has none', async () => {
    const { f, calls } = fakeFetch([
      { body: { status: 200, delivery_status: 'delivered' } },
      { body: { status: 200, delivery_status: 'in_review' } },
    ]);
    const sf = steadfastCourier({ apiKey: 'k', secretKey: 's', fetch: f });
    expect((await sf.status({ consignmentId: '1424107' })).update).toBe('delivered');
    const found = await sf.findByInvoice?.('1001-1');
    expect(found).toMatchObject({ consignmentId: null, update: 'booked' });
    expect(calls.map((c) => c.url)).toEqual([
      'https://portal.packzy.com/api/v1/status_by_cid/1424107',
      'https://portal.packzy.com/api/v1/status_by_invoice/1001-1',
    ]);
  });

  it('believes a webhook only with its Bearer token', () => {
    const sf = steadfastCourier({ apiKey: 'k', secretKey: 's' });
    const body = {
      notification_type: 'delivery_status',
      consignment_id: 1424107,
      invoice: '1001-1',
      cod_amount: 1250,
      delivery_charge: 60,
      status: 'delivered',
    };
    expect(
      sf.parseWebhook(
        { headers: headers({ authorization: 'Bearer secret' }), raw: '', body },
        'secret',
      ),
    ).toEqual({
      consignmentId: '1424107',
      invoice: '1001-1',
      trackingCode: undefined,
      codCollected: 125000,
      fee: 6000,
    });
    expect(
      sf.parseWebhook(
        { headers: headers({ authorization: 'Bearer wrong' }), raw: '', body },
        'secret',
      ),
    ).toBe('refused');
    expect(sf.parseWebhook({ headers: headers({}), raw: '', body }, 'secret')).toBe('refused');
  });
});

describe('the test courier', () => {
  it('books, refuses or stays silent as its note says', async () => {
    const fake = fakeCourier({ apiKey: 'k', nextId: () => 'FK1' });
    expect(await fake.book(parcel)).toMatchObject({ consignmentId: 'FK1', update: 'booked' });
    await expect(fake.book({ ...parcel, note: FAKE_REFUSE })).rejects.toMatchObject({
      refused: true,
    });
    await expect(fake.book({ ...parcel, note: FAKE_NO_ANSWER })).rejects.toMatchObject({
      refused: false,
    });
  });

  it('answers from its lookup', async () => {
    const fake = fakeCourier({
      apiKey: 'k',
      lookup: async (id) => (id === 'FK1' ? { status: 'delivered', codCollected: 125000 } : null),
    });
    expect(await fake.status({ consignmentId: 'FK1' })).toMatchObject({
      update: 'delivered',
      codCollected: 125000,
    });
    await expect(fake.status({ consignmentId: 'FK2' })).rejects.toMatchObject({ refused: true });
  });
});
