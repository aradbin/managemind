// Returns and refunds for the admin screens (phase-5a-plan §7): the API's
// types and queries.
import type { paths } from '@managemind/sdk';
import { ApiError, api, unwrap } from './api';

type Json<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends {
  responses: { 200: { content: { 'application/json': infer T } } };
}
  ? T
  : paths[P][M] extends { responses: { 201: { content: { 'application/json': infer T } } } }
    ? T
    : never;

export type ReturnSummary = Json<'/v1/admin/returns', 'get'>[number];
export type ReturnDetail = Json<'/v1/admin/returns/{id}', 'get'>;
export type ReturnableLine = Json<'/v1/admin/orders/{id}/returnable', 'get'>[number];
export type RefundPreview = Json<'/v1/admin/orders/{id}/refunds/preview', 'post'>;
export type ReturnStatus = ReturnSummary['status'];
export type RefundMethod = Json<'/v1/admin/orders/{id}/refunds', 'post'>['method'];

export const RETURN_STEPS = ['requested', 'approved', 'received', 'inspected', 'resolved'] as const;

export type ReturnReason = ReturnSummary['reason'];

export const returnsQuery = (status?: ReturnStatus, before?: string, reason?: ReturnReason) => ({
  queryKey: ['returns', status ?? null, before ?? null, reason ?? null] as const,
  queryFn: async () =>
    unwrap(
      await api.GET('/v1/admin/returns', {
        params: {
          query: {
            ...(status ? { status } : {}),
            ...(reason ? { reason } : {}),
            ...(before ? { before } : {}),
            limit: 50,
          },
        },
      }),
    ),
});

export const returnQuery = (id: string) => ({
  queryKey: ['return', id] as const,
  queryFn: async () =>
    unwrap(await api.GET('/v1/admin/returns/{id}', { params: { path: { id } } })),
});

export const returnableQuery = (orderId: string) => ({
  queryKey: ['returnable', orderId] as const,
  queryFn: async () =>
    unwrap(
      await api.GET('/v1/admin/orders/{id}/returnable', { params: { path: { id: orderId } } }),
    ),
});

export const refundPreviewQuery = (orderId: string, returnId: string | null) => ({
  queryKey: ['refund-preview', orderId, returnId] as const,
  queryFn: async () =>
    unwrap(
      await api.POST('/v1/admin/orders/{id}/refunds/preview', {
        params: { path: { id: orderId } },
        body: returnId ? { returnId } : {},
      }),
    ),
  staleTime: 0,
});

export const photoUrl = (returnId: string, photoId: string) =>
  `/api/admin/returns/${returnId}/photos/${photoId}`;

/** The API's reason for a refused move, when it gave one (they are written for staff). */
export function returnErrorMessage(error: unknown, fallback: (error: unknown) => string): string {
  if (error instanceof ApiError && (error.status === 409 || error.status === 422)) {
    const field = error.problem?.errors?.[0]?.message;
    return field ?? error.problem?.detail ?? fallback(error);
  }
  return fallback(error);
}
