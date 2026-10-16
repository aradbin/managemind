// Online store data for the admin screens (phase-3-plan §7): queries and the
// API's types for the theme, static pages and domains. The theme's own type
// comes from the shared schema, so the editor builds exactly what the API
// validates.
import type { paths } from '@managemind/sdk';
import type { Theme } from '@managemind/shared/storefront';
import { api, unwrap } from './api';

type Json<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends {
  responses: { 200: { content: { 'application/json': infer T } } };
}
  ? T
  : never;

export type { Theme };
export type ThemeState = { draft: Theme; published: Theme | null; unpublishedChanges: boolean };
export type StorePage = Json<'/v1/admin/pages/{id}', 'get'>;
export type DomainList = Json<'/v1/admin/domains', 'get'>;
export type Domain = DomainList['domains'][number];

export const themeQuery = {
  queryKey: ['theme'] as const,
  queryFn: async () => unwrap(await api.GET('/v1/admin/theme')) as unknown as ThemeState,
};

export const pagesQuery = {
  queryKey: ['pages'] as const,
  queryFn: async () => unwrap(await api.GET('/v1/admin/pages')),
};

export const pageQuery = (id: string) => ({
  queryKey: ['pages', id] as const,
  queryFn: async () => unwrap(await api.GET('/v1/admin/pages/{id}', { params: { path: { id } } })),
});

export const domainsQuery = {
  queryKey: ['domains'] as const,
  queryFn: async () => unwrap(await api.GET('/v1/admin/domains')),
};

/** Media rows by ID, for theme image thumbnails. */
export const mediaQuery = (ids: readonly string[]) => ({
  queryKey: ['media', [...ids].sort()] as const,
  queryFn: async () =>
    ids.length
      ? unwrap(await api.GET('/v1/admin/media', { params: { query: { ids: ids.join(',') } } }))
      : [],
  staleTime: Number.POSITIVE_INFINITY,
});
