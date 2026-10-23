// Provider credentials, templates and the delivery log (phase-5a-plan §7).
import type { paths } from '@managemind/sdk';
import { ApiError, api, unwrap } from './api';

type Json<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends {
  responses: { 200: { content: { 'application/json': infer T } } };
}
  ? T
  : never;

export type Credential = Json<'/v1/admin/credentials', 'get'>[number];
export type Template = Json<'/v1/admin/templates', 'get'>[number];
export type TemplatePreview = Json<'/v1/admin/templates/preview', 'post'>;
export type MessageRow = Json<'/v1/admin/messages', 'get'>[number];

export const credentialsQuery = {
  queryKey: ['credentials'] as const,
  queryFn: async () => unwrap(await api.GET('/v1/admin/credentials')),
};

export const templatesQuery = {
  queryKey: ['templates'] as const,
  queryFn: async () => unwrap(await api.GET('/v1/admin/templates')),
};

export interface MessageFilters {
  status?: MessageRow['status'] | undefined;
  channel?: MessageRow['channel'] | undefined;
  orderId?: string | undefined;
}

export const messagesQuery = (filters: MessageFilters, before?: string) => ({
  queryKey: ['messages', filters, before ?? null] as const,
  queryFn: async () =>
    unwrap(
      await api.GET('/v1/admin/messages', {
        params: {
          query: {
            ...(filters.status ? { status: filters.status } : {}),
            ...(filters.channel ? { channel: filters.channel } : {}),
            ...(filters.orderId ? { orderId: filters.orderId } : {}),
            ...(before ? { before } : {}),
            limit: 50,
          },
        },
      }),
    ),
});

/** The field errors of a refused save, by path: cod.advance → needs_gateway. */
export function fieldErrors(error: unknown): Record<string, { code: string; message: string }> {
  if (!(error instanceof ApiError) || error.status !== 422) return {};
  return Object.fromEntries(
    (error.problem?.errors ?? []).map((f) => [f.path, { code: f.code, message: f.message }]),
  );
}
