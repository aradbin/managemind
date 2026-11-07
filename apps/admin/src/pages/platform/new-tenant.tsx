// Platform: a new store (phase-5b-plan §3.2, §7). The store, its owner, its
// plan and its starting design, as four steps in one card (ADR 0034). The address is checked as it is typed. Defaults (delivery zones,
// legal drafts, the return policy) come with it on the server.

import { zodResolver } from '@hookform/resolvers/zod';
import { SLUG_PATTERN } from '@managemind/shared/slug';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { type FieldPath, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { fieldHint, fieldLabel } from '../../components/field-styles';
import { Form, TextField } from '../../components/form';
import { Notice } from '../../components/notice';
import { PageHeader, PlatformBadge } from '../../components/page-header';
import { PhoneRecordHeader } from '../../components/record-header';
import { useToast } from '../../components/toast';
import { Button } from '../../components/ui/button';
import { cardPadded, cardTitle } from '../../components/ui/card';
import { RadioCard } from '../../components/ui/choice';
import { ChoiceChips } from '../../components/ui/segmented';
import { useLocale } from '../../i18n';
import '../../i18n/launch';
import { ApiError, api, unwrap } from '../../lib/api';
import { formatPrice, readPrice } from '../../lib/catalog';
import { useRecordPage } from '../../lib/crumb';
import { saveErrorMessage } from '../../lib/errors';
import { cn } from '../../lib/utils';
import { KV } from './tenant-launch';

const price = z
  .string()
  .trim()
  .refine((v) => readPrice(v) !== undefined, 'form.invalid');

const schema = z.object({
  name: z.string().trim().min(1).max(100),
  slug: z.string().trim().toLowerCase().regex(SLUG_PATTERN, 'tenants.slugInvalid'),
  defaultLocale: z.enum(['bn', 'en']),
  kind: z.enum(['client', 'demo', 'test']),
  ownerEmail: z.string().trim().toLowerCase().max(254).pipe(z.email('form.invalidEmail')),
  ownerName: z.string().trim().min(1).max(100),
  planId: z.string(),
  price,
  setupFee: price,
  billingDay: z.coerce.number().int().min(1).max(28),
  trialEndsOn: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/),
  preset: z.enum(['fashion', 'grocery', 'general']),
});
type Input = z.input<typeof schema>;
type Output = z.output<typeof schema>;

const STEPS: {
  title: 'newStore.store' | 'newStore.owner' | 'newStore.plan' | 'newStore.look';
  fields: FieldPath<Input>[];
}[] = [
  { title: 'newStore.store', fields: ['name', 'slug', 'defaultLocale', 'kind'] },
  { title: 'newStore.owner', fields: ['ownerEmail', 'ownerName'] },
  { title: 'newStore.plan', fields: ['planId', 'price', 'setupFee', 'billingDay', 'trialEndsOn'] },
  { title: 'newStore.look', fields: ['preset'] },
];

const plansQuery = {
  queryKey: ['platform', 'plans'] as const,
  queryFn: async () => unwrap(await api.GET('/v1/platform/plans')),
};

/** The address's availability, asked once the typing pauses. */
function useSlugCheck(slug: string) {
  const [settled, setSettled] = useState(slug);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(slug), 400);
    return () => clearTimeout(timer);
  }, [slug]);
  const valid = SLUG_PATTERN.test(settled);
  return useQuery({
    queryKey: ['platform', 'slug-check', settled],
    enabled: valid,
    staleTime: 10_000,
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/platform/tenants/slug-check', { params: { query: { slug: settled } } }),
      ),
  });
}

export function NewTenantPage() {
  const { t, locale } = useLocale();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const plans = useQuery(plansQuery);
  const [step, setStep] = useState(0);
  useRecordPage(t('newStore.title'));
  const form = useForm<Input, unknown, Output>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      slug: '',
      defaultLocale: 'bn',
      kind: 'client',
      ownerEmail: '',
      ownerName: '',
      planId: '',
      price: '',
      setupFee: '',
      billingDay: String(Math.min(new Date().getDate(), 28)),
      trialEndsOn: '',
      preset: 'general',
    },
  });
  const slug = (useWatch({ control: form.control, name: 'slug' }) ?? '').trim().toLowerCase();
  const planId = useWatch({ control: form.control, name: 'planId' });
  const plan = plans.data?.find((p) => p.id === planId);
  const check = useSlugCheck(slug);
  useEffect(() => {
    if (check.data && !check.data.available && check.data.reason !== 'invalid') {
      form.setError('slug', {
        message:
          check.data.reason === 'slug_reserved' ? 'tenants.slugReserved' : 'tenants.slugTaken',
      });
    } else if (check.data?.available) {
      form.clearErrors('slug');
    }
  }, [check.data, form]);

  const create = useMutation({
    mutationFn: async (v: Output) => {
      const priceOverride = readPrice(v.price) ?? null;
      const setupFeeOverride = readPrice(v.setupFee) ?? null;
      return unwrap(
        await api.POST('/v1/platform/tenants', {
          body: {
            slug: v.slug,
            name: v.name,
            defaultLocale: v.defaultLocale,
            kind: v.kind,
            preset: v.preset,
            owner: { email: v.ownerEmail, name: v.ownerName },
            ...(v.planId
              ? {
                  subscription: {
                    planId: v.planId,
                    billingDay: v.billingDay,
                    priceOverride,
                    setupFeeOverride,
                    trialEndsOn: v.trialEndsOn || null,
                  },
                }
              : {}),
          },
        }),
      );
    },
    onSuccess: async (created, v) => {
      toast(t('newStore.created', { name: v.name, email: v.ownerEmail }));
      await queryClient.invalidateQueries({ queryKey: ['platform', 'tenants'] });
      await navigate({ to: '/platform/tenants/$id', params: { id: created.id } });
    },
    onError: (e) => {
      const code = e instanceof ApiError ? e.problem?.code : undefined;
      if (code === 'slug_taken' || code === 'slug_reserved') {
        form.setError('slug', {
          message: code === 'slug_taken' ? 'tenants.slugTaken' : 'tenants.slugReserved',
        });
        setStep(0);
      }
    },
  });

  async function next() {
    if (await form.trigger(STEPS[step]?.fields ?? []))
      setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }
  const last = step === STEPS.length - 1;
  const v = useWatch({ control: form.control });
  const set = (name: 'defaultLocale' | 'kind' | 'planId' | 'preset', value: string) =>
    form.setValue(name, value as never, { shouldDirty: true });
  // The store domain, once the address check has named it ("nakshi.managemind.app").
  const [domain, setDomain] = useState<string>();
  useEffect(() => {
    const host = check.data?.host;
    if (host?.includes('.')) setDomain(host.slice(host.indexOf('.')));
  }, [check.data?.host]);
  const title = (i: number) => t(STEPS[i]?.title ?? 'newStore.store');
  return (
    <div className="flex w-full max-w-[640px] flex-col gap-3 md:gap-4">
      <PhoneRecordHeader to="/platform" backLabel={t('tenant.back')} title={t('newStore.title')}>
        <span className="mr-2">
          <PlatformBadge />
        </span>
      </PhoneRecordHeader>
      <PageHeader
        className="mb-0 max-md:hidden"
        parent={{ to: '/platform', label: t('tenant.back') }}
        title={t('newStore.title')}
        description={t('newStore.intro')}
      />
      <p className="text-[13px] text-muted-foreground md:hidden">{t('newStore.intro')}</p>
      <Form form={form} onSubmit={(values) => create.mutate(values)}>
        <section
          aria-labelledby="new-store-step"
          className={cn(cardPadded, 'gap-[18px] md:gap-[18px]')}
        >
          <ol aria-label={t('newStore.steps')} className="flex items-center">
            {STEPS.map((s, i) => (
              <li
                key={s.title}
                aria-current={i === step ? 'step' : undefined}
                className={cn(
                  'flex min-w-0 flex-1 items-center gap-2 text-[13px] text-muted-foreground last:flex-none',
                  i < step && 'text-foreground',
                  i === step && 'font-medium text-foreground',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-background text-[11px] font-semibold',
                    i < step && 'border-primary bg-primary text-primary-foreground',
                    i === step &&
                      'border-primary shadow-[0_0_0_3px_color-mix(in_oklch,var(--color-primary)_15%,transparent)]',
                  )}
                >
                  {i + 1}
                </span>
                <span className="truncate max-md:sr-only">{t(s.title)}</span>
                {i < STEPS.length - 1 && (
                  <span aria-hidden className="mx-2 h-px min-w-2 flex-1 bg-border" />
                )}
              </li>
            ))}
          </ol>
          <h2 id="new-store-step" aria-live="polite" className={cardTitle}>
            {t('newStore.stepOf', { n: step + 1, total: STEPS.length })}: {title(step)}
          </h2>
          {step === 0 && (
            <>
              <TextField name="name" label={t('store.name')} maxLength={100} />
              <TextField
                name="slug"
                label={t('tenants.slug')}
                placeholder="sonarbangla"
                after={domain}
                hint={
                  check.isFetching
                    ? t('newStore.slugChecking')
                    : check.data?.available
                      ? t('newStore.slugFree', { host: check.data.host ?? slug })
                      : t('tenants.slugHint')
                }
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                maxLength={32}
              />
              <div className="flex flex-col">
                <span className={fieldLabel}>{t('store.defaultLocale')}</span>
                <ChoiceChips
                  label={t('store.defaultLocale')}
                  value={v.defaultLocale ?? 'bn'}
                  options={[
                    { value: 'bn', label: 'বাংলা' },
                    { value: 'en', label: 'English' },
                  ]}
                  onChange={(x) => set('defaultLocale', x)}
                />
              </div>
              <Choices
                label={t('newStore.kind')}
                hint={t('newStore.kindHint')}
                name="kind"
                value={v.kind ?? 'client'}
                options={(['client', 'demo', 'test'] as const).map((k) => ({
                  value: k,
                  label: t(`kind.${k}`),
                }))}
                onChange={(x) => set('kind', x)}
              />
            </>
          )}
          {step === 1 && (
            <>
              <p className="text-muted-foreground">{t('newStore.ownerIntro')}</p>
              <TextField
                name="ownerEmail"
                label={t('tenants.ownerEmail')}
                type="email"
                inputMode="email"
                autoComplete="off"
              />
              <TextField
                name="ownerName"
                label={t('tenants.ownerName')}
                maxLength={100}
                autoComplete="off"
              />
            </>
          )}
          {step === 2 && (
            <>
              <Choices
                label={t('subscription.plan')}
                name="planId"
                value={v.planId ?? ''}
                options={[
                  { value: '', label: t('newStore.planNone') },
                  ...(plans.data ?? [])
                    .filter((p) => p.offered || p.id === planId)
                    .map((p) => ({
                      value: p.id,
                      label: p.name[locale],
                      hint: t('newStore.planPrice', {
                        price: formatPrice(p.monthlyPrice, locale),
                      }),
                    })),
                ]}
                onChange={(x) => set('planId', x)}
              />
              {plan && (
                <>
                  <div className="grid gap-x-4 gap-y-3 md:grid-cols-2">
                    <TextField
                      name="price"
                      label={t('newStore.price')}
                      hint={t('newStore.priceHint', {
                        price: formatPrice(plan.monthlyPrice, locale),
                      })}
                      inputMode="decimal"
                      before="৳"
                      optional
                    />
                    <TextField
                      name="setupFee"
                      label={t('newStore.setupFee')}
                      hint={t('newStore.setupFeeHint', {
                        price: formatPrice(plan.setupFee, locale),
                      })}
                      inputMode="decimal"
                      before="৳"
                      optional
                    />
                  </div>
                  <div className="grid gap-x-4 gap-y-3 md:grid-cols-2">
                    <TextField
                      name="billingDay"
                      label={t('newStore.billingDay')}
                      hint={t('newStore.billingDayHint')}
                      type="number"
                      min={1}
                      max={28}
                      inputMode="numeric"
                    />
                    <TextField
                      name="trialEndsOn"
                      label={t('newStore.trialEnds')}
                      hint={t('newStore.trialHint')}
                      type="date"
                      optional
                    />
                  </div>
                </>
              )}
            </>
          )}
          {step === 3 && (
            <>
              <Choices
                label={t('newStore.preset')}
                hint={t('newStore.presetHint')}
                name="preset"
                value={v.preset ?? 'general'}
                options={(['general', 'fashion', 'grocery'] as const).map((p) => ({
                  value: p,
                  label: t(`preset.${p}`),
                }))}
                onChange={(x) => set('preset', x)}
              />
              <dl className="flex flex-col gap-2.5 rounded-[10px] bg-muted px-4 py-3.5">
                <KV k={t('newStore.store')}>{v.name?.trim() || '—'}</KV>
                <KV k={t('newStore.address')}>
                  <span lang="en">{check.data?.host ?? (slug || '—')}</span>
                </KV>
                <KV k={t('newStore.owner')}>
                  {v.ownerName?.trim()
                    ? `${v.ownerName.trim()} · ${v.ownerEmail?.trim() ?? ''}`
                    : '—'}
                </KV>
                <KV k={t('newStore.plan')}>{plan ? plan.name[locale] : t('newStore.noPlan')}</KV>
              </dl>
            </>
          )}
          {create.isError &&
            !(
              create.error instanceof ApiError &&
              ['slug_taken', 'slug_reserved'].includes(create.error.problem?.code ?? '')
            ) && <Notice tone="error">{saveErrorMessage(create.error, t)}</Notice>}
          <div className="flex items-center gap-2 pt-1">
            {step > 0 && (
              <Button variant="secondary" onClick={() => setStep((s) => s - 1)}>
                <ChevronLeft aria-hidden />
                {t('newStore.back')}
              </Button>
            )}
            <span className="flex-1" />
            {/* Separate keys: a click on Next must not become the submit once the step changes. */}
            {last ? (
              <Button key="create" type="submit" disabled={create.isPending}>
                {t('newStore.create')}
              </Button>
            ) : (
              <Button key="next" onClick={() => void next()}>
                {t('newStore.next')}
                <ChevronRight aria-hidden />
              </Button>
            )}
          </div>
        </section>
      </Form>
    </div>
  );
}

/** One of a few choices as radio cards (.mm-mode), with its label above. */
function Choices<V extends string>({
  label,
  hint,
  name,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: string;
  name: string;
  value: V;
  options: { value: V; label: string; hint?: string }[];
  onChange: (value: V) => void;
}) {
  const id = useId();
  return (
    <div role="radiogroup" aria-labelledby={id} className="flex flex-col">
      <p id={id} className={fieldLabel}>
        {label}
      </p>
      <div className="flex flex-col gap-1.5">
        {options.map((o) => (
          <RadioCard
            key={o.value}
            name={name}
            checked={o.value === value}
            onChange={() => onChange(o.value)}
            label={o.label}
            hint={o.hint}
          />
        ))}
      </div>
      {hint && <p className={cn(fieldHint, 'mt-1.5')}>{hint}</p>}
    </div>
  );
}
