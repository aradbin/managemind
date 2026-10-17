// Division, district and area from the list, then the street line
// (phase-4-plan §3.2): couriers need an area from the list, never typed text.
import { useQuery } from '@tanstack/react-query';
import { useId } from 'react';
import { useLocale } from '../i18n';
import { geoQuery } from '../lib/orders';
import { Field } from './field';

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

const selectClass =
  'min-h-11 w-full rounded-md border border-border bg-background px-3 text-base disabled:opacity-50';

export function PlacePicker({
  value,
  onChange,
  disabled,
}: {
  value: PlaceDraft;
  onChange: (next: PlaceDraft) => void;
  disabled?: boolean;
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
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-division`} className="text-sm font-medium">
            {t('place.division')}
          </label>
          <select
            id={`${id}-division`}
            className={selectClass}
            disabled={disabled}
            value={value.divisionId ?? ''}
            onChange={(e) =>
              onChange({
                ...value,
                divisionId: num(e.target.value),
                districtId: null,
                areaId: null,
              })
            }
          >
            <option value="">{t('place.choose')}</option>
            {byName(g.GEOGRAPHY.divisions).map((d) => (
              <option key={d.id} value={d.id}>
                {name(d)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-district`} className="text-sm font-medium">
            {t('place.district')}
          </label>
          <select
            id={`${id}-district`}
            className={selectClass}
            disabled={disabled || !value.divisionId}
            value={value.districtId ?? ''}
            onChange={(e) => onChange({ ...value, districtId: num(e.target.value), areaId: null })}
          >
            <option value="">{t('place.choose')}</option>
            {byName(districts).map((d) => (
              <option key={d.id} value={d.id}>
                {name(d)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-area`} className="text-sm font-medium">
            {t('place.area')}
          </label>
          <select
            id={`${id}-area`}
            className={selectClass}
            disabled={disabled || !value.districtId}
            value={value.areaId ?? ''}
            onChange={(e) => onChange({ ...value, areaId: num(e.target.value) })}
          >
            <option value="">{t('place.choose')}</option>
            {byName(areas).map((a) => (
              <option key={a.id} value={a.id}>
                {name(a)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <Field
        label={t('place.line')}
        hint={t('place.lineHint')}
        value={value.line}
        maxLength={250}
        disabled={disabled}
        onChange={(e) => onChange({ ...value, line: e.target.value })}
      />
    </div>
  );
}
