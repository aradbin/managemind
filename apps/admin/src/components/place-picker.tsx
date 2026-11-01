// Division, district and area from the list, then the street line
// (phase-4-plan §3.2): couriers need an area from the list, never typed text.
// Each is a searchable select (ADR 0033): a district has dozens of areas.
import { useQuery } from '@tanstack/react-query';
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
}: {
  value: PlaceDraft;
  onChange: (next: PlaceDraft) => void;
  disabled?: boolean;
  /** False where only the area matters (fees, the promotions test cart). */
  withLine?: boolean;
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
