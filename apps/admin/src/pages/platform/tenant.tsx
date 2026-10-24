// Platform: one store (phase-1-plan §5.4, §7.3, phase-5b-plan §7). Registry
// data, addresses, owners, the setup checklist and the plan; super admins
// suspend and reactivate (with why), close and reopen; support staff open
// the store for a limited time, and its owners are told why.
import { zodResolver } from '@hookform/resolvers/zod';
import { formatDateTime } from '@managemind/shared/i18n';
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { Form, SelectField, TextField } from '../../components/form';
import { Notice } from '../../components/notice';
import { StoreTile } from '../../components/store-switcher';
import { useToast } from '../../components/toast';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { useLocale } from '../../i18n';
import '../../i18n/launch';
import { api, meQuery, unwrap } from '../../lib/api';
import { errorMessage, saveErrorMessage } from '../../lib/errors';
import { switchStore } from '../../lib/store';
import { StatusBadge } from './status';
import {
  CloseOrReopen,
  JobsSection,
  PurgeSection,
  SetupSection,
  SubscriptionSection,
} from './tenant-launch';

const route = getRouteApi('/_shell/platform/tenants/$id');

function tenantQuery(id: string) {
  return {
    queryKey: ['platform', 'tenant', id] as const,
    queryFn: async () =>
      unwrap(await api.GET('/v1/platform/tenants/{id}', { params: { path: { id } } })),
  };
}
type Tenant = Awaited<ReturnType<ReturnType<typeof tenantQuery>['queryFn']>>;

export function TenantPage() {
  const { t, locale } = useLocale();
  const { id } = route.useParams();
  const { data: me } = useSuspenseQuery(meQuery);
  const tenant = useQuery(tenantQuery(id));
  return (
    <div className="flex flex-col gap-5">
      <nav aria-label={t('nav.breadcrumb')} className="flex items-center gap-1.5 text-sm">
        <Link to="/platform" className="font-medium text-primary hover:underline">
          {t('tenant.back')}
        </Link>
        {tenant.data && (
          <>
            <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
            <span className="truncate text-muted-foreground">{tenant.data.name}</span>
          </>
        )}
      </nav>
      {tenant.isPending ? (
        <p role="status">{t('loading')}</p>
      ) : tenant.isError ? (
        <Notice tone="error">{errorMessage(tenant.error, t)}</Notice>
      ) : (
        <>
          <div className="flex flex-wrap items-start gap-4">
            <StoreTile name={tenant.data.name} className="size-12 rounded-xl text-base" />
            <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight">{tenant.data.name}</h1>
                <StatusBadge status={tenant.data.status} />
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                  {t(`kind.${tenant.data.kind}`)}
                </span>
                <span
                  lang="en"
                  className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
                >
                  {tenant.data.plan}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                <span lang="en">{tenant.data.slug}</span> ·{' '}
                {formatDateTime(locale, new Date(tenant.data.createdAt))}
              </p>
            </div>
            {me.user.platformRole === 'super_admin' && (
              <div className="flex flex-wrap gap-2">
                <Lifecycle tenant={tenant.data} />
                <CloseOrReopen tenant={tenant.data} />
              </div>
            )}
          </div>
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="flex min-w-0 flex-col gap-5">
              <SetupSection tenantId={tenant.data.id} />
              <SubscriptionSection
                tenant={tenant.data}
                superAdmin={me.user.platformRole === 'super_admin'}
              />
              <JobsSection
                tenantId={tenant.data.id}
                superAdmin={me.user.platformRole === 'super_admin'}
                resettable={
                  tenant.data.kind !== 'client' &&
                  (tenant.data.status === 'active' || tenant.data.status === 'suspended')
                    ? { name: tenant.data.name, slug: tenant.data.slug }
                    : undefined
                }
              />
              <PurgeSection
                tenant={tenant.data}
                purgeAfter={
                  tenant.data.purgeAfter ? new Date(tenant.data.purgeAfter).toISOString() : null
                }
                superAdmin={me.user.platformRole === 'super_admin'}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-5">
              <section aria-labelledby="details-h" className={card}>
                <h2 id="details-h" className="font-semibold">
                  {t('tenant.details')}
                </h2>
                <dl className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
                  {tenant.data.statusReason && (
                    <>
                      <dt className="text-muted-foreground">{t('tenant.statusReason')}</dt>
                      <dd>{t(`reason.${tenant.data.statusReason}`)}</dd>
                    </>
                  )}
                  {tenant.data.closedAt && (
                    <>
                      <dt className="text-muted-foreground">{t('tenant.closedAt')}</dt>
                      <dd>{formatDateTime(locale, new Date(tenant.data.closedAt))}</dd>
                    </>
                  )}
                  {tenant.data.purgeAfter && (
                    <>
                      <dt className="text-muted-foreground">{t('tenant.purgeAfter')}</dt>
                      <dd>{formatDateTime(locale, new Date(tenant.data.purgeAfter))}</dd>
                    </>
                  )}
                  <dt className="text-muted-foreground">{t('tenants.status')}</dt>
                  <dd>
                    <StatusBadge status={tenant.data.status} />
                  </dd>
                  <dt className="text-muted-foreground">{t('tenant.kind')}</dt>
                  <dd>{t(`kind.${tenant.data.kind}`)}</dd>
                  <dt className="text-muted-foreground">{t('tenants.slug')}</dt>
                  <dd lang="en">{tenant.data.slug}</dd>
                  <dt className="text-muted-foreground">{t('tenants.plan')}</dt>
                  <dd lang="en">{tenant.data.plan}</dd>
                  <dt className="text-muted-foreground">{t('store.defaultLocale')}</dt>
                  <dd>{tenant.data.defaultLocale === 'bn' ? 'বাংলা' : 'English'}</dd>
                  <dt className="text-muted-foreground">{t('tenants.createdAt')}</dt>
                  <dd>{formatDateTime(locale, new Date(tenant.data.createdAt))}</dd>
                  <dt className="text-muted-foreground">{t('tenant.members')}</dt>
                  <dd>{tenant.data.memberCount}</dd>
                </dl>
              </section>
              <section aria-labelledby="owners-h" className={card}>
                <h2 id="owners-h" className="font-semibold">
                  {t('tenant.owners')}
                </h2>
                <ul className="flex flex-col gap-1 text-sm">
                  {tenant.data.owners.map((o) => (
                    <li key={o.userId}>
                      {o.name} · <span className="break-all text-muted-foreground">{o.email}</span>
                    </li>
                  ))}
                </ul>
              </section>
              {tenant.data.domains.length > 0 && (
                <section aria-labelledby="domains-h" className={card}>
                  <h2 id="domains-h" className="font-semibold">
                    {t('tenant.domains')}
                  </h2>
                  <ul className="flex flex-col gap-1 text-sm">
                    {tenant.data.domains.map((d) => (
                      <li key={d.hostname} lang="en" className="break-all">
                        {d.hostname}
                        {d.isPrimary && (
                          <span lang={locale} className="ms-2 rounded bg-muted px-2 py-0.5 text-xs">
                            {t('tenant.primary')}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {tenant.data.status === 'active' && (
                <SupportAccess
                  tenant={tenant.data}
                  superAdmin={me.user.platformRole === 'super_admin'}
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const card = 'flex flex-col gap-3 rounded-xl border border-border bg-background p-4 md:p-5';

function Lifecycle({ tenant }: { tenant: Tenant }) {
  const { t } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [category, setCategory] = useState<'abuse' | 'client_request' | 'other'>('other');
  const suspending = tenant.status === 'active';
  const change = useMutation({
    mutationFn: async () => {
      const params = { path: { id: tenant.id } };
      const body = reason.trim() ? { reason: reason.trim() } : {};
      return suspending
        ? unwrap(
            await api.POST('/v1/platform/tenants/{id}/suspend', {
              params,
              body: { reason: reason.trim(), category },
            }),
          )
        : unwrap(await api.POST('/v1/platform/tenants/{id}/reactivate', { params, body }));
    },
    onSuccess: async () => {
      toast(t(suspending ? 'tenant.suspended' : 'tenant.reactivated', { name: tenant.name }));
      setOpen(false);
      setReason('');
      await queryClient.invalidateQueries({ queryKey: ['platform'] });
    },
  });
  if (tenant.status !== 'active' && tenant.status !== 'suspended') return null;
  return (
    <>
      <Button variant={suspending ? 'danger' : 'primary'} onClick={() => setOpen(true)}>
        {t(suspending ? 'tenant.suspend' : 'tenant.reactivate')}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) change.reset();
        }}
        title={t(suspending ? 'tenant.suspendTitle' : 'tenant.reactivateTitle', {
          name: tenant.name,
        })}
        confirmLabel={t(suspending ? 'tenant.suspend' : 'tenant.reactivate')}
        destructive={suspending}
        confirmText={suspending ? tenant.slug : undefined}
        canConfirm={!suspending || reason.trim().length >= 3}
        busy={change.isPending}
        error={change.isError ? saveErrorMessage(change.error, t) : undefined}
        onConfirm={() => change.mutate()}
      >
        {suspending && <p>{t('tenant.suspendBody')}</p>}
        {suspending && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="lifecycle-category" className="text-sm font-medium">
              {t('tenant.category')}
            </label>
            <select
              id="lifecycle-category"
              value={category}
              onChange={(e) => setCategory(e.target.value as typeof category)}
              className="min-h-11 rounded-lg border border-input bg-background px-3 text-base"
            >
              {/* Overdue suspensions come from billing (phase-5b-plan §3.8). */}
              {(['abuse', 'client_request', 'other'] as const).map((r) => (
                <option key={r} value={r}>
                  {t(`reason.${r}`)}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="lifecycle-reason" className="text-sm font-medium">
            {t('tenant.reason')}
            {!suspending && (
              <span className="font-normal text-muted-foreground"> ({t('form.optional')})</span>
            )}
          </label>
          <Input
            id="lifecycle-reason"
            aria-describedby="lifecycle-reason-hint"
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <p id="lifecycle-reason-hint" className="text-sm text-muted-foreground">
            {t('tenant.reasonHint')}
          </p>
        </div>
      </ConfirmDialog>
    </>
  );
}

const MINUTES = [15, 30, 60, 120, 240] as const;
const supportSchema = z.object({
  role: z.enum(['viewer', 'manager']),
  minutes: z.coerce.number().int().min(1).max(240),
  reason: z.string().trim().min(10, 'support.reasonShort').max(500),
});

function SupportAccess({ tenant, superAdmin }: { tenant: Tenant; superAdmin: boolean }) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const form = useForm<z.input<typeof supportSchema>, unknown, z.output<typeof supportSchema>>({
    resolver: zodResolver(supportSchema),
    defaultValues: { role: 'viewer', minutes: '60', reason: '' },
  });
  const start = useMutation({
    mutationFn: async (v: z.output<typeof supportSchema>) =>
      unwrap(
        await api.POST('/v1/platform/tenants/{id}/support-access', {
          params: { path: { id: tenant.id } },
          body: v,
        }),
      ),
    onSuccess: async () => {
      await switchStore(queryClient, tenant.id);
      await queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
      await navigate({ to: '/' });
    },
  });
  return (
    <section
      aria-labelledby="support-h"
      className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 md:p-5"
    >
      <h2 id="support-h" className="font-semibold">
        {t('support.title')}
      </h2>
      <p className="text-muted-foreground">{t('support.intro')}</p>
      <Form form={form} onSubmit={(v) => start.mutate(v)}>
        <SelectField
          name="role"
          label={t('support.role')}
          options={[
            { value: 'viewer', label: t('role.viewer') },
            ...(superAdmin ? [{ value: 'manager', label: t('role.manager') }] : []),
          ]}
        />
        <SelectField
          name="minutes"
          label={t('support.minutes')}
          options={MINUTES.map((m) => ({
            value: String(m),
            label: t('support.minutesOption', { minutes: m }),
          }))}
        />
        <TextField
          name="reason"
          label={t('tenant.reason')}
          hint={t('support.reasonHint')}
          maxLength={500}
        />
        {start.isError && <Notice tone="error">{saveErrorMessage(start.error, t)}</Notice>}
        <div>
          <Button type="submit" disabled={start.isPending}>
            {t('support.start')}
          </Button>
        </div>
      </Form>
    </section>
  );
}
