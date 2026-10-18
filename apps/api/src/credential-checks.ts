// Checks a store's credentials with the provider before they are saved
// (phase-5a-plan §3.1): a key that the provider refuses, or an email sender
// it hasn't verified, never reaches the vault. Each later adapter adds its
// check here (SSLCommerz in plan PR 7, SMS gateways in PR 12).
import type { CredentialCheck } from '@managemind/core';

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

export function credentialCheck(f: Fetch = fetch): CredentialCheck {
  return async (c) => {
    switch (c.provider) {
      case 'resend':
        return checkResend(String(c.secrets.apiKey), String(c.config.from), f);
      case 'brevo':
        return checkBrevo(String(c.secrets.apiKey), String(c.config.from), f);
      default:
        throw new Error(`${c.provider} can't be connected yet`);
    }
  };
}
