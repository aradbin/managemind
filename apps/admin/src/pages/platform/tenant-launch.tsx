// Platform: a store's launch sections (phase-5b-plan §7): its setup
// checklist with a fresh check, its plan and dunning hold, and closing and
// reopening. Super admins change; support reads.
import { zodResolver } from '@hookform/resolvers/zod';
import { formatDateTime } from '@managemind/shared/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Circle } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { Field } from '../../components/field';
import { Form, SelectField, TextField } from '../../components/form';
import { Notice } from '../../components/notice';
import { useToast } from '../../components/toast';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { type AdminKey, useLocale } from '../../i18n';
import '../../i18n/launch';
import { api, unwrap } from '../../lib/api';
import { formatPrice, priceInput, readPrice } from '../../lib/catalog';
import { errorMessage, saveErrorMessage } from '../../lib/errors';

interface TenantRef {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended' | 'closed' | 'purged';
}

export type ChecklistItem = {
  item:
    | 'profile'
    | 'logo'
    | 'products'
    | 'delivery'
    | 'payments'
    | 'legal'
    | 'email'
    | 'sms'
    | 'domain'
    | 'terms';
  done: boolean;
  optional: boolean;
};

/** The checklist's items, done or to do, with "optional" where it applies. */
export function ChecklistItems({ items }: { items: readonly ChecklistItem[] }) {
  const { t } = useLocale();
  return (
    <ul className="flex flex-col gap-2">
      {items.map((i) => (
        <li key={i.item} className="flex items-start gap-2">
          {i.done ? (
            <Check aria-hidden className="mt-0.5 size-5 shrink-0 text-success" />
          ) : (
            <Circle aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          )}
          <span>
            <span className="sr-only">{t(i.done ? 'checklist.done' : 'checklist.todo')}: </span>
            {t(`checklist.item.${i.item}` as AdminKey)}
            {i.optional && (
              <span className="text-sm text-muted-foreground"> ({t('checklist.optional')})</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function SetupSection({ tenantId }: { tenantId: string }) {
  const { t, locale } = useLocale();
  const queryClient = useQueryClient();
  const key = ['platform', 'tenant', tenantId, 'health'] as const;
  const health = useQuery({
    queryKey: key,
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/platform/tenants/{id}/health', {
          params: { path: { id: tenantId } },
        }),
      ),
  });
  const refresh = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST('/v1/platform/tenants/{id}/health/refresh', {
          params: { path: { id: tenantId } },
        }),
      ),
    onSuccess: async (fresh) => {
      queryClient.setQueryData(key, fresh);
      await queryClient.invalidateQueries({ queryKey: ['platform', 'tenants'] });
    },
  });
  const list =
    health.data?.checklist && 'items' in health.data.checklist ? health.data.checklist : null;
  return (
    <section aria-labelledby="setup-h" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="setup-h" className="text-lg font-semibold">
          {t('checklist.title')}
        </h2>
        <Button variant="secondary" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
          {t('checklist.refresh')}
        </Button>
      </div>
      {health.isError && <Notice tone="error">{errorMessage(health.error, t)}</Notice>}
      {refresh.isError && <Notice tone="error">{saveErrorMessage(refresh.error, t)}</Notice>}
      {health.isSuccess && !list && <p className="text-muted-foreground">{t('checklist.never')}</p>}
      {list && health.data && (
        <>
          <p>
            {t('checklist.progress', { done: list.done, total: list.total })} ·{' '}
            <span className="text-muted-foreground">
              {t('checklist.checkedAt', {
                when: formatDateTime(locale, new Date(health.data.checkedAt)),
              })}
            </span>
          </p>
          <ChecklistItems items={list.items} />
        </>
      )}
    </section>
  );
}

const subscriptionSchema = z.object({
  planId: z.string().min(1, 'form.required'),
  price: z
    .string()
    .trim()
    .refine((v) => readPrice(v) !== undefined, 'form.invalid'),
  setupFee: z
    .string()
    .trim()
    .refine((v) => readPrice(v) !== undefined, 'form.invalid'),
  billingDay: z.coerce.number().int().min(1).max(28),
  trialEndsOn: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/),
});
const holdSchema = z.object({
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'form.required'),
  reason: z.string().trim().min(3, 'form.required').max(500),
});

export function SubscriptionSection({
  tenant,
  superAdmin,
}: {
  tenant: TenantRef;
  superAdmin: boolean;
}) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [holding, setHolding] = useState(false);
  const key = ['platform', 'tenant', tenant.id, 'subscription'] as const;
  const sub = useQuery({
    queryKey: key,
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/platform/tenants/{id}/subscription', {
          params: { path: { id: tenant.id } },
        }),
      ),
  });
  const plans = useQuery({
    queryKey: ['platform', 'plans'],
    enabled: editing,
    queryFn: async () => unwrap(await api.GET('/v1/platform/plans')),
  });
  const form = useForm<
    z.input<typeof subscriptionSchema>,
    unknown,
    z.output<typeof subscriptionSchema>
  >({
    resolver: zodResolver(subscriptionSchema),
    values: {
      planId: sub.data?.plan.id ?? '',
      price: priceInput(sub.data?.priceOverride),
      setupFee: priceInput(sub.data?.setupFeeOverride),
      billingDay: String(sub.data?.billingDay ?? 1),
      trialEndsOn: sub.data?.trialEndsOn ?? '',
    },
  });
  const holdForm = useForm<z.input<typeof holdSchema>, unknown, z.output<typeof holdSchema>>({
    resolver: zodResolver(holdSchema),
    defaultValues: { until: '', reason: '' },
  });
  const done = async (message: AdminKey) => {
    toast(t(message));
    await queryClient.invalidateQueries({ queryKey: ['platform'] });
  };
  const save = useMutation({
    mutationFn: async (v: z.output<typeof subscriptionSchema>) =>
      unwrap(
        await api.PUT('/v1/platform/tenants/{id}/subscription', {
          params: { path: { id: tenant.id } },
          body: {
            planId: v.planId,
            billingDay: v.billingDay,
            priceOverride: readPrice(v.price) ?? null,
            setupFeeOverride: readPrice(v.setupFee) ?? null,
            trialEndsOn: v.trialEndsOn || null,
          },
        }),
      ),
    onSuccess: async () => {
      setEditing(false);
      await done('subscription.saved');
    },
  });
  const hold = useMutation({
    mutationFn: async (v: { until: string | null; reason?: string }) =>
      unwrap(
        await api.POST('/v1/platform/tenants/{id}/subscription/hold', {
          params: { path: { id: tenant.id } },
          body: v,
        }),
      ),
    onSuccess: async (_saved, v) => {
      setHolding(false);
      holdForm.reset();
      await done(v.until ? 'subscription.held' : 'subscription.holdEnded');
    },
  });
  const s = sub.data;
  return (
    <section aria-labelledby="subscription-h" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="subscription-h" className="text-lg font-semibold">
          {t('subscription.title')}
        </h2>
        {superAdmin && sub.isSuccess && (
          <div className="flex flex-wrap gap-2">
            {s && !s.holdUntil && (
              <Button variant="secondary" onClick={() => setHolding(true)}>
                {t('subscription.hold')}
              </Button>
            )}
            <Button variant="secondary" onClick={() => setEditing(true)}>
              {t(s ? 'subscription.edit' : 'subscription.set')}
            </Button>
          </div>
        )}
      </div>
      {sub.isError && <Notice tone="error">{errorMessage(sub.error, t)}</Notice>}
      {sub.isSuccess && !s && <p className="text-muted-foreground">{t('subscription.none')}</p>}
      {s && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt className="text-muted-foreground">{t('subscription.plan')}</dt>
          <dd>{s.plan.name[locale]}</dd>
          <dt className="text-muted-foreground">{t('subscription.status')}</dt>
          <dd>{t(`subscription.status.${s.status}`)}</dd>
          <dt className="text-muted-foreground">{t('subscription.price')}</dt>
          <dd>
            {s.priceOverride === null
              ? formatPrice(s.plan.monthlyPrice, locale)
              : t('subscription.negotiated', { price: formatPrice(s.priceOverride, locale) })}
          </dd>
          <dt className="text-muted-foreground">{t('subscription.setupFee')}</dt>
          <dd>{formatPrice(s.setupFeeOverride ?? s.plan.setupFee, locale)}</dd>
          <dt className="text-muted-foreground">{t('subscription.billingDay')}</dt>
          <dd>{s.billingDay}</dd>
          {s.trialEndsOn && (
            <>
              <dt className="text-muted-foreground">{t('subscription.trialEnds')}</dt>
              <dd>
                {formatDateTime(locale, new Date(`${s.trialEndsOn}T00:00:00+06:00`), {
                  dateStyle: 'medium',
                })}
              </dd>
            </>
          )}
        </dl>
      )}
      {s?.holdUntil && (
        <Notice tone="info">
          <span className="flex flex-wrap items-center justify-between gap-2">
            {t('subscription.holding', {
              date: formatDateTime(locale, new Date(`${s.holdUntil}T00:00:00+06:00`), {
                dateStyle: 'medium',
              }),
              reason: s.holdReason ?? '',
            })}
            {superAdmin && (
              <Button
                variant="ghost"
                disabled={hold.isPending}
                onClick={() => hold.mutate({ until: null })}
              >
                {t('subscription.endHold')}
              </Button>
            )}
          </span>
        </Notice>
      )}
      <Dialog open={editing} onOpenChange={setEditing} title={t('subscription.edit')}>
        <Form form={form} onSubmit={(v) => save.mutate(v)}>
          <SelectField
            name="planId"
            label={t('subscription.plan')}
            options={[
              { value: '', label: '—', disabled: true },
              ...(plans.data ?? []).map((p) => ({
                value: p.id,
                label: `${p.name[locale]} · ${formatPrice(p.monthlyPrice, locale)}`,
              })),
            ]}
          />
          <TextField name="price" label={t('newStore.price')} inputMode="decimal" optional />
          <TextField name="setupFee" label={t('newStore.setupFee')} inputMode="decimal" optional />
          <TextField
            name="billingDay"
            label={t('newStore.billingDay')}
            hint={t('newStore.billingDayHint')}
            type="number"
            min={1}
            max={28}
          />
          <TextField name="trialEndsOn" label={t('newStore.trialEnds')} type="date" optional />
          {save.isError && <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>}
          <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
            <Button variant="ghost" onClick={() => setEditing(false)}>
              {t('action.cancel')}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {t('action.save')}
            </Button>
          </div>
        </Form>
      </Dialog>
      <Dialog open={holding} onOpenChange={setHolding} title={t('subscription.hold')}>
        <Form form={holdForm} onSubmit={(v) => hold.mutate(v)}>
          <p className="text-muted-foreground">{t('subscription.holdHint')}</p>
          <TextField name="until" label={t('subscription.holdUntil')} type="date" />
          <TextField name="reason" label={t('subscription.holdReason')} maxLength={500} />
          {hold.isError && <Notice tone="error">{saveErrorMessage(hold.error, t)}</Notice>}
          <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
            <Button variant="ghost" onClick={() => setHolding(false)}>
              {t('action.cancel')}
            </Button>
            <Button type="submit" disabled={hold.isPending}>
              {t('subscription.hold')}
            </Button>
          </div>
        </Form>
      </Dialog>
    </section>
  );
}

/** Close (an active or suspended store) or reopen (a closed one), for super admins. */
export function CloseOrReopen({ tenant }: { tenant: TenantRef }) {
  const { t } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [code, setCode] = useState('');
  const closing = tenant.status === 'active' || tenant.status === 'suspended';
  const change = useMutation({
    mutationFn: async () => {
      const params = { path: { id: tenant.id } };
      return closing
        ? unwrap(
            await api.POST('/v1/platform/tenants/{id}/close', {
              params,
              body: { slug: tenant.slug, reason: reason.trim(), code },
            }),
          )
        : unwrap(
            await api.POST('/v1/platform/tenants/{id}/reopen', {
              params,
              body: { reason: reason.trim() },
            }),
          );
    },
    onSuccess: async () => {
      toast(t(closing ? 'tenant.closed' : 'tenant.reopened', { name: tenant.name }));
      setOpen(false);
      setReason('');
      setCode('');
      await queryClient.invalidateQueries({ queryKey: ['platform'] });
    },
  });
  if (tenant.status === 'purged') return null;
  return (
    <>
      <Button variant={closing ? 'danger' : 'primary'} onClick={() => setOpen(true)}>
        {t(closing ? 'tenant.close' : 'tenant.reopen')}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) change.reset();
        }}
        title={t(closing ? 'tenant.closeTitle' : 'tenant.reopenTitle', { name: tenant.name })}
        confirmLabel={t(closing ? 'tenant.close' : 'tenant.reopen')}
        destructive={closing}
        confirmText={closing ? tenant.slug : undefined}
        canConfirm={reason.trim().length >= 3 && (!closing || /^\d{6}$/.test(code))}
        busy={change.isPending}
        error={change.isError ? saveErrorMessage(change.error, t) : undefined}
        onConfirm={() => change.mutate()}
      >
        <p>{t(closing ? 'tenant.closeBody' : 'tenant.reopenBody')}</p>
        <Field
          label={t('tenant.reason')}
          hint={t('tenant.reasonHint')}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        {closing && (
          <Field
            label={t('tenant.code')}
            hint={t('tenant.codeHint')}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
        )}
      </ConfirmDialog>
    </>
  );
}
