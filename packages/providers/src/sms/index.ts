// SMS through a store's own gateway (phase-5a-plan §3.6, §3.14): sms.net.bd,
// BulkSMSBD, or any gateway that takes one HTTPS request per message. Each
// store pays for its own messages, so the platform has no SMS account. No
// SDKs: one fetch per message.
//
// sms.net.bd: https://sms.bd/api (sendsms and user/balance; `error` 0 is
// success). BulkSMSBD: bulksmsbd.net/api/smsapi and getBalanceApi
// (`response_code` 202 is success); its IP whitelist must be off, as Workers
// have no fixed outbound address.

export interface SmsProvider {
  readonly name: string;
  /** `to` is +8801XXXXXXXXX; the adapter writes it the gateway's way. */
  send(to: string, text: string): Promise<{ id: string | null }>;
  /** The account's balance in the gateway's unit (taka or SMS), when it can tell. */
  balance(): Promise<number | null>;
}

/** A failed send. The message never contains the recipient or the text, so it can be logged. */
export class SmsError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, options: { retryable: boolean; message?: string }) {
    super(options.message ?? code);
    this.name = 'SmsError';
    this.code = code;
    this.retryable = options.retryable;
  }
}

type Fetch = typeof fetch;

/** 8801XXXXXXXXX: what both Bangladeshi gateways take. */
const local = (phone: string) => phone.replace(/^\+/, '');

async function call(
  f: Fetch,
  url: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown; text: string }> {
  let res: Response;
  try {
    res = await f(url, init);
  } catch {
    throw new SmsError('network_error', { retryable: true });
  }
  const text = await res.text().catch(() => '');
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  if (res.status >= 500) throw new SmsError(`http_${res.status}`, { retryable: true });
  return { status: res.status, body, text };
}

// ---- sms.net.bd ------------------------------------------------------------------------

const SMS_NET_BD = 'https://api.sms.net.bd';
/** Its codes worth another try: its own unknown error. Balance and content won't change by retrying. */
const SMS_NET_BD_RETRY = new Set([409]);
const SMS_NET_BD_CODES: Record<number, string> = {
  400: 'invalid_request',
  403: 'forbidden',
  405: 'unauthorized',
  409: 'gateway_error',
  410: 'account_expired',
  411: 'reseller_expired',
  413: 'invalid_sender_id',
  414: 'empty_message',
  415: 'message_too_long',
  416: 'invalid_number',
  417: 'insufficient_balance',
  420: 'content_blocked',
};

export function smsNetBdProvider(o: {
  apiKey: string;
  senderId?: string | undefined;
  fetch?: Fetch;
}): SmsProvider {
  const f = o.fetch ?? fetch;
  return {
    name: 'sms_net_bd',
    async send(to, text) {
      const form = new URLSearchParams({
        api_key: o.apiKey,
        msg: text,
        to: local(to),
        ...(o.senderId ? { sender_id: o.senderId } : {}),
      });
      const { body } = await call(f, `${SMS_NET_BD}/sendsms`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form,
      });
      const b = (body ?? {}) as { error?: number; msg?: string; data?: { request_id?: unknown } };
      if (b.error === 0) return { id: b.data?.request_id ? String(b.data.request_id) : null };
      const code = Number(b.error ?? 0);
      throw new SmsError(SMS_NET_BD_CODES[code] ?? `error_${code}`, {
        retryable: SMS_NET_BD_RETRY.has(code),
        message: `sms.net.bd: ${b.msg ?? 'refused'}`,
      });
    },
    async balance() {
      const { body } = await call(
        f,
        `${SMS_NET_BD}/user/balance/?${new URLSearchParams({ api_key: o.apiKey })}`,
      );
      const b = (body ?? {}) as { error?: number; msg?: string; data?: { balance?: unknown } };
      if (b.error !== 0) {
        throw new SmsError(SMS_NET_BD_CODES[Number(b.error)] ?? 'refused', {
          retryable: false,
          message: `sms.net.bd: ${b.msg ?? 'refused'}`,
        });
      }
      const n = Number(b.data?.balance);
      return Number.isFinite(n) ? n : null;
    },
  };
}

// ---- BulkSMSBD -------------------------------------------------------------------------

const BULKSMSBD = 'https://bulksmsbd.net/api';
const BULKSMSBD_OK = 202;
/** The codes its integrations document; others read as `error_<code>`. */
const BULKSMSBD_CODES: Record<number, string> = {
  1005: 'invalid_sender_id',
  1007: 'insufficient_balance',
  1032: 'ip_not_whitelisted',
};

export function bulkSmsBdProvider(o: {
  apiKey: string;
  senderId: string;
  fetch?: Fetch;
}): SmsProvider {
  const f = o.fetch ?? fetch;
  return {
    name: 'bulksmsbd',
    async send(to, text) {
      const form = new URLSearchParams({
        api_key: o.apiKey,
        type: 'text',
        number: local(to),
        senderid: o.senderId,
        message: text,
      });
      const { body } = await call(f, `${BULKSMSBD}/smsapi`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form,
      });
      const b = (body ?? {}) as {
        response_code?: number;
        message_id?: unknown;
        error_message?: string;
        success_message?: string;
      };
      if (Number(b.response_code) === BULKSMSBD_OK) {
        return { id: b.message_id ? String(b.message_id) : null };
      }
      const code = Number(b.response_code ?? 0);
      throw new SmsError(BULKSMSBD_CODES[code] ?? `error_${code}`, {
        retryable: false,
        message: `BulkSMSBD: ${b.error_message ?? `code ${code}`}`,
      });
    },
    async balance() {
      const { body } = await call(f, `${BULKSMSBD}/getBalanceApi`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ api_key: o.apiKey }),
      });
      const b = (body ?? {}) as {
        response_code?: number;
        balance?: unknown;
        error_message?: string;
      };
      if (Number(b.response_code) !== BULKSMSBD_OK) {
        const code = Number(b.response_code ?? 0);
        throw new SmsError(BULKSMSBD_CODES[code] ?? `error_${code}`, {
          retryable: false,
          message: `BulkSMSBD: ${b.error_message ?? `code ${code}`}`,
        });
      }
      const n = Number(b.balance);
      return Number.isFinite(n) ? n : null;
    },
  };
}

// ---- Any other gateway -----------------------------------------------------------------

export interface HttpSmsConfig {
  url: string;
  method: 'GET' | 'POST';
  toField: string;
  messageField: string;
  extra: Record<string, string>;
  authHeader?: string | undefined;
  successText?: string | undefined;
}

/**
 * One HTTPS request per message (§3.6): the number and text in the named
 * fields, fixed extras beside them, an optional secret header, and success
 * when the response is 2xx and (if set) contains the given text.
 */
export function httpSmsProvider(
  config: HttpSmsConfig,
  secret: { authValue?: string | undefined },
  f: Fetch = fetch,
): SmsProvider {
  if (!config.url.startsWith('https://')) throw new Error('the gateway URL must be https');
  return {
    name: 'sms_http',
    async send(to, text) {
      const fields = new URLSearchParams({
        ...config.extra,
        [config.toField]: local(to),
        [config.messageField]: text,
      });
      const headers: Record<string, string> = {};
      if (config.authHeader && secret.authValue) headers[config.authHeader] = secret.authValue;
      const url =
        config.method === 'GET'
          ? `${config.url}${config.url.includes('?') ? '&' : '?'}${fields}`
          : config.url;
      const { status, text: answer } = await call(f, url, {
        method: config.method,
        headers:
          config.method === 'POST'
            ? { ...headers, 'content-type': 'application/x-www-form-urlencoded' }
            : headers,
        ...(config.method === 'POST' ? { body: fields } : {}),
      });
      const ok =
        status >= 200 &&
        status < 300 &&
        (!config.successText || answer.includes(config.successText));
      if (!ok) {
        throw new SmsError(status === 429 ? 'rate_limited' : `http_${status}`, {
          retryable: status === 429,
          message: `the gateway answered ${status}`,
        });
      }
      return { id: null };
    },
    async balance() {
      return null;
    },
  };
}

/** The adapter for a store's saved SMS credentials (§3.1). */
export function smsProviderFor(
  provider: string,
  secrets: Record<string, unknown>,
  config: Record<string, unknown>,
  f: Fetch = fetch,
): SmsProvider {
  switch (provider) {
    case 'sms_net_bd':
      return smsNetBdProvider({
        apiKey: String(secrets.apiKey),
        senderId: config.senderId ? String(config.senderId) : undefined,
        fetch: f,
      });
    case 'bulksmsbd':
      return bulkSmsBdProvider({
        apiKey: String(secrets.apiKey),
        senderId: String(config.senderId),
        fetch: f,
      });
    case 'sms_http':
      return httpSmsProvider(
        config as unknown as HttpSmsConfig,
        { authValue: secrets.authValue ? String(secrets.authValue) : undefined },
        f,
      );
    default:
      throw new Error(`no SMS adapter for ${provider}`);
  }
}
