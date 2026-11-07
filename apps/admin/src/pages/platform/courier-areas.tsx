// Platform → Courier areas (phase-7-plan §3.6): our areas against Pathao's
// zones and RedX's areas. The weekly sync matches names within a district;
// a super admin matches the rest from the closest names, and the match then
// serves every store's bookings.
import { formatNumber } from '@managemind/shared/i18n';
import type { AreaCourier } from '@managemind/shared/orders';
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import { useState } from 'react';
import { Notice } from '../../components/notice';
import { PageHeader } from '../../components/page-header';
import { useToast } from '../../components/toast';
import { Button } from '../../components/ui/button';
import { chipClass, Segmented } from '../../components/ui/segmented';
import { Switch } from '../../components/ui/switch';
import { useLocale } from '../../i18n';
import '../../i18n/couriers';
import { api, meQuery, unwrap } from '../../lib/api';
import { courierName } from '../../lib/couriers';
import { errorMessage, saveErrorMessage } from '../../lib/errors';
import { cn } from '../../lib/utils';

export function CourierAreasPage() {
  const { t, locale } = useLocale();
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
    <div className="flex w-full max-w-[860px] flex-col gap-3 md:gap-4">
      <PageHeader
        className="mb-0"
        title={t('platform.courierAreas')}
        description={t('courierAreas.description')}
      />
      {!canEdit && (
        <div className="flex items-start gap-2.5 rounded-[10px] bg-muted px-3.5 py-3">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p>{t('courierAreas.superAdminOnly')}</p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <Segmented
          label={t('courierAreas.courier')}
          value={courier}
          options={(['pathao', 'redx'] as const).map((c) => ({
            value: c,
            label: courierName(c, t),
          }))}
          onChange={setCourier}
        />
        <span className="flex items-center gap-2.5">
          <Switch id="areas-unmatched" checked={unmatched} onCheckedChange={setUnmatched} />
          <label htmlFor="areas-unmatched">{t('courierAreas.unmatchedOnly')}</label>
        </span>
        {areas.data && (
          <span className="ml-auto text-[13px] text-muted-foreground">
            {t('courierAreas.count', { count: formatNumber(locale, areas.data.length) })}
          </span>
        )}
      </div>
      {areas.isPending && <p role="status">{t('loading')}</p>}
      {areas.isError && <Notice tone="error">{errorMessage(areas.error, t)}</Notice>}
      {save.error && <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>}
      {areas.data?.length === 0 && (
        <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
          <p className="text-muted-foreground">{t('courierAreas.none')}</p>
        </div>
      )}
      {areas.data && areas.data.length > 0 && (
        <ul
          aria-label={t('courierAreas.areas')}
          className="overflow-hidden rounded-xl border border-border bg-card"
        >
          {areas.data.map((a) => (
            <li
              key={a.areaId}
              className="flex flex-col gap-2.5 border-t border-border px-4 py-3.5 first:border-t-0"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="font-medium">
                  {a.name} <span className="font-normal text-muted-foreground">· {a.district}</span>
                </span>
                <span
                  className={cn(
                    'text-[13px]',
                    a.match ? 'text-success-foreground' : 'text-muted-foreground',
                  )}
                >
                  {a.match
                    ? `${t('courierAreas.matched', { name: a.match.name })} (${
                        a.match.how === 'manual'
                          ? t('courierAreas.manual')
                          : t('courierAreas.byName')
                      })`
                    : t('courierAreas.noMatch')}
                </span>
              </div>
              {canEdit && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {a.suggestions.length === 0 && (
                    <span className="text-[13px] text-muted-foreground">
                      {t('courierAreas.noSuggestions')}
                    </span>
                  )}
                  {a.suggestions.map((s) => (
                    <button
                      key={s.externalId}
                      type="button"
                      aria-pressed={a.match?.externalId === s.externalId}
                      disabled={save.isPending}
                      onClick={() => save.mutate({ areaId: a.areaId, externalId: s.externalId })}
                      className={chipClass}
                    >
                      {s.name}
                      {s.parent ? ` · ${s.parent}` : ''}
                    </button>
                  ))}
                  {a.match && (
                    <Button
                      variant="ghost"
                      className="h-7 px-2 md:h-7"
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
