import { describe, expect, it, vi } from 'vitest';
import { cloudflareTurnstileWidget } from './index';

const widget = {
  sitekey: 'k',
  name: 'managemind',
  mode: 'invisible',
  domains: ['managemind.store'],
};

describe('cloudflareTurnstileWidget', () => {
  it('reads the list, and replaces it keeping the widget’s other settings', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'PUT'
        ? Response.json({
            success: true,
            result: { ...widget, domains: JSON.parse(String(init.body)).domains },
          })
        : Response.json({ success: true, result: widget }),
    );
    const w = cloudflareTurnstileWidget({ accountId: 'acc', siteKey: 'k', token: 't', fetcher });
    expect(await w.hostnames()).toEqual(['managemind.store']);
    expect(await w.setHostnames(['managemind.store', 'www.shop.test'])).toBe(true);
    const put = fetcher.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(put?.[0]).toBe('https://api.cloudflare.com/client/v4/accounts/acc/challenges/widgets/k');
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({
      name: 'managemind',
      mode: 'invisible',
      domains: ['managemind.store', 'www.shop.test'],
    });
  });

  it('answers false when Cloudflare refuses the list, and throws on other failures', async () => {
    const refused = cloudflareTurnstileWidget({
      accountId: 'a',
      siteKey: 'k',
      token: 't',
      fetcher: vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) =>
        init?.method === 'PUT'
          ? Response.json({ success: false, errors: [{ message: 'too many' }] }, { status: 400 })
          : Response.json({ success: true, result: widget }),
      ),
    });
    expect(await refused.setHostnames(Array.from({ length: 11 }, (_, i) => `h${i}.test`))).toBe(
      false,
    );
    const broken = cloudflareTurnstileWidget({
      accountId: 'a',
      siteKey: 'k',
      token: 't',
      fetcher: vi.fn(async () =>
        Response.json({ success: false, errors: [{ message: 'no' }] }, { status: 403 }),
      ),
    });
    await expect(broken.hostnames()).rejects.toMatchObject({ status: 403 });
  });
});
