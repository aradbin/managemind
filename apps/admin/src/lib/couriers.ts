// Couriers in the admin (phase-7-plan §3.9): the connected couriers, the
// booking sheet's preview, and names shown to staff.
import type { paths } from '@managemind/sdk';
import { COURIER_NAMES, type Courier } from '@managemind/shared/orders';
import type { AdminKey } from '../i18n';
import { api, unwrap } from './api';

type Json<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends {
  responses: { 200: { content: { 'application/json': infer T } } };
}
  ? T
  : never;

export type Couriers = Json<'/v1/admin/couriers', 'get'>;
export type ConnectedCourier = Couriers['connected'][number];
export type BookingPreview = Json<'/v1/admin/orders/{id}/booking/preview', 'post'>;
export type BookingOutcome = Json<'/v1/admin/orders/{id}/booking', 'post'>;
export type CourierPlace = Json<'/v1/admin/couriers/{courier}/places', 'get'>[number];
export type CourierReturn = Json<'/v1/admin/courier-returns', 'get'>[number];

export const couriersQuery = {
  queryKey: ['couriers'] as const,
  queryFn: async () => unwrap(await api.GET('/v1/admin/couriers')),
};

export const courierReturnsQuery = {
  queryKey: ['courier-returns'] as const,
  queryFn: async () => unwrap(await api.GET('/v1/admin/courier-returns')),
};

/** A courier's name: brand names as they are, the test courier in the admin's language. */
export function courierName(courier: string, t: (key: AdminKey) => string): string {
  if (courier === 'fake') return t('couriers.name.fake');
  return COURIER_NAMES[courier as Courier] ?? courier;
}

/** The couriers connected, the store's default first (phase-7-plan §3.8). */
export function orderedCouriers(couriers: Couriers | undefined, preferred: string | null) {
  const connected = couriers?.connected.map((c) => c.courier) ?? [];
  return preferred && connected.includes(preferred as Courier)
    ? [preferred as Courier, ...connected.filter((c) => c !== preferred)]
    : connected;
}
