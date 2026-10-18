// Phone codes before cash on delivery (phase-5a-plan §3.14): sent straight
// through the store's own SMS gateway after the response is decided, never
// through the outbox, and checked by the store-and-phone object.
import { loadCredentials, type TenantTx } from '@managemind/core';
import { smsProviderFor } from '@managemind/providers/sms';
import { AppError } from '@managemind/shared';
import type { Env } from '../env';
import { credentialsKeyring } from '../notifications';

const objectFor = (env: Env, tenantId: string, phone: string) =>
  env.OTP_CODES.getByName(`${tenantId}:${phone}`);

/** The store's SMS gateway, when it has one that can send codes. */
export async function smsGatewayFor(tx: TenantTx, env: Env) {
  try {
    const saved = await loadCredentials(tx, await credentialsKeyring(env), 'sms');
    return saved ? smsProviderFor(saved.provider, saved.secrets, saved.config) : null;
  } catch {
    return null;
  }
}

const TEXT = {
  en: (code: string, store: string) =>
    `${code} is your code for ${store}. It expires in 10 minutes.`,
  bn: (code: string, store: string) => `${store}: আপনার কোড ${code}। ১০ মিনিট পর্যন্ত চলবে।`,
} as const;

/** Issues a code and texts it; a gateway that refuses it is a 503 the shopper can retry. */
export async function sendOtp(
  env: Env,
  gateway: NonNullable<Awaited<ReturnType<typeof smsGatewayFor>>>,
  tenantId: string,
  phone: string,
  storeName: string,
  locale: 'bn' | 'en',
): Promise<void> {
  const code = await objectFor(env, tenantId, phone).issue();
  try {
    await gateway.send(phone, TEXT[locale](code, storeName));
  } catch (e) {
    throw new AppError('feature_unavailable', {
      detail: 'The code could not be sent; try again',
      cause: e,
    });
  }
}

export async function verifyOtp(env: Env, tenantId: string, phone: string, code: string) {
  return objectFor(env, tenantId, phone).verify(code);
}

export async function otpVerified(
  env: Env,
  tenantId: string,
  phone: string,
  token: string | undefined,
): Promise<boolean> {
  return token ? objectFor(env, tenantId, phone).check(token) : false;
}
