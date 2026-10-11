import { describe, expect, it, vi } from 'vitest';
import { sendEmail } from './send';
import { EmailError, type EmailMessage, type EmailProvider } from './types';

const message: EmailMessage = {
  to: 'a@example.test',
  from: 'p <no-reply@example.test>',
  subject: 's',
  html: 'h',
  text: 't',
};

function flaky(errors: Error[]): EmailProvider & { keys: (string | undefined)[] } {
  const keys: (string | undefined)[] = [];
  return {
    name: 'flaky',
    keys,
    async send(m) {
      keys.push(m.idempotencyKey);
      const error = errors.shift();
      if (error) throw error;
      return { id: 'sent' };
    },
  };
}

const sleep = vi.fn(async (_ms: number) => {});
const transient = () => new EmailError('service_unavailable', { retryable: true });

describe('sendEmail', () => {
  it('retries transient failures with the same idempotency key', async () => {
    const provider = flaky([transient(), transient()]);
    await expect(sendEmail(provider, message, { sleep })).resolves.toEqual({ id: 'sent' });
    expect(provider.keys).toHaveLength(3);
    expect(new Set(provider.keys).size).toBe(1);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([200, 400]);
  });

  it('gives up after three attempts', async () => {
    const provider = flaky([transient(), transient(), transient()]);
    await expect(sendEmail(provider, message, { sleep })).rejects.toMatchObject({
      code: 'service_unavailable',
    });
    expect(provider.keys).toHaveLength(3);
  });

  it('does not retry a permanent failure', async () => {
    const provider = flaky([new EmailError('validation_error', { retryable: false })]);
    await expect(sendEmail(provider, message, { sleep })).rejects.toMatchObject({
      code: 'validation_error',
    });
    expect(provider.keys).toHaveLength(1);
  });

  it('keeps a key the caller chose', async () => {
    const provider = flaky([]);
    await sendEmail(provider, { ...message, idempotencyKey: 'mine' }, { sleep });
    expect(provider.keys).toEqual(['mine']);
  });
});
