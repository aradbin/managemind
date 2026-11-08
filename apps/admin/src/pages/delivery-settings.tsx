// Settings → Delivery (phase-4-plan §3.3, §7): zones with their fee, weight
// rule and coverage, picked from the division, district and area lists, and
// a fee calculator. An area listed in a zone wins over its district; the
// fallback zone covers everywhere else.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog } from '../components/confirm-dialog';
import { Field } from '../components/field';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { emptyPlace, type PlaceDraft, PlacePicker } from '../components/place-picker';
import { useToast } from '../components/toast';
import { SecondaryBadge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { cardPadded, cardTitle } from '../components/ui/card';
import { Combobox } from '../components/ui/combobox';
import { Sheet, SheetBody, SheetDelete, SheetFooter, SheetForm } from '../components/ui/sheet';
import { useLocale } from '../i18n';
import '../i18n/orders';
import { api, unwrap } from '../lib/api';
import { formatPrice, priceInput, readPrice } from '../lib/catalog';
import { errorMessage } from '../lib/errors';
import {
  type Geo,
  geoQuery,
  orderErrorMessage,
  pickText,
  type Zone,
  zonesQuery,
} from '../lib/orders';
import { cn } from '../lib/utils';

const MAX_ZONES = 20;

export function DeliverySettingsPage() {
  const { t, locale } = useLocale();
  const canEdit = usePermission('settings.write');
  const zones = useQuery(zonesQuery);
  const geo = useQuery(geoQuery);
  const [editing, setEditing] = useState<Zone | 'new' | null>(null);
  if (zones.isPending) return <p role="status">{t('loading')}</p>;
  if (zones.isError) return <Notice tone="error">{errorMessage(zones.error, t)}</Notice>;
  const g = geo.data;
  const coverage = (z: Zone) => {
    if (z.isFallback) return t('delivery.everywhereElse');
    if (!g) return '';
    const idx = g.geoIndex();
    const names = [
      ...z.districtIds.map((id) => idx.district(id)?.[locale]),
      ...z.areaIds.map((id) => idx.area(id)?.[locale]),
    ].filter(Boolean) as string[];
    const shown = names.slice(0, 6).join(', ');
    return names.length > 6
      ? t('delivery.andMore', { names: shown, count: names.length - 6 })
      : shown;
  };
  return (
    <div className="flex flex-col gap-3 md:gap-4">
      <PageHeader
        parent={{ to: '/settings', label: t('settings.title') }}
        className="mb-0"
        title={t('delivery.title')}
        description={t('delivery.intro')}
      />
      {!canEdit && <Notice>{t('store.readOnly')}</Notice>}
      {!zones.data.some((z) => z.isFallback && z.active) && (
        <Notice tone="error">{t('delivery.noFallback')}</Notice>
      )}
      <section aria-labelledby="zones-h" className={cn(cardPadded, 'gap-1 md:gap-1')}>
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 id="zones-h" className={cardTitle}>
              {t('delivery.zones')}
            </h2>
            <p className="text-[13px] text-muted-foreground">{t('delivery.zonesHint')}</p>
          </div>
          {canEdit && zones.data.length < MAX_ZONES && (
            <Button variant="secondary" onClick={() => setEditing('new')}>
              <Plus aria-hidden />
              {t('delivery.add')}
            </Button>
          )}
        </div>
        <ul aria-label={t('delivery.title')} className="-mx-4 mt-2 md:-mx-5">
          {zones.data.map((z) => (
            <li
              key={z.id}
              className="flex items-center gap-3 border-t border-border py-3 pr-3 pl-4 md:pl-5"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{pickText(z.name, locale)}</span>
                  {!z.active && <SecondaryBadge>{t('delivery.inactive')}</SecondaryBadge>}
                  {z.isFallback && <SecondaryBadge>{t('delivery.fallbackShort')}</SecondaryBadge>}
                </span>
                <span className="text-[13px] text-muted-foreground">
                  {[coverage(z), pickText(z.estimate, locale)].filter(Boolean).join(' · ')}
                </span>
                {z.freeWeightGrams !== null && z.feePerExtraKg !== null && (
                  <span className="text-xs text-muted-foreground">
                    {t('delivery.weightRule', {
                      kg: z.freeWeightGrams / 1000,
                      fee: formatPrice(z.feePerExtraKg, locale),
                    })}
                  </span>
                )}
              </div>
              <span className="shrink-0 font-semibold tabular-nums">
                {formatPrice(z.fee, locale)}
              </span>
              {canEdit && (
                <Button
                  variant="ghost"
                  aria-label={`${t('action.edit')}: ${pickText(z.name, locale)}`}
                  onClick={() => setEditing(z)}
                >
                  {t('action.edit')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>
      <FeeCalculator />
      {editing && g && (
        <ZoneDialog
          zone={editing === 'new' ? undefined : editing}
          zones={zones.data}
          geo={g}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function FeeCalculator() {
  const { t, locale } = useLocale();
  const [place, setPlace] = useState<PlaceDraft>(emptyPlace);
  const [kg, setKg] = useState('1');
  const grams = Math.round(
    Number(kg.replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d)))) * 1000,
  );
  const quote = useQuery({
    queryKey: ['zone-quote', place.areaId, grams] as const,
    queryFn: async () =>
      unwrap(
        await api.POST('/v1/admin/delivery-zones/quote', {
          body: { areaId: place.areaId as number, weightGrams: grams },
        }),
      ),
    enabled: place.areaId !== null && Number.isFinite(grams) && grams >= 0,
  });
  return (
    <section aria-labelledby="calc-h" className={cn(cardPadded, 'gap-4 md:gap-4')}>
      <div className="flex flex-col gap-1">
        <h2 id="calc-h" className={cardTitle}>
          {t('delivery.calculator')}
        </h2>
        <p className="text-[13px] text-muted-foreground">{t('delivery.calculatorHint')}</p>
      </div>
      <PlacePicker
        row
        value={place}
        onChange={setPlace}
        withLine={false}
        trailing={
          <Field
            label={t('delivery.weightKg')}
            inputMode="decimal"
            value={kg}
            onChange={(e) => setKg(e.target.value)}
          />
        }
      />
      {quote.data && (
        <p role="status" className="rounded-[10px] bg-muted px-3.5 py-3 font-medium">
          {quote.data.zone && quote.data.fee !== null
            ? t('delivery.feeIs', {
                zone: pickText(quote.data.zone.name, locale),
                fee: formatPrice(quote.data.fee, locale),
              })
            : t('delivery.notCovered')}
        </p>
      )}
    </section>
  );
}

function ZoneDialog({
  zone,
  zones,
  geo,
  onClose,
}: {
  zone?: Zone | undefined;
  zones: Zone[];
  geo: Geo;
  onClose: () => void;
}) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const idx = geo.geoIndex();
  const [nameBn, setNameBn] = useState(zone?.name.bn ?? '');
  const [nameEn, setNameEn] = useState(zone?.name.en ?? '');
  const [fee, setFee] = useState(priceInput(zone?.fee ?? 10_000));
  const [weighted, setWeighted] = useState(zone ? zone.freeWeightGrams !== null : true);
  const [freeKg, setFreeKg] = useState(
    zone?.freeWeightGrams != null ? String(zone.freeWeightGrams / 1000) : '1',
  );
  const [perKg, setPerKg] = useState(priceInput(zone?.feePerExtraKg ?? 2_000));
  const [estBn, setEstBn] = useState(zone?.estimate.bn ?? '');
  const [estEn, setEstEn] = useState(zone?.estimate.en ?? '');
  const [fallback, setFallback] = useState(zone?.isFallback ?? false);
  const [active, setActive] = useState(zone?.active ?? true);
  const [districtIds, setDistrictIds] = useState<number[]>(zone?.districtIds ?? []);
  const [areaIds, setAreaIds] = useState<number[]>(zone?.areaIds ?? []);
  const [pickDistrict, setPickDistrict] = useState<number | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // What other zones already cover, so a place is never in two.
  const taken = new Set(
    zones
      .filter((z) => z.id !== zone?.id)
      .flatMap((z) => z.districtIds.map((d) => `d${d}`).concat(z.areaIds.map((a) => `a${a}`))),
  );
  const otherFallback = zones.some((z) => z.isFallback && z.id !== zone?.id);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: zonesQuery.queryKey });
    await queryClient.invalidateQueries({ queryKey: ['zone-quote'] });
  };
  const save = useMutation({
    mutationFn: async () => {
      const num = (s: string) =>
        Number(s.replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d))));
      const body = {
        name: {
          ...(nameBn.trim() ? { bn: nameBn.trim() } : {}),
          ...(nameEn.trim() ? { en: nameEn.trim() } : {}),
        },
        fee: readPrice(fee) as number,
        freeWeightGrams: weighted ? Math.round(num(freeKg) * 1000) : null,
        feePerExtraKg: weighted ? (readPrice(perKg) as number) : null,
        estimate: {
          ...(estBn.trim() ? { bn: estBn.trim() } : {}),
          ...(estEn.trim() ? { en: estEn.trim() } : {}),
        },
        isFallback: fallback,
        districtIds: fallback ? [] : districtIds,
        areaIds: fallback ? [] : areaIds,
        active,
        position: zone?.position ?? zones.length,
      };
      return zone
        ? unwrap(
            await api.PATCH('/v1/admin/delivery-zones/{id}', {
              params: { path: { id: zone.id } },
              body,
            }),
          )
        : unwrap(await api.POST('/v1/admin/delivery-zones', { body }));
    },
    onSuccess: async () => {
      await refresh();
      toast(t('account.saved'));
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.DELETE('/v1/admin/delivery-zones/{id}', {
          params: { path: { id: zone?.id as string } },
        }),
      ),
    onSuccess: async () => {
      await refresh();
      onClose();
    },
  });

  const submit = () => {
    const ok =
      (nameBn.trim() || nameEn.trim()) &&
      typeof readPrice(fee) === 'number' &&
      (!weighted || (typeof readPrice(perKg) === 'number' && Number.isFinite(Number(freeKg)))) &&
      (fallback || districtIds.length + areaIds.length > 0);
    if (!ok) {
      setInvalid(true);
      return;
    }
    save.mutate();
  };
  const toggle = (list: number[], set: (v: number[]) => void, id: number) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  return (
    <Sheet
      open
      onOpenChange={(v) => !v && onClose()}
      title={t(zone ? 'delivery.edit' : 'delivery.add')}
    >
      <SheetForm
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <SheetBody>
          <div className="grid gap-3 md:grid-cols-2">
            <Field
              label={t('delivery.nameBn')}
              lang="bn"
              value={nameBn}
              maxLength={60}
              onChange={(e) => setNameBn(e.target.value)}
            />
            <Field
              label={t('delivery.nameEn')}
              lang="en"
              value={nameEn}
              maxLength={60}
              onChange={(e) => setNameEn(e.target.value)}
            />
          </div>
          <Field
            label={t('delivery.fee')}
            inputMode="decimal"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
          />
          <label className="flex min-h-10 items-center gap-3 md:min-h-9">
            <input
              type="checkbox"
              checked={weighted}
              onChange={(e) => setWeighted(e.target.checked)}
            />
            {t('delivery.byWeight')}
          </label>
          {weighted && (
            <div className="grid gap-3 md:grid-cols-2">
              <Field
                label={t('delivery.freeKg')}
                inputMode="decimal"
                value={freeKg}
                onChange={(e) => setFreeKg(e.target.value)}
              />
              <Field
                label={t('delivery.perKg')}
                inputMode="decimal"
                value={perKg}
                onChange={(e) => setPerKg(e.target.value)}
              />
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <Field
              label={t('delivery.estimateBn')}
              lang="bn"
              hint={t('delivery.estimateHint')}
              value={estBn}
              maxLength={60}
              onChange={(e) => setEstBn(e.target.value)}
            />
            <Field
              label={t('delivery.estimateEn')}
              lang="en"
              value={estEn}
              maxLength={60}
              onChange={(e) => setEstEn(e.target.value)}
            />
          </div>
          <label className="flex min-h-10 items-center gap-3 md:min-h-9">
            <input
              type="checkbox"
              checked={fallback}
              disabled={otherFallback && !fallback}
              onChange={(e) => setFallback(e.target.checked)}
            />
            <span>
              {t('delivery.fallback')}
              {otherFallback && !fallback && (
                <span className="block text-sm text-muted-foreground">
                  {t('delivery.fallbackTaken')}
                </span>
              )}
            </span>
          </label>
          {!fallback && (
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 font-medium">{t('delivery.coverage')}</legend>
              <details>
                <summary className="min-h-11 cursor-pointer py-2 text-sm">
                  {t('delivery.districts', { count: districtIds.length })}
                </summary>
                <div className="flex max-h-72 flex-col gap-3 overflow-y-auto">
                  {geo.GEOGRAPHY.divisions.map((div) => (
                    <div key={div.id}>
                      <p className="text-sm font-medium">{div[locale]}</p>
                      <div className="grid grid-cols-2 gap-x-3 md:grid-cols-3">
                        {idx.districtsOf(div.id).map((d) => (
                          <label
                            key={d.id}
                            className="flex min-h-10 items-center gap-2 text-sm md:min-h-9"
                          >
                            <input
                              type="checkbox"
                              disabled={taken.has(`d${d.id}`)}
                              checked={districtIds.includes(d.id)}
                              onChange={() => toggle(districtIds, setDistrictIds, d.id)}
                            />
                            {d[locale]}
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
              <div className="flex flex-col gap-2">
                <span className="text-sm">{t('delivery.areas', { count: areaIds.length })}</span>
                <div className="flex flex-col gap-1.5 text-sm font-medium">
                  <label htmlFor="zone-district">{t('delivery.areasIn')}</label>
                  {/* 64 districts: the searchable select (design rule 3). */}
                  <Combobox
                    id="zone-district"
                    className="font-normal"
                    searchLabel={t('place.findDistrict')}
                    placeholder={t('place.choose')}
                    value={pickDistrict === null ? '' : String(pickDistrict)}
                    onChange={(v) => setPickDistrict(v ? Number(v) : null)}
                    options={[...geo.GEOGRAPHY.districts]
                      .sort((a, b) => a[locale].localeCompare(b[locale], locale))
                      .map((d) => ({
                        value: String(d.id),
                        label: d[locale],
                        keywords: `${d.bn} ${d.en}`,
                      }))}
                  />
                </div>
                {pickDistrict !== null && (
                  <div className="grid max-h-60 grid-cols-2 gap-x-3 overflow-y-auto md:grid-cols-3">
                    {idx.areasOf(pickDistrict).map((a) => (
                      <label
                        key={a.id}
                        className="flex min-h-10 items-center gap-2 text-sm md:min-h-9"
                      >
                        <input
                          type="checkbox"
                          disabled={taken.has(`a${a.id}`)}
                          checked={areaIds.includes(a.id)}
                          onChange={() => toggle(areaIds, setAreaIds, a.id)}
                        />
                        {a[locale]}
                      </label>
                    ))}
                  </div>
                )}
                {areaIds.length > 0 && (
                  <p className="text-sm text-muted-foreground">
                    {areaIds
                      .map((id) => idx.area(id)?.[locale])
                      .filter(Boolean)
                      .join(', ')}
                  </p>
                )}
              </div>
            </fieldset>
          )}
          <label className="flex min-h-10 items-center gap-3 md:min-h-9">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            {t('delivery.active')}
          </label>
          {invalid && <Notice tone="error">{t('delivery.invalid')}</Notice>}
          {(save.error ?? remove.error) && (
            <Notice tone="error">{orderErrorMessage(save.error ?? remove.error, t)}</Notice>
          )}
        </SheetBody>
        <SheetFooter
          start={
            zone && (
              <SheetDelete onClick={() => setConfirmDelete(true)}>{t('action.delete')}</SheetDelete>
            )
          }
        >
          <Button variant="secondary" size="lg" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button type="submit" size="lg" disabled={save.isPending}>
            {t('action.save')}
          </Button>
        </SheetFooter>
      </SheetForm>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('delivery.deleteTitle', { name: pickText(zone?.name, locale) })}
        confirmLabel={t('action.delete')}
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
      >
        <p>{t('delivery.deleteBody')}</p>
      </ConfirmDialog>
    </Sheet>
  );
}
