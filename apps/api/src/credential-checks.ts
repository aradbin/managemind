// Checks a store's credentials with the provider before they are saved
// (phase-5a-plan §3.1): a key that the provider refuses, or an email sender
// it hasn't verified, never reaches the vault. An SMS key must read its
// balance; a generic gateway can only be checked by sending, so it isn't.
import type { CredentialCheck } from '@managemind/core';
import { smsProviderFor } from '@managemind/providers/sms';
import { createSession } from '@managemind/providers/sslcommerz';

type Fetch = typeof fetch;

const domainOf = (email: string) => email.slice(email.lastIndexOf('@') + 1).toLowerCase();

async function json(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** Resend: the key works, and the From address's domain is verified on that account. */
async function checkResend(apiKey: string, from: string, f: Fetch): Promise<void> {
  const res = await f('https://api.resend.com/domains', {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  if (res.status === 401 || res.status === 403) throw new Error('Resend refused the API key');
  if (!res.ok) throw new Error(`Resend answered ${res.status}`);
  const body = (await json(res)) as { data?: { name: string; status: string }[] } | null;
  const domain = domainOf(from);
  const found = body?.data?.find((d) => d.name.toLowerCase() === domain);
  if (!found) throw new Error(`${domain} is not a domain of this Resend account`);
  if (found.status !== 'verified') throw new Error(`${domain} is not verified in Resend yet`);
}

/** Brevo: the key works, and the From address is an active sender, or on an authenticated domain. */
async function checkBrevo(apiKey: string, from: string, f: Fetch): Promise<void> {
  const res = await f('https://api.brevo.com/v3/senders', {
    headers: { 'api-key': apiKey, accept: 'application/json' },
  });
  if (res.status === 401 || res.status === 403) throw new Error('Brevo refused the API key');
  if (!res.ok) throw new Error(`Brevo answered ${res.status}`);
  const body = (await json(res)) as { senders?: { email: string; active: boolean }[] } | null;
  const address = from.toLowerCase();
  const domain = domainOf(from);
  const ok = body?.senders?.some(
    (s) => s.active && (s.email.toLowerCase() === address || domainOf(s.email) === domain),
  );
  if (!ok) throw new Error(`${from} is not an active sender in Brevo`);
}

/**
 * SSLCommerz: a ৳10 session with the store's ID and password (§3.1). The
 * session is never paid, and SSLCommerz lets it lapse.
 */
async function checkSslcommerz(
  storeId: string,
  storePassword: string,
  mode: 'sandbox' | 'live',
  f: Fetch,
): Promise<void> {
  try {
    await createSession(
      { storeId, storePassword, mode },
      {
        tranId: `check-${crypto.randomUUID()}`,
        amount: 1000,
        successUrl: 'https://example.invalid/ok',
        failUrl: 'https://example.invalid/fail',
        cancelUrl: 'https://example.invalid/cancel',
        ipnUrl: 'https://example.invalid/ipn',
        tenantId: 'check',
        productName: 'Credentials check',
        customer: {
          name: 'Check',
          phone: '01700000000',
          email: null,
          address: 'Dhaka',
          city: 'Dhaka',
        },
      },
      f,
    );
  } catch (e) {
    throw new Error(`SSLCommerz (${mode}) refused: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function credentialCheck(f: Fetch = fetch): CredentialCheck {
  return async (c) => {
    switch (c.provider) {
      case 'sslcommerz':
        return checkSslcommerz(
          String(c.secrets.storeId),
          String(c.secrets.storePassword),
          c.mode ?? 'sandbox',
          f,
        );
      case 'resend':
        return checkResend(String(c.secrets.apiKey), String(c.config.from), f);
      case 'brevo':
        return checkBrevo(String(c.secrets.apiKey), String(c.config.from), f);
      case 'sms_net_bd':
      case 'bulksmsbd':
        try {
          await smsProviderFor(c.provider, c.secrets, c.config, f).balance();
        } catch (e) {
          throw new Error(e instanceof Error ? e.message : String(e));
        }
        return;
      case 'sms_http':
        return;
      default:
        throw new Error(`${c.provider} can't be connected yet`);
    }
  };
}
