// The API client and the query cache. Requests go to the admin's own host,
// which serves the API under the same origin (phase-1-plan §3.5).
import { createClient, type Problem, type paths } from '@managemind/sdk';
import { QueryClient } from '@tanstack/react-query';

export const api = createClient();

export type Me = paths['/v1/admin/me']['get']['responses'][200]['content']['application/json'];

/** An API error with its problem details, thrown by unwrap(). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: Problem | undefined,
    /** Seconds to wait, from Retry-After on a 429. */
    readonly retryAfter: number | null = null,
  ) {
    super(problem?.code ?? `http_${status}`);
    this.name = 'ApiError';
  }
}

/** The data of a successful openapi-fetch result (undefined for a 204), or an ApiError. */
export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.error !== undefined || !result.response.ok) {
    const retry = Number(result.response.headers.get('retry-after'));
    throw new ApiError(
      result.response.status,
      result.error as Problem | undefined,
      Number.isFinite(retry) && retry > 0 ? retry : null,
    );
  }
  return result.data as T;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Don't retry what the server refused on purpose.
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
    },
  },
});

export const meQuery = {
  queryKey: ['me'] as const,
  queryFn: async () => unwrap(await api.GET('/v1/admin/me')),
};
