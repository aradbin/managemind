// Platform → Courier areas (phase-7-plan §3.6): our areas against Pathao's
// zones and RedX's areas. The weekly sync matches names within a district;
// a super admin matches the rest from the closest names, and the match then
// serves every store's bookings.
import type { AreaCourier } from '@managemind/shared/orders';
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Notice } from '../../components/notice';
import { PageHeader } from '../../components/page-header';
import { useToast } from '../../components/toast';
import { Button } from '../../components/ui/button';
import { useLocale } from '../../i18n';
import '../../i18n/couriers';
import { api, meQuery, unwrap } from '../../lib/api';
import { courierName } from '../../lib/couriers';
import { errorMessage, saveErrorMessage } from '../../lib/errors';

export function CourierAreasPage() {
  const { t } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: me } = useSuspenseQuery(meQuery);
  const canEdit = me.user.platformRole === 'super_admin';
  const [courier, setCourier] = useState<AreaCourier>('pathao');
  const [unmatched, setUnmatched] = useState(true);
  const key = ['platform', 'courier-areas', courier, unmatched] as const;
  const areas = useQuery({
    queryKey: key,
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/platform/courier-areas', {
          params: { query: { courier, unmatched: unmatched ? 'true' : 'false' } },
        }),
      ),
  });
  const save = useMutation({
    mutationFn: async (v: { areaId: number; externalId: number | null }) =>
      unwrap(
        await api.PUT('/v1/platform/courier-areas/{courier}/{areaId}', {
          params: { path: { courier, areaId: v.areaId } },
          body: { externalId: v.externalId },
        }),
      ),
    onSuccess: async () => {
      toast(t('courierAreas.saved'));
      await queryClient.invalidateQueries({ queryKey: ['platform', 'courier-areas'] });
    },
  });
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={t('platform.courierAreas')} description={t('courierAreas.description')} />
      {!canEdit && <Notice>{t('courierAreas.superAdminOnly')}</Notice>}
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2">
          <span className="text-sm font-medium">{t('courierAreas.courier')}</span>
          <select
            className="min-h-11 rounded-md border border-input bg-background px-3"
            value={courier}
            onChange={(e) => setCourier(e.target.value as AreaCourier)}
          >
            {(['pathao', 'redx'] as const).map((c) => (
              <option key={c} value={c}>
                {courierName(c, t)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            className="size-5"
            checked={unmatched}
            onChange={(e) => setUnmatched(e.target.checked)}
          />
          {t('courierAreas.unmatchedOnly')}
        </label>
      </div>
      {areas.isPending && <p role="status">{t('loading')}</p>}
      {areas.isError && <Notice tone="error">{errorMessage(areas.error, t)}</Notice>}
      {save.error && <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>}
      {areas.data?.length === 0 && (
        <p className="text-muted-foreground">{t('courierAreas.none')}</p>
      )}
      {areas.data && areas.data.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-background">
          {areas.data.map((a) => (
            <li key={a.areaId} className="flex flex-col gap-2 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">
                  {a.name} <span className="text-muted-foreground">· {a.district}</span>
                </span>
                {a.match && (
                  <span className="text-sm">
                    {t('courierAreas.matched', { name: a.match.name })} (
                    {a.match.how === 'manual' ? t('courierAreas.manual') : t('courierAreas.byName')}
                    )
                  </span>
                )}
              </div>
              {canEdit && (
                <div className="flex flex-wrap gap-2">
                  {a.suggestions.length === 0 && (
                    <span className="text-sm text-muted-foreground">
                      {t('courierAreas.noSuggestions')}
                    </span>
                  )}
                  {a.suggestions.map((s) => (
                    <Button
                      key={s.externalId}
                      variant={a.match?.externalId === s.externalId ? 'primary' : 'secondary'}
                      disabled={save.isPending}
                      onClick={() => save.mutate({ areaId: a.areaId, externalId: s.externalId })}
                    >
                      {s.name}
                      {s.parent ? ` · ${s.parent}` : ''}
                    </Button>
                  ))}
                  {a.match && (
                    <Button
                      variant="quiet"
                      disabled={save.isPending}
                      onClick={() => save.mutate({ areaId: a.areaId, externalId: null })}
                    >
                      {t('courierAreas.clear')}
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
