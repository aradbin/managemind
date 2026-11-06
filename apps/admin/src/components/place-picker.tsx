// Division, district and area from the list, then the street line
// (phase-4-plan §3.2): couriers need an area from the list, never typed text.
// Each is a searchable select (ADR 0033): a district has dozens of areas.

import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useId } from 'react';
import { useLocale } from '../i18n';
import { geoQuery } from '../lib/orders';
import { Field } from './field';
import { Combobox } from './ui/combobox';

export interface PlaceDraft {
  divisionId: number | null;
  districtId: number | null;
  areaId: number | null;
  line: string;
}

export const emptyPlace = (): PlaceDraft => ({
  divisionId: null,
  districtId: null,
  areaId: null,
  line: '',
});

export const placeReady = (p: PlaceDraft) =>
  p.divisionId !== null && p.districtId !== null && p.areaId !== null && p.line.trim() !== '';

export function PlacePicker({
  value,
  onChange,
  disabled,
  withLine = true,
  row = false,
  trailing,
}: {
  value: PlaceDraft;
  onChange: (next: PlaceDraft) => void;
  disabled?: boolean;
  /** False where only the area matters (fees, the promotions test cart). */
  withLine?: boolean;
  /**
   * District, area and street in one row, as the new order board draws it:
   * the district names its division, so there is no division to choose.
   */
  row?: boolean;
  /** In a row without the street, what takes its place (the fee calculator's weight). */
  trailing?: ReactNode;
}) {
  const { t, locale } = useLocale();
  const id = useId();
  const geo = useQuery(geoQuery);
  if (geo.isPending) return <p role="status">{t('loading')}</p>;
  if (!geo.data) return null;
  const g = geo.data;
  const name = (x: { bn: string; en: string }) => x[locale];
  const byName = <T extends { bn: string; en: string }>(list: T[]) =>
    [...list].sort((a, b) => name(a).localeCompare(name(b), locale));
  const districts = value.divisionId ? g.geoIndex().districtsOf(value.divisionId) : [];
  const areas = value.districtId ? g.geoIndex().areasOf(value.districtId) : [];
  const num = (v: string) => (v ? Number(v) : null);
  /** Each place by its name here, findable by its name in the other language too. */
  const choices = <T extends { id: number; bn: string; en: string }>(list: T[]) =>
    byName(list).map((x) => ({
      value: String(x.id),
      label: name(x),
      keywords: x[locale === 'bn' ? 'en' : 'bn'],
    }));
  if (row) {
    const allDistricts = choices(g.GEOGRAPHY.districts);
    return (
      <div className="grid gap-3 md:grid-cols-[140px_minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="flex flex-col gap-2">
          <label htmlFor={`${id}-district`} className="text-sm leading-none font-medium">
            {t('place.district')}
          </label>
          <Combobox
            id={`${id}-district`}
            searchLabel={t('place.findDistrict')}
            placeholder={t('place.choose')}
            disabled={disabled}
            value={value.districtId ? String(value.districtId) : ''}
            options={allDistricts}
            onChange={(v) => {
              const districtId = num(v);
              const divisionId = districtId
                ? (g.geoIndex().district(districtId)?.divisionId ?? null)
                : null;
              onChange({ ...value, divisionId, districtId, areaId: null });
            }}
          />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor={`${id}-area`} className="text-sm leading-none font-medium">
            {t('place.areaShort')}
          </label>
          <Combobox
            id={`${id}-area`}
            searchLabel={t('place.findArea')}
            placeholder={t('place.areaExample')}
            disabled={disabled || !value.districtId}
            value={value.areaId ? String(value.areaId) : ''}
            options={choices(areas)}
            onChange={(v) => onChange({ ...value, areaId: num(v) })}
          />
        </div>
        {!withLine && trailing}
        {withLine && (
          <Field
            label={t('place.street')}
            placeholder={t('place.streetExample')}
            value={value.line}
            maxLength={250}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, line: e.target.value })}
          />
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-division`} className="text-sm font-medium">
            {t('place.division')}
          </label>
          <Combobox
            id={`${id}-division`}
            searchLabel={t('place.findDivision')}
            placeholder={t('place.choose')}
            disabled={disabled}
            value={value.divisionId ? String(value.divisionId) : ''}
            options={choices(g.GEOGRAPHY.divisions)}
            onChange={(v) =>
              onChange({ ...value, divisionId: num(v), districtId: null, areaId: null })
            }
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-district`} className="text-sm font-medium">
            {t('place.district')}
          </label>
          <Combobox
            id={`${id}-district`}
            searchLabel={t('place.findDistrict')}
            placeholder={t('place.choose')}
            disabled={disabled || !value.divisionId}
            value={value.districtId ? String(value.districtId) : ''}
            options={choices(districts)}
            onChange={(v) => onChange({ ...value, districtId: num(v), areaId: null })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-area`} className="text-sm font-medium">
            {t('place.area')}
          </label>
          <Combobox
            id={`${id}-area`}
            searchLabel={t('place.findArea')}
            placeholder={t('place.choose')}
            disabled={disabled || !value.districtId}
            value={value.areaId ? String(value.areaId) : ''}
            options={choices(areas)}
            onChange={(v) => onChange({ ...value, areaId: num(v) })}
          />
        </div>
      </div>
      {withLine && (
        <Field
          label={t('place.line')}
          hint={t('place.lineHint')}
          value={value.line}
          maxLength={250}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, line: e.target.value })}
        />
      )}
    </div>
  );
}
