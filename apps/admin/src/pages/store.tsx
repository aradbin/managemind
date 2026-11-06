// Store profile (phase-1-plan §7.3): name, the shoppers' default language
// and contact details. Viewers and staff see it read-only.
import { zodResolver } from '@hookform/resolvers/zod';
import { formatPhone } from '@managemind/shared/phone';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { ExportCard } from '../components/export-card';
import { fieldLabel } from '../components/field-styles';
import {
  applyServerErrors,
  Form,
  optionalEmail,
  optionalPhone,
  optionalText,
  PhoneField,
  TextField,
} from '../components/form';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { SaveBar } from '../components/save-bar';
import { useToast } from '../components/toast';
import { cardPadded, cardTitle } from '../components/ui/card';
import { ChoiceChips } from '../components/ui/segmented';
import { useLocale } from '../i18n';
import '../i18n/online-store';
import { api, meQuery, unwrap } from '../lib/api';
import { saveErrorMessage } from '../lib/errors';
import { cn } from '../lib/utils';

const schema = z
  .object({
    name: z.string().trim().min(1).max(100),
    defaultLocale: z.enum(['bn', 'en']),
    contactEmail: optionalEmail(),
    contactPhone: optionalPhone(),
    line1: optionalText(200),
    line2: optionalText(200),
    city: optionalText(100),
    businessName: optionalText(200),
    tradeLicense: optionalText(50),
    dbid: optionalText(50),
    bin: optionalText(20),
  })
  .superRefine((v, ctx) => {
    // The address needs its first line before the rest means anything.
    if (!v.line1 && (v.line2 || v.city)) {
      ctx.addIssue({ code: 'custom', path: ['line1'], message: 'form.required' });
    }
  });
type Input = z.input<typeof schema>;
const FIELDS: Record<keyof Input, true> = {
  name: true,
  defaultLocale: true,
  contactEmail: true,
  contactPhone: true,
  line1: true,
  line2: true,
  city: true,
  businessName: true,
  tradeLicense: true,
  dbid: true,
  bin: true,
};
type Output = z.output<typeof schema>;

const storeQuery = {
  queryKey: ['store'] as const,
  queryFn: async () => unwrap(await api.GET('/v1/admin/store')),
};

export function StoreProfilePage() {
  const { t } = useLocale();
  const store = useQuery(storeQuery);
  const { data: me } = useQuery(meQuery);
  // Only an owner exports, and not through a support grant.
  const isOwner =
    !me?.supportGrantId && me?.stores.find((s) => s.tenantId === me.activeStore)?.role === 'owner';
  return (
    <>
      <PageHeader
        className="mb-0"
        parent={{ to: '/settings', label: t('settings.title') }}
        title={t('settings.store')}
        description={t('settings.store.description')}
      />
      {store.isPending ? (
        <p role="status">{t('loading')}</p>
      ) : store.isError ? (
        <Notice tone="error">{saveErrorMessage(store.error, t)}</Notice>
      ) : (
        <ProfileForm store={store.data} />
      )}
      {isOwner && <ExportCard />}
    </>
  );
}

type Store = Awaited<ReturnType<typeof storeQuery.queryFn>>;

function ProfileForm({ store }: { store: Store }) {
  const { t } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canEdit = usePermission('settings.write');
  const { profile } = store;
  const form = useForm<Input, unknown, Output>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: store.name,
      defaultLocale: store.defaultLocale,
      contactEmail: profile.contactEmail ?? '',
      contactPhone: profile.contactPhone ? formatPhone(profile.contactPhone) : '',
      line1: profile.address?.line1 ?? '',
      line2: profile.address?.line2 ?? '',
      city: profile.address?.city ?? '',
      businessName: profile.businessName ?? '',
      tradeLicense: profile.tradeLicense ?? '',
      dbid: profile.dbid ?? '',
      bin: profile.bin ?? '',
    },
  });
  const save = useMutation({
    mutationFn: async (v: Output) =>
      unwrap(
        await api.PATCH('/v1/admin/store', {
          body: {
            name: v.name,
            defaultLocale: v.defaultLocale,
            profile: {
              ...(v.contactEmail ? { contactEmail: v.contactEmail } : {}),
              ...(v.contactPhone ? { contactPhone: v.contactPhone } : {}),
              ...(v.line1
                ? {
                    address: {
                      line1: v.line1,
                      ...(v.line2 ? { line2: v.line2 } : {}),
                      ...(v.city ? { city: v.city } : {}),
                    },
                  }
                : {}),
              ...(v.businessName ? { businessName: v.businessName } : {}),
              ...(v.tradeLicense ? { tradeLicense: v.tradeLicense } : {}),
              ...(v.dbid ? { dbid: v.dbid } : {}),
              ...(v.bin ? { bin: v.bin } : {}),
            },
          },
        }),
      ),
    onSuccess: async (saved) => {
      queryClient.setQueryData(storeQuery.queryKey, saved);
      await queryClient.invalidateQueries({ queryKey: meQuery.queryKey });
      form.reset(form.getValues());
      toast(t('account.saved'));
    },
    onError: (e) =>
      applyServerErrors(form, e, (path) => {
        const field = path.replace(/^profile\.(address\.)?/, '');
        return field in FIELDS ? (field as keyof Input) : undefined;
      }),
  });

  return (
    <Form form={form} onSubmit={(v) => save.mutate(v)} className="flex flex-col gap-3 md:gap-4">
      {!canEdit && <Notice>{t('store.readOnly')}</Notice>}
      <fieldset disabled={!canEdit || save.isPending} className="contents">
        <section aria-labelledby="store-contact" className={cn(cardPadded, 'gap-4 md:gap-4')}>
          <h2 id="store-contact" className={cardTitle}>
            {t('store.nameAndContact')}
          </h2>
          <TextField name="name" label={t('store.name')} maxLength={100} />
          <Controller
            control={form.control}
            name="defaultLocale"
            render={({ field }) => (
              <div className="flex flex-col">
                <span className={fieldLabel}>{t('store.defaultLocale')}</span>
                <ChoiceChips
                  label={t('store.defaultLocale')}
                  value={field.value}
                  options={[
                    { value: 'bn', label: 'বাংলা (Bangla)' },
                    { value: 'en', label: 'English' },
                  ]}
                  onChange={field.onChange}
                />
              </div>
            )}
          />
          <div role="presentation" className="-mx-4 h-px bg-border md:-mx-5" />
          <p className={cn(fieldLabel, 'mb-0')}>{t('store.contact')}</p>
          <div className="grid gap-3 md:grid-cols-2 md:gap-x-4">
            <TextField
              name="contactEmail"
              label={t('store.contactEmail')}
              type="email"
              inputMode="email"
              autoComplete="email"
            />
            <PhoneField name="contactPhone" label={t('store.contactPhone')} />
          </div>
          <TextField name="line1" label={t('store.addressLine1')} autoComplete="address-line1" />
          <div className="grid gap-3 md:grid-cols-2 md:gap-x-4">
            <TextField
              name="line2"
              label={t('store.addressLine2')}
              autoComplete="address-line2"
              optional
            />
            <TextField name="city" label={t('store.city')} autoComplete="address-level2" />
          </div>
        </section>
        <section aria-labelledby="store-business" className={cn(cardPadded, 'gap-4 md:gap-4')}>
          <div className="flex flex-col gap-1">
            <h2 id="store-business" className={cardTitle}>
              {t('business.title')}
            </h2>
            <p className="text-[13px] text-muted-foreground">{t('business.hint')}</p>
          </div>
          <TextField name="businessName" label={t('business.name')} maxLength={200} />
          <div className="grid gap-3 md:grid-cols-2 md:gap-x-4">
            <TextField name="tradeLicense" label={t('business.tradeLicense')} maxLength={50} />
            <TextField name="dbid" label={t('business.dbid')} maxLength={50} />
          </div>
          <TextField
            name="bin"
            label={t('business.bin')}
            hint={t('business.binHint')}
            maxLength={20}
            inputMode="numeric"
          />
        </section>
      </fieldset>
      {save.isError && <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>}
      <SaveBar
        show={canEdit && form.formState.isDirty}
        message={t('form.unsaved')}
        discardLabel={t('action.discard')}
        onDiscard={() => form.reset()}
        saveLabel={t('action.save')}
        busy={save.isPending}
        onSave={() => void form.handleSubmit((v) => save.mutate(v))()}
      />
    </Form>
  );
}
