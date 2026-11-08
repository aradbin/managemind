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
import { fieldHint, fieldLabel } from '../components/field-styles';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { PhoneRecordHeader } from '../components/record-header';
import { SaveBar } from '../components/save-bar';
import { type Localized, LocalizedField } from '../components/theme/localized-field';
import { useToast } from '../components/toast';
import { cardPadded, cardTitle } from '../components/ui/card';
import { RadioCard } from '../components/ui/choice';
import { SwitchRow } from '../components/ui/switch';
import { useLocale } from '../i18n';
import '../i18n/online-store';
import { DateField } from '../components/date-field';
import { ApiError, api, unwrap } from '../lib/api';
import { storeSettingsQuery } from '../lib/catalog';
import { useRecordPage } from '../lib/crumb';
import { saveErrorMessage } from '../lib/errors';
import { cn } from '../lib/utils';

type Store = Awaited<ReturnType<typeof storeSettingsQuery.queryFn>>;

export function StorefrontSettingsPage() {
  const { t } = useLocale();
  const store = useQuery(storeSettingsQuery);
  useRecordPage(t('storefront.title'));
  return (
    <div className="flex w-full max-w-[860px] flex-col gap-3 md:gap-4">
      <PhoneRecordHeader
        to="/online-store"
        backLabel={t('theme.back')}
        title={t('storefront.title')}
      />
      <PageHeader
        className="mb-0 max-md:hidden"
        parent={{ to: '/online-store', label: t('onlineStore.title') }}
        title={t('storefront.title')}
        description={t('storefront.description')}
      />
      <p className="text-[13px] text-muted-foreground md:hidden">{t('storefront.description')}</p>
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
    <section aria-labelledby={id} className={cn(cardPadded, 'gap-4 md:gap-4')}>
      <div className="flex flex-col gap-1">
        <h2 id={id} className={cardTitle}>
          {title}
        </h2>
        {hint && <p className="text-[13px] text-muted-foreground">{hint}</p>}
      </div>
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

  const current = JSON.stringify({
    indexing,
    numerals,
    pixel,
    ga4,
    consent,
    whatsapp,
    messenger,
    greeting,
    show,
    holidayOn,
    start,
    end,
    holidayMessage,
  });
  // What was loaded or last saved: the save bar shows once something differs.
  const [snapshot, setSnapshot] = useState(current);
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
      setSnapshot(current);
      toast(t('onlineStore.purgeNote'));
    },
  });

  const discard = () => {
    setIndexing(s.indexing);
    setNumerals(store.display.numerals ?? 'auto');
    setPixel(s.tracking.metaPixelId ?? '');
    setGa4(s.tracking.ga4Id ?? '');
    setConsent(s.consent.text);
    setWhatsapp(s.chat.whatsapp ? formatPhone(s.chat.whatsapp) : '');
    setMessenger(s.chat.messenger ?? '');
    setGreeting(s.chat.greeting);
    setShow(s.chat.show);
    setHolidayOn(s.holiday !== null);
    setStart(s.holiday ? utcToDhaka(s.holiday.startsAt) : '');
    setEnd(s.holiday ? utcToDhaka(s.holiday.endsAt) : '');
    setHolidayMessage(s.holiday?.message ?? {});
    save.reset();
  };
  return (
    <form
      className="flex flex-col gap-3 md:gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) save.mutate();
      }}
    >
      {!canEdit && <Notice>{t('store.readOnly')}</Notice>}
      <fieldset
        disabled={!canEdit || save.isPending}
        className="m-0 flex flex-col gap-3 border-0 p-0 md:gap-4"
      >
        <Section title={t('storefront.indexing')}>
          <SwitchRow
            label={t('storefront.indexingOn')}
            hint={t('storefront.indexingHint')}
            checked={indexing}
            onCheckedChange={setIndexing}
          />
        </Section>

        <Section title={t('storefront.numerals')}>
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="sr-only">{t('storefront.numerals')}</legend>
            {(['auto', 'bengali', 'latin'] as const).map((v) => (
              <RadioCard
                key={v}
                name="numerals"
                checked={numerals === v}
                onChange={() => setNumerals(v)}
                label={t(`storefront.numerals.${v}`)}
              />
            ))}
          </fieldset>
        </Section>

        <Section title={t('storefront.tracking')} hint={t('storefront.trackingHint')}>
          <div className="grid gap-3 md:grid-cols-2 md:gap-x-4">
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
          </div>
          <div className="flex flex-col gap-1.5">
            <LocalizedField
              label="storefront.consentText"
              multiline
              defaultLang={lang}
              maxLength={300}
              value={consent}
              onChange={setConsent}
            />
            <p className={fieldHint}>
              {t('storefront.consentHint')} <span lang={lang}>“{DEFAULT_CONSENT_TEXT[lang]}”</span>
            </p>
          </div>
        </Section>

        <Section title={t('storefront.chat')}>
          <div className="grid gap-3 md:grid-cols-2 md:gap-x-4">
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
          </div>
          <div className="flex flex-col gap-1.5">
            <LocalizedField
              label="storefront.greeting"
              defaultLang={lang}
              maxLength={200}
              value={greeting}
              onChange={setGreeting}
            />
            <p className={fieldHint}>{t('storefront.greetingHint')}</p>
          </div>
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className={fieldLabel}>{t('storefront.chatShow')}</legend>
            {CHAT_PLACEMENTS.map((v) => (
              <RadioCard
                key={v}
                name="chat-show"
                checked={show === v}
                onChange={() => setShow(v)}
                label={t(`storefront.chatShow.${v}`)}
              />
            ))}
          </fieldset>
        </Section>

        <Section title={t('storefront.holiday')} hint={t('storefront.holidayHint')}>
          <SwitchRow
            label={t('storefront.holidayOn')}
            checked={holidayOn}
            onCheckedChange={setHolidayOn}
          />
          {holidayOn && (
            <>
              <div className="grid gap-3 md:grid-cols-2 md:gap-x-4">
                <DateField
                  time
                  label={t('storefront.holidayStart')}
                  value={start}
                  onChange={setStart}
                />
                <DateField
                  time
                  label={t('storefront.holidayEnd')}
                  value={end}
                  error={errors.holiday}
                  onChange={setEnd}
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
      <SaveBar
        show={canEdit && current !== snapshot}
        message={t('form.unsaved')}
        discardLabel={t('action.discard')}
        onDiscard={discard}
        saveLabel={t('action.save')}
        busy={save.isPending}
        saveDisabled={!valid}
        onSave={() => save.mutate()}
      />
    </form>
  );
}
