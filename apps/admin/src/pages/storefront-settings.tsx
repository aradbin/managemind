// Online store > Settings (phase-3-plan §3.6–§3.10, §7): search-engine
// indexing, digits, tracking IDs, the cookie banner's text, chat buttons and
// holiday mode. Saved through PATCH /store with the rest of the settings.

import { formatPhone, normalizePhone } from '@managemind/shared/phone';
import {
  CHAT_PLACEMENTS,
  DEFAULT_CONSENT_TEXT,
  dhakaToUtc,
  GA4_ID,
  META_PIXEL_ID,
  utcToDhaka,
} from '@managemind/shared/storefront';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import type { Lang } from '../components/catalog/language-tabs';
import { Field } from '../components/field';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { type Localized, LocalizedField } from '../components/theme/localized-field';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { useLocale } from '../i18n';
import '../i18n/online-store';
import { ApiError, api, unwrap } from '../lib/api';
import { storeSettingsQuery } from '../lib/catalog';
import { saveErrorMessage } from '../lib/errors';

type Store = Awaited<ReturnType<typeof storeSettingsQuery.queryFn>>;

export function StorefrontSettingsPage() {
  const { t } = useLocale();
  const store = useQuery(storeSettingsQuery);
  return (
    <div className="max-w-2xl">
      <PageHeader title={t('storefront.title')} description={t('storefront.description')} />
      {store.isPending ? (
        <p role="status">{t('loading')}</p>
      ) : store.isError ? (
        <Notice tone="error">{saveErrorMessage(store.error, t)}</Notice>
      ) : (
        <SettingsForm store={store.data} />
      )}
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 md:p-5"
    >
      <h2 id={id} className="font-semibold">
        {title}
      </h2>
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      {children}
    </section>
  );
}

function SettingsForm({ store }: { store: Store }) {
  const { t } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canEdit = usePermission('settings.write');
  const s = store.storefront;
  const lang = store.defaultLocale as Lang;
  const selectId = useId();
  const showId = useId();

  const [indexing, setIndexing] = useState(s.indexing);
  const [numerals, setNumerals] = useState<string>(store.display.numerals ?? 'auto');
  const [pixel, setPixel] = useState(s.tracking.metaPixelId ?? '');
  const [ga4, setGa4] = useState(s.tracking.ga4Id ?? '');
  const [consent, setConsent] = useState<Localized>(s.consent.text);
  const [whatsapp, setWhatsapp] = useState(s.chat.whatsapp ? formatPhone(s.chat.whatsapp) : '');
  const [messenger, setMessenger] = useState(s.chat.messenger ?? '');
  const [greeting, setGreeting] = useState<Localized>(s.chat.greeting);
  const [show, setShow] = useState(s.chat.show);
  const [holidayOn, setHolidayOn] = useState(s.holiday !== null);
  const [start, setStart] = useState(s.holiday ? utcToDhaka(s.holiday.startsAt) : '');
  const [end, setEnd] = useState(s.holiday ? utcToDhaka(s.holiday.endsAt) : '');
  const [holidayMessage, setHolidayMessage] = useState<Localized>(s.holiday?.message ?? {});

  const errors = {
    pixel: pixel && !META_PIXEL_ID.test(pixel.trim()) ? t('storefront.pixelHint') : undefined,
    ga4: ga4 && !GA4_ID.test(ga4.trim().toUpperCase()) ? t('storefront.ga4Hint') : undefined,
    whatsapp: whatsapp && !normalizePhone(whatsapp) ? t('form.invalidPhone') : undefined,
    messenger:
      messenger && !/^[A-Za-z0-9.]{5,50}$/.test(messenger.trim()) ? t('form.invalid') : undefined,
    holiday:
      holidayOn && (!start || !end)
        ? t('form.required')
        : holidayOn && end <= start
          ? t('storefront.holidayEndBeforeStart')
          : undefined,
  };
  const valid = Object.values(errors).every((e) => !e);

  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.PATCH('/v1/admin/store', {
          body: {
            storefront: {
              indexing,
              tracking: {
                ...(pixel.trim() ? { metaPixelId: pixel.trim() } : {}),
                ...(ga4.trim() ? { ga4Id: ga4.trim().toUpperCase() } : {}),
              },
              consent: { text: consent },
              chat: {
                ...(whatsapp ? { whatsapp } : {}),
                ...(messenger.trim() ? { messenger: messenger.trim() } : {}),
                greeting,
                show,
              },
              holiday: holidayOn
                ? { startsAt: dhakaToUtc(start), endsAt: dhakaToUtc(end), message: holidayMessage }
                : null,
            },
            display: numerals === 'auto' ? {} : { numerals: numerals as 'bengali' | 'latin' },
          } as never,
        }),
      ),
    onSuccess: (saved) => {
      queryClient.setQueryData(storeSettingsQuery.queryKey, saved);
      toast(t('onlineStore.purgeNote'));
    },
  });

  return (
    <form
      className="flex flex-col gap-8"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) save.mutate();
      }}
    >
      {!canEdit && <Notice>{t('store.readOnly')}</Notice>}
      <fieldset
        disabled={!canEdit || save.isPending}
        className="flex flex-col gap-8 rounded-xl border border-border bg-background p-4 md:p-5"
      >
        <Section title={t('storefront.indexing')} hint={t('storefront.indexingHint')}>
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              className="size-5"
              checked={indexing}
              onChange={(e) => setIndexing(e.target.checked)}
            />
            {t('storefront.indexingOn')}
          </label>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={selectId} className="text-sm font-medium">
              {t('storefront.numerals')}
            </label>
            <select
              id={selectId}
              value={numerals}
              onChange={(e) => setNumerals(e.target.value)}
              className="min-h-11 rounded-lg border border-input bg-background px-3 text-base"
            >
              {(['auto', 'bengali', 'latin'] as const).map((v) => (
                <option key={v} value={v}>
                  {t(`storefront.numerals.${v}`)}
                </option>
              ))}
            </select>
          </div>
        </Section>

        <Section title={t('storefront.tracking')} hint={t('storefront.trackingHint')}>
          <Field
            label={t('storefront.pixel')}
            hint={t('storefront.pixelHint')}
            inputMode="numeric"
            maxLength={16}
            value={pixel}
            error={errors.pixel}
            onChange={(e) => setPixel(e.target.value)}
          />
          <Field
            label={t('storefront.ga4')}
            hint={t('storefront.ga4Hint')}
            maxLength={14}
            value={ga4}
            error={errors.ga4}
            onChange={(e) => setGa4(e.target.value)}
          />
        </Section>

        <Section title={t('storefront.consent')} hint={t('storefront.consentHint')}>
          <LocalizedField
            label="storefront.consentText"
            multiline
            defaultLang={lang}
            maxLength={300}
            value={consent}
            onChange={setConsent}
          />
          <p className="text-sm text-muted-foreground" lang={lang}>
            {DEFAULT_CONSENT_TEXT[lang]}
          </p>
        </Section>

        <Section title={t('storefront.chat')}>
          <Field
            label={t('storefront.whatsapp')}
            type="tel"
            inputMode="tel"
            placeholder="01712-345678"
            value={whatsapp}
            error={errors.whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
          />
          <Field
            label={t('storefront.messenger')}
            hint={t('storefront.messengerHint')}
            maxLength={50}
            value={messenger}
            error={errors.messenger}
            onChange={(e) => setMessenger(e.target.value)}
          />
          <LocalizedField
            label="storefront.greeting"
            defaultLang={lang}
            maxLength={200}
            value={greeting}
            onChange={setGreeting}
          />
          <p className="text-sm text-muted-foreground">{t('storefront.greetingHint')}</p>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={showId} className="text-sm font-medium">
              {t('storefront.chatShow')}
            </label>
            <select
              id={showId}
              value={show}
              onChange={(e) => setShow(e.target.value as typeof show)}
              className="min-h-11 rounded-lg border border-input bg-background px-3 text-base"
            >
              {CHAT_PLACEMENTS.map((v) => (
                <option key={v} value={v}>
                  {t(`storefront.chatShow.${v}`)}
                </option>
              ))}
            </select>
          </div>
        </Section>

        <Section title={t('storefront.holiday')} hint={t('storefront.holidayHint')}>
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              className="size-5"
              checked={holidayOn}
              onChange={(e) => setHolidayOn(e.target.checked)}
            />
            {t('storefront.holidayOn')}
          </label>
          {holidayOn && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label={t('storefront.holidayStart')}
                  type="datetime-local"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
                <Field
                  label={t('storefront.holidayEnd')}
                  type="datetime-local"
                  value={end}
                  error={errors.holiday}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </div>
              <LocalizedField
                label="storefront.holidayMessage"
                defaultLang={lang}
                maxLength={200}
                value={holidayMessage}
                onChange={setHolidayMessage}
              />
            </>
          )}
        </Section>
      </fieldset>
      {save.isError && (
        <Notice tone="error">
          {save.error instanceof ApiError && save.error.problem?.errors?.length
            ? save.error.problem.errors.map((e) => `${e.path}: ${e.message}`).join(' · ')
            : saveErrorMessage(save.error, t)}
        </Notice>
      )}
      {canEdit && (
        <div>
          <Button type="submit" disabled={!valid || save.isPending}>
            {t('action.save')}
          </Button>
        </div>
      )}
    </form>
  );
}
