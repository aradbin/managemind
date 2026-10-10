// JSON over HTTPS with a bearer token. Retries network errors, 429 and 5xx a
// few times; anything else fails at once with the API's own message. Request
// and response bodies are never logged: some carry passwords.

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface ApiClient {
  request<T>(method: string, path: string, body?: unknown): Promise<T>;
}

export function apiClient(base: string, token: string, service: string): ApiClient {
  return {
    async request<T>(method: string, path: string, body?: unknown): Promise<T> {
      for (let attempt = 1; ; attempt++) {
        let res: Response;
        try {
          res = await fetch(`${base}${path}`, {
            method,
            headers: {
              authorization: `Bearer ${token}`,
              accept: 'application/json',
              ...(body === undefined ? {} : { 'content-type': 'application/json' }),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
        } catch (e) {
          if (attempt < 4) {
            await sleep(1000 * attempt);
            continue;
          }
          throw e;
        }
        if ((res.status === 429 || res.status >= 500) && attempt < 4) {
          await sleep(1000 * attempt);
          continue;
        }
        const text = await res.text();
        if (!res.ok) {
          throw new HttpError(
            res.status,
            `${service} ${method} ${path}: ${res.status} ${errorText(text)}`,
          );
        }
        return (text ? JSON.parse(text) : undefined) as T;
      }
    },
  };
}

/** The error message an API returned, without echoing the whole body. */
function errorText(body: string): string {
  try {
    const json = JSON.parse(body) as { message?: string; errors?: { message?: string }[] };
    return json.message ?? json.errors?.map((e) => e.message).join('; ') ?? body.slice(0, 200);
  } catch {
    return body.slice(0, 200);
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
