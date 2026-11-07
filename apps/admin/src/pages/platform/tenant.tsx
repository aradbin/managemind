// Platform: one store (phase-1-plan §5.4, §7.3, phase-5b-plan §7). Registry
// data, addresses, owners, the setup checklist and the plan; super admins
// suspend and reactivate (with why), close and reopen; support staff open
// the store for a limited time, and its owners are told why.
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { Ban, CircleAlert, Info, LogIn, Pause, Play } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { Form, SelectField, TextField } from '../../components/form';
import { RowMenu, RowMenuItem } from '../../components/list-tools';
import { Notice } from '../../components/notice';
import { PageHeader, PlatformBadge } from '../../components/page-header';
import { PhoneRecordHeader } from '../../components/record-header';
import { StoreTile } from '../../components/store-switcher';
import { useToast } from '../../components/toast';
import { SecondaryBadge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { cardPadded, cardTitle } from '../../components/ui/card';
import { Dialog } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { useLocale } from '../../i18n';
import { formatDateTime } from '../../lib/dates';
import '../../i18n/launch';
import { api, meQuery, unwrap } from '../../lib/api';
import { useRecordPage } from '../../lib/crumb';
import { errorMessage, saveErrorMessage } from '../../lib/errors';
import { switchStore } from '../../lib/store';
import { cn } from '../../lib/utils';
import { StatusBadge } from './status';
import {
  CloseOrReopen,
  JobsSection,
  KV,
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
  const [dialog, setDialog] = useState<'support' | 'lifecycle' | 'close' | null>(null);
  useRecordPage(tenant.data?.name);
  const superAdmin = me.user.platformRole === 'super_admin';
  const d = tenant.data;
  const date = (v: string) => formatDateTime(locale, new Date(v), { dateStyle: 'medium' });
  const statusNote =
    d?.status === 'suspended'
      ? t('tenant.suspendedNote', {
          reason: d.statusReason ? t(`reason.${d.statusReason}`) : '—',
        })
      : d?.status === 'closed' && d.closedAt
        ? d.purgeAfter
          ? t('tenant.closedNote', { date: date(d.closedAt), purge: date(d.purgeAfter) })
          : t('tenant.closedOn', { date: date(d.closedAt) })
        : null;
  const badges = d && (
    <>
      <StatusBadge status={d.status} />
      <SecondaryBadge>{t(`kind.${d.kind}`)}</SecondaryBadge>
      <SecondaryBadge lang="en">{d.plan}</SecondaryBadge>
    </>
  );
  const canClose = superAdmin && (d?.status === 'active' || d?.status === 'suspended');
  const moreMenu = canClose && d && (
    <RowMenu label={t('tenant.more')} trigger="outline">
      {d.status === 'active' && (
        <RowMenuItem danger onSelect={() => setDialog('lifecycle')}>
          <Pause aria-hidden />
          {t('tenant.suspend')}
        </RowMenuItem>
      )}
      <RowMenuItem danger onSelect={() => setDialog('close')}>
        <Ban aria-hidden />
        {t('tenant.close')}
      </RowMenuItem>
    </RowMenu>
  );
  const actions = (phone: boolean) =>
    d && (
      <>
        {d.status === 'active' && (
          <Button
            variant="secondary"
            className={cn(phone && 'flex-1')}
            aria-haspopup="dialog"
            onClick={() => setDialog('support')}
          >
            <LogIn aria-hidden />
            {t('support.title')}
          </Button>
        )}
        {superAdmin && d.status === 'suspended' && (
          <Button className={cn(phone && 'flex-1')} onClick={() => setDialog('lifecycle')}>
            <Play aria-hidden />
            {t('tenant.reactivate')}
          </Button>
        )}
        {superAdmin && d.status === 'closed' && (
          <Button
            variant="secondary"
            className={cn(phone && 'flex-1')}
            onClick={() => setDialog('close')}
          >
            {t('tenant.reopen')}
          </Button>
        )}
        {!phone && superAdmin && d.status === 'active' && (
          <Button
            variant="secondary"
            className="text-danger hover:text-danger"
            aria-haspopup="dialog"
            onClick={() => setDialog('lifecycle')}
          >
            <Pause aria-hidden />
            {t('tenant.suspend')}
          </Button>
        )}
        {moreMenu}
      </>
    );
  return (
    <div className="flex w-full max-w-[1080px] flex-col gap-3 md:gap-4">
      <PhoneRecordHeader to="/platform" backLabel={t('tenant.back')} title={d?.name ?? ''}>
        <span className="mr-2">
          <PlatformBadge />
        </span>
      </PhoneRecordHeader>
      {tenant.isPending ? (
        <p role="status">{t('loading')}</p>
      ) : tenant.isError ? (
        <Notice tone="error">{errorMessage(tenant.error, t)}</Notice>
      ) : (
        d && (
          <>
            <PageHeader
              className="mb-0 max-md:hidden"
              parent={{ to: '/platform', label: t('tenant.back') }}
              title={d.name}
              badges={badges}
              description={
                <>
                  <span lang="en">{d.domains.find((x) => x.isPrimary)?.hostname ?? d.slug}</span> ·{' '}
                  {t('tenant.createdOn', { date: date(d.createdAt) })}
                </>
              }
              actions={actions(false)}
            />
            <div className="flex flex-col gap-3 md:hidden">
              <p className="text-[13px] text-muted-foreground">
                <span lang="en">{d.domains.find((x) => x.isPrimary)?.hostname ?? d.slug}</span> ·{' '}
                {t('tenant.createdOn', { date: date(d.createdAt) })}
              </p>
              <div className="flex flex-wrap gap-1.5">{badges}</div>
              <div className="flex flex-wrap gap-2">{actions(true)}</div>
            </div>
            {statusNote &&
              (d.status === 'suspended' ? (
                <div
                  role="note"
                  className="flex items-start gap-2.5 rounded-[10px] border border-[color-mix(in_oklch,var(--tone-warn)_35%,transparent)] bg-[color-mix(in_oklch,var(--tone-warn)_7%,transparent)] px-3.5 py-3"
                >
                  <CircleAlert
                    aria-hidden
                    className="mt-0.5 size-4 shrink-0 text-[var(--tone-warn)]"
                  />
                  <p>{statusNote}</p>
                </div>
              ) : (
                <div
                  role="note"
                  className="flex items-start gap-2.5 rounded-[10px] bg-muted px-3.5 py-3"
                >
                  <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <p>{statusNote}</p>
                </div>
              ))}
            <div className="grid items-start gap-3 md:gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              {/* Phones: one column, the purge and the details first (as drawn). */}
              <div className="flex min-w-0 flex-col gap-3 max-lg:contents md:gap-4">
                <div className="max-lg:order-3">
                  <SetupSection tenantId={d.id} />
                </div>
                <div className="max-lg:order-4">
                  <SubscriptionSection tenant={d} superAdmin={superAdmin} />
                </div>
                <div className="max-lg:order-5">
                  <JobsSection
                    tenantId={d.id}
                    superAdmin={superAdmin}
                    resettable={
                      d.kind !== 'client' && (d.status === 'active' || d.status === 'suspended')
                        ? { name: d.name, slug: d.slug }
                        : undefined
                    }
                  />
                </div>
                <div className="empty:hidden max-lg:order-1">
                  <PurgeSection
                    tenant={d}
                    purgeAfter={d.purgeAfter ? new Date(d.purgeAfter).toISOString() : null}
                    superAdmin={superAdmin}
                  />
                </div>
              </div>
              <div className="flex min-w-0 flex-col gap-3 max-lg:contents md:gap-4">
                <section
                  aria-labelledby="details-h"
                  className={cn(cardPadded, 'gap-3.5 max-lg:order-2 md:gap-3.5')}
                >
                  <h2 id="details-h" className={cardTitle}>
                    {t('tenant.details')}
                  </h2>
                  <dl className="flex flex-col gap-2.5">
                    <KV k={t('tenants.status')}>{t(`status.${d.status}`)}</KV>
                    {d.statusReason && (
                      <KV k={t('tenant.statusReason')}>{t(`reason.${d.statusReason}`)}</KV>
                    )}
                    <KV k={t('tenant.kind')}>{t(`kind.${d.kind}`)}</KV>
                    <KV k={t('tenant.address')}>
                      <span lang="en">
                        {d.domains.find((x) => x.isPrimary)?.hostname ?? d.slug}
                      </span>
                    </KV>
                    <KV k={t('tenants.plan')}>
                      <span lang="en">{d.plan}</span>
                    </KV>
                    <KV k={t('store.defaultLocale')}>
                      {d.defaultLocale === 'bn' ? 'বাংলা' : 'English'}
                    </KV>
                    <KV k={t('tenants.createdAt')}>{date(d.createdAt)}</KV>
                    {d.closedAt && <KV k={t('tenant.closedAt')}>{date(d.closedAt)}</KV>}
                    {d.purgeAfter && <KV k={t('tenant.purgeAfter')}>{date(d.purgeAfter)}</KV>}
                    <KV k={t('tenant.members')}>{d.memberCount}</KV>
                  </dl>
                </section>
                <section
                  aria-labelledby="owners-h"
                  className={cn(cardPadded, 'gap-3 max-lg:order-6 md:gap-3')}
                >
                  <h2 id="owners-h" className={cardTitle}>
                    {t('tenant.owners')}
                  </h2>
                  <ul className="flex flex-col gap-2.5">
                    {d.owners.map((o) => (
                      <li key={o.userId} className="flex items-center gap-2.5">
                        <StoreTile name={o.name} className="size-8 rounded-lg text-xs" />
                        <span className="flex min-w-0 flex-col">
                          <span className="font-medium">{o.name}</span>
                          <span className="truncate text-[13px] text-muted-foreground">
                            {o.email}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
                {d.domains.length > 0 && (
                  <section
                    aria-labelledby="domains-h"
                    className={cn(cardPadded, 'gap-3 max-lg:order-7 md:gap-3')}
                  >
                    <h2 id="domains-h" className={cardTitle}>
                      {t('tenant.domains')}
                    </h2>
                    <ul className="flex flex-col gap-2.5">
                      {d.domains.map((x) => (
                        <li key={x.hostname} className="flex items-center justify-between gap-2.5">
                          <span lang="en" className="truncate font-mono text-[13px]">
                            {x.hostname}
                          </span>
                          {x.isPrimary && <SecondaryBadge>{t('tenant.primary')}</SecondaryBadge>}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            </div>
            {d.status === 'active' && (
              <SupportAccess
                tenant={d}
                superAdmin={superAdmin}
                open={dialog === 'support'}
                onOpenChange={(o) => setDialog(o ? 'support' : null)}
              />
            )}
            {superAdmin && (
              <>
                <Lifecycle
                  tenant={d}
                  open={dialog === 'lifecycle'}
                  onOpenChange={(o) => setDialog(o ? 'lifecycle' : null)}
                />
                <CloseOrReopen
                  tenant={d}
                  open={dialog === 'close'}
                  onOpenChange={(o) => setDialog(o ? 'close' : null)}
                />
              </>
            )}
          </>
        )
      )}
    </div>
  );
}

/** Suspending (with why) or reactivating a store, for super admins. */
export function Lifecycle({
  tenant,
  open,
  onOpenChange: setOpen,
}: {
  tenant: Pick<Tenant, 'id' | 'name' | 'slug' | 'status'>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
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
            className="h-10 rounded-lg border border-input bg-transparent px-3 text-base shadow-xs md:h-9 md:text-sm dark:bg-white/[0.045]"
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
  );
}

const MINUTES = [15, 30, 60, 120, 240] as const;
const supportSchema = z.object({
  role: z.enum(['viewer', 'manager']),
  minutes: z.coerce.number().int().min(1).max(240),
  reason: z.string().trim().min(10, 'support.reasonShort').max(500),
});

function SupportAccess({
  tenant,
  superAdmin,
  open,
  onOpenChange,
}: {
  tenant: Tenant;
  superAdmin: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
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
    <Dialog open={open} onOpenChange={onOpenChange} title={t('support.title')}>
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
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('action.cancel')}
          </Button>
          <Button type="submit" disabled={start.isPending}>
            {t('support.start')}
          </Button>
        </div>
      </Form>
    </Dialog>
  );
}
