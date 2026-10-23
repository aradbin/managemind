// Platform: a new store (phase-5b-plan §3.2, §7). The store, its owner, its
// plan and its starting design on one page on a desktop, and as steps on a
// phone. The address is checked as it is typed. Defaults (delivery zones,
// legal drafts, the return policy) come with it on the server.
import { zodResolver } from '@hookform/resolvers/zod';
import { SLUG_PATTERN } from '@managemind/shared/slug';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type FieldPath, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { Form, SelectField, TextField } from '../../components/form';
import { Notice } from '../../components/notice';
import { PageHeader } from '../../components/page-header';
import { useToast } from '../../components/toast';
import { Button } from '../../components/ui/button';
import { useLocale } from '../../i18n';
import '../../i18n/launch';
import { ApiError, api, unwrap } from '../../lib/api';
import { formatPrice, readPrice } from '../../lib/catalog';
import { saveErrorMessage } from '../../lib/errors';
import { cn } from '../../lib/utils';

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
  const section = (i: number) =>
    cn(
      'flex flex-col gap-4 rounded-md border border-border p-4',
      step === i ? '' : 'hidden md:flex',
    );
  const heading = (i: number) => (
    <h2 className="text-lg font-semibold">
      <span className="text-sm font-normal text-muted-foreground md:hidden">
        {t('newStore.stepOf', { n: i + 1, total: STEPS.length })}{' '}
      </span>
      {t(STEPS[i]?.title ?? 'newStore.store')}
    </h2>
  );
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Link to="/platform" className="inline-flex min-h-11 items-center gap-1 text-sm text-primary">
        <ChevronLeft aria-hidden className="size-4" />
        {t('tenant.back')}
      </Link>
      <PageHeader title={t('newStore.title')} />
      <p className="text-muted-foreground">{t('newStore.intro')}</p>
      <Form form={form} onSubmit={(v) => create.mutate(v)}>
        <section aria-label={t('newStore.store')} className={section(0)}>
          {heading(0)}
          <TextField name="name" label={t('store.name')} maxLength={100} />
          <TextField
            name="slug"
            label={t('tenants.slug')}
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
          <SelectField
            name="defaultLocale"
            label={t('store.defaultLocale')}
            options={[
              { value: 'bn', label: 'বাংলা' },
              { value: 'en', label: 'English' },
            ]}
          />
          <SelectField
            name="kind"
            label={t('newStore.kind')}
            hint={t('newStore.kindHint')}
            options={(['client', 'demo', 'test'] as const).map((k) => ({
              value: k,
              label: t(`kind.${k}`),
            }))}
          />
        </section>
        <section aria-label={t('newStore.owner')} className={section(1)}>
          {heading(1)}
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
        </section>
        <section aria-label={t('newStore.plan')} className={section(2)}>
          {heading(2)}
          <SelectField
            name="planId"
            label={t('subscription.plan')}
            options={[
              { value: '', label: t('newStore.planNone') },
              ...(plans.data ?? [])
                .filter((p) => p.offered || p.id === planId)
                .map((p) => ({
                  value: p.id,
                  label: `${p.name[locale]} · ${formatPrice(p.monthlyPrice, locale)}`,
                })),
            ]}
          />
          {plan && (
            <>
              <TextField
                name="price"
                label={t('newStore.price')}
                hint={t('newStore.priceHint', { price: formatPrice(plan.monthlyPrice, locale) })}
                inputMode="decimal"
                optional
              />
              <TextField
                name="setupFee"
                label={t('newStore.setupFee')}
                hint={t('newStore.setupFeeHint', { price: formatPrice(plan.setupFee, locale) })}
                inputMode="decimal"
                optional
              />
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
            </>
          )}
        </section>
        <section aria-label={t('newStore.look')} className={section(3)}>
          {heading(3)}
          <SelectField
            name="preset"
            label={t('newStore.preset')}
            hint={t('newStore.presetHint')}
            options={(['general', 'fashion', 'grocery'] as const).map((p) => ({
              value: p,
              label: t(`preset.${p}`),
            }))}
          />
        </section>
        {create.isError &&
          !(
            create.error instanceof ApiError &&
            ['slug_taken', 'slug_reserved'].includes(create.error.problem?.code ?? '')
          ) && <Notice tone="error">{saveErrorMessage(create.error, t)}</Notice>}
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          {step > 0 && (
            <Button variant="ghost" className="md:hidden" onClick={() => setStep((s) => s - 1)}>
              {t('newStore.back')}
            </Button>
          )}
          {!last && (
            <Button className="md:hidden" onClick={() => void next()}>
              {t('newStore.next')}
            </Button>
          )}
          <Button
            type="submit"
            className={last ? '' : 'hidden md:inline-flex'}
            disabled={create.isPending}
          >
            {t('newStore.create')}
          </Button>
        </div>
      </Form>
    </div>
  );
}
