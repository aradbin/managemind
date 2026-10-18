import { describe, expect, it } from 'vitest';
import { createSession, fromTaka, queryTransaction, refund, toTaka, validate } from './sslcommerz';

const creds = { storeId: 'test123', storePassword: 'secret@ssl', mode: 'sandbox' as const };
const seen: Request[] = [];
const respond =
  (body: unknown, status = 200): typeof fetch =>
  async (input, init) => {
    seen.push(new Request(input as string, init));
    return new Response(JSON.stringify(body), { status });
  };

describe('amounts', () => {
  it('go out as taka with two decimals and come back to the exact poisha', () => {
    expect(toTaka(125050)).toBe('1250.50');
    expect(toTaka(1000)).toBe('10.00');
    expect(toTaka(5)).toBe('0.05');
    expect(fromTaka('1250.50')).toBe(125050);
    expect(fromTaka('1250.5')).toBe(125050);
    expect(fromTaka('1250')).toBe(125000);
    expect(fromTaka('12.345')).toBeNull();
    expect(fromTaka('abc')).toBeNull();
  });
});

describe('SSLCommerz', () => {
  it('starts a session with our tran_id and tenant, and returns the gateway page', async () => {
    const session = await createSession(
      creds,
      {
        tranId: 'pay-1',
        amount: 60_000,
        successUrl: 'https://s/ok',
        failUrl: 'https://s/fail',
        cancelUrl: 'https://s/cancel',
        ipnUrl: 'https://api/ipn',
        tenantId: 't-1',
        productName: 'Order #1001',
        customer: {
          name: 'Rina',
          phone: '+8801712000333',
          email: null,
          address: 'House 1',
          city: 'Dhaka',
        },
      },
      respond({
        status: 'SUCCESS',
        GatewayPageURL: 'https://sandbox.sslcommerz.com/gw',
        sessionkey: 'k',
      }),
    );
    expect(session).toEqual({ url: 'https://sandbox.sslcommerz.com/gw', sessionKey: 'k' });
    const form = new URLSearchParams(await (seen.at(-1) as Request).text());
    expect(form.get('total_amount')).toBe('600.00');
    expect(form.get('tran_id')).toBe('pay-1');
    expect(form.get('value_a')).toBe('t-1');
    expect(form.get('currency')).toBe('BDT');
  });

  it('refuses a session SSLCommerz failed', async () => {
    await expect(
      createSession(
        creds,
        {
          tranId: 'p',
          amount: 1000,
          successUrl: 's',
          failUrl: 'f',
          cancelUrl: 'c',
          ipnUrl: 'i',
          tenantId: 't',
          productName: 'x',
          customer: { name: 'R', phone: '1', email: null, address: '', city: 'Dhaka' },
        },
        respond({ status: 'FAILED', failedreason: 'Store Credential Error' }),
      ),
    ).rejects.toThrow('Store Credential Error');
  });

  it('parses a validation answer', async () => {
    const v = await validate(
      creds,
      'val-1',
      respond({
        status: 'VALID',
        tran_id: 'pay-1',
        val_id: 'val-1',
        amount: '600.00',
        currency_type: 'BDT',
        currency_amount: '600.00',
        value_a: 't-1',
        bank_tran_id: 'b-1',
        risk_level: '0',
        card_type: 'BKASH-BKash',
      }),
    );
    expect(v).toMatchObject({
      status: 'VALID',
      tranId: 'pay-1',
      amount: 60_000,
      currency: 'BDT',
      valueA: 't-1',
      riskLevel: 0,
    });
    expect(new URL((seen.at(-1) as Request).url).pathname).toBe(
      '/validator/api/validationserverAPI.php',
    );
  });

  it('finds the settled element of a transaction query, or none', async () => {
    const paid = await queryTransaction(
      creds,
      'pay-1',
      respond({
        no_of_trans_found: 2,
        element: [
          { status: 'FAILED', val_id: 'v0' },
          { status: 'VALID', val_id: 'v1', tran_id: 'pay-1', amount: '600.00', currency: 'BDT' },
        ],
      }),
    );
    expect(paid).toMatchObject({ valId: 'v1', amount: 60_000 });
    expect(await queryTransaction(creds, 'pay-1', respond({ no_of_trans_found: 0 }))).toBeNull();
  });

  it('tells a refund from an unregistered IP apart', async () => {
    expect(
      await refund(
        creds,
        { bankTranId: 'b', refundTransId: 'r', amount: 10_000, remarks: 'return' },
        respond({ APIConnect: 'DONE', status: 'success', refund_ref_id: 'ref-1' }),
      ),
    ).toEqual({ status: 'success', refundRefId: 'ref-1' });
    expect(
      await refund(
        creds,
        { bankTranId: 'b', refundTransId: 'r', amount: 10_000, remarks: 'return' },
        respond({ APIConnect: 'INVALID_REQUEST', status: 'failed', errorReason: 'INVALID_SOURCE' }),
      ),
    ).toMatchObject({ status: 'failed', invalidSource: true });
  });
});
