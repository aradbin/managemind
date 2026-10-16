// Settings > Domains (phase-3-plan §3.9, §7): the store's default address and
// its own domains, each with its status, the DNS record to add (with a copy
// button), "Check now", "Make primary" and "Disconnect". Owners and Managers
// manage them (Q10); others see them read-only.
import { formatDateTime } from '@managemind/shared/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ConfirmDialog } from '../components/confirm-dialog';
import { Field } from '../components/field';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { useLocale } from '../i18n';
import '../i18n/online-store';
import { ApiError, api, unwrap } from '../lib/api';
import { storeSettingsQuery } from '../lib/catalog';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import { type Domain, domainsQuery } from '../lib/online-store';
import { cn } from '../lib/utils';

export function DomainsPage() {
  const { t } = useLocale();
  const domains = useQuery(domainsQuery);
  const canWrite = usePermission('settings.write');
  return (
    <div className="max-w-3xl">
      <PageHeader title={t('domains.title')} description={t('domains.description')} />
      {domains.isPending ? (
        <p role="status">{t('loading')}</p>
      ) : domains.isError ? (
        <Notice tone="error">{saveErrorMessage(domains.error, t)}</Notice>
      ) : (
        <div className="flex flex-col gap-6">
          <ul className="flex flex-col gap-4">
            <li className="rounded-md border border-border p-4">
              <p className="text-sm text-muted-foreground">{t('domains.default')}</p>
              <p className="flex flex-wrap items-center gap-2 font-medium">
                <span dir="ltr">{domains.data.defaultHost}</span>
                {domains.data.primaryHost === domains.data.defaultHost && (
                  <Badge tone="primary">{t('domains.primary')}</Badge>
                )}
              </p>
            </li>
            {domains.data.domains.map((d) => (
              <DomainCard key={d.id} domain={d} canWrite={canWrite} />
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">{t('domains.primaryHint')}</p>
          {canWrite && domains.data.domains.length < 2 && <AddDomain />}
          {canWrite && domains.data.domains.length >= 2 && <Notice>{t('domains.limit')}</Notice>}
        </div>
      )}
    </div>
  );
}

function Badge({
  tone,
  children,
}: {
  tone: 'primary' | 'ok' | 'wait' | 'bad';
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-xs font-semibold',
        tone === 'primary' && 'bg-primary text-primary-foreground',
        tone === 'ok' && 'bg-muted',
        tone === 'wait' && 'bg-warning text-warning-foreground',
        tone === 'bad' && 'bg-danger/10 text-danger',
      )}
    >
      {children}
    </span>
  );
}

function AddDomain() {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [hostname, setHostname] = useState('');
  const add = useMutation({
    mutationFn: async () =>
      unwrap(await api.POST('/v1/admin/domains', { body: { hostname: hostname.trim() } })),
    onSuccess: async () => {
      setHostname('');
      await queryClient.invalidateQueries({ queryKey: domainsQuery.queryKey });
    },
  });
  const problem = add.error instanceof ApiError ? add.error.problem : undefined;
  const field = problem?.errors?.[0]?.code;
  const bare = hostname
    .trim()
    .toLowerCase()
    .replace(/^www\./, '');
  const message = !add.isError
    ? undefined
    : field === 'bare_domain'
      ? t('domains.bare', { domain: bare })
      : field === 'reserved'
        ? t('domains.reserved')
        : problem?.code === 'conflict'
          ? t('domains.taken')
          : problem?.code === 'limit_exceeded'
            ? t('domains.limit')
            : problem?.code === 'feature_unavailable'
              ? t('domains.unavailable')
              : field
                ? t('form.invalid')
                : saveErrorMessage(add.error, t);
  return (
    <form
      className="flex flex-col gap-3 rounded-md border border-border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (hostname.trim()) add.mutate();
      }}
    >
      <Field
        label={t('domains.hostname')}
        hint={t('domains.hostnameHint')}
        placeholder="www.yourshop.com.bd"
        inputMode="url"
        autoComplete="off"
        dir="ltr"
        maxLength={253}
        value={hostname}
        error={message}
        onChange={(e) => setHostname(e.target.value)}
      />
      <div>
        <Button type="submit" disabled={!hostname.trim() || add.isPending}>
          {t('domains.add')}
        </Button>
      </div>
    </form>
  );
}

function DomainCard({ domain, canWrite }: { domain: Domain; canWrite: boolean }) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState(false);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: domainsQuery.queryKey }),
      queryClient.invalidateQueries({ queryKey: storeSettingsQuery.queryKey }),
    ]);
  const status = t(`domains.status.${domain.status === 'removed' ? 'failed' : domain.status}`);
  const check = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST('/v1/admin/domains/{id}/check', { params: { path: { id: domain.id } } }),
      ),
    onSuccess: async (d) => {
      toast(
        t('domains.checked', {
          status: t(`domains.status.${d.status === 'removed' ? 'failed' : d.status}`),
        }),
      );
      await refresh();
    },
    onError: (e) => toast(errorMessage(e, t)),
  });
  const primary = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST('/v1/admin/domains/{id}/primary', { params: { path: { id: domain.id } } }),
      ),
    onSuccess: async () => {
      toast(t('domains.madePrimary', { domain: domain.hostname }));
      await refresh();
    },
    onError: (e) => toast(saveErrorMessage(e, t)),
  });
  const remove = useMutation({
    mutationFn: async () =>
      unwrap(await api.DELETE('/v1/admin/domains/{id}', { params: { path: { id: domain.id } } })),
    onSuccess: async () => {
      setRemoving(false);
      await refresh();
    },
  });
  return (
    <li className="flex flex-col gap-3 rounded-md border border-border p-4">
      <p className="flex flex-wrap items-center gap-2 font-medium">
        <span dir="ltr">{domain.hostname}</span>
        <Badge
          tone={domain.status === 'active' ? 'ok' : domain.status === 'pending' ? 'wait' : 'bad'}
        >
          {status}
        </Badge>
        {domain.isPrimary && <Badge tone="primary">{t('domains.primary')}</Badge>}
      </p>
      {domain.failureReason && (domain.status !== 'pending' || domain.checkAttempts > 1) && (
        <p className="text-sm text-danger">
          {t('domains.problem', { reason: domain.failureReason })}
        </p>
      )}
      {domain.status !== 'active' && (
        <div className="flex flex-col gap-2">
          <p className="text-sm">{t('domains.dns')}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th className="p-2">{t('domains.dnsType')}</th>
                  <th className="p-2">{t('domains.dnsName')}</th>
                  <th className="p-2">{t('domains.dnsValue')}</th>
                  <th className="p-2">
                    <span className="sr-only">{t('domains.copy')}</span>
                  </th>
                </tr>
              </thead>
              <tbody dir="ltr">
                {domain.dns.map((r) => (
                  <tr key={`${r.type}-${r.name}`} className="border-t border-border">
                    <td className="p-2 font-mono">{r.type}</td>
                    <td className="p-2 font-mono break-all">{r.name}</td>
                    <td className="p-2 font-mono break-all">{r.value}</td>
                    <td className="p-2">
                      <Button
                        variant="ghost"
                        onClick={() =>
                          navigator.clipboard
                            ?.writeText(r.value)
                            .then(() => toast(t('domains.copied')))
                        }
                      >
                        {t('domains.copy')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-muted-foreground">{t('domains.steps')}</p>
        </div>
      )}
      {domain.lastCheckedAt && (
        <p className="text-sm text-muted-foreground">
          {t('domains.lastChecked', {
            time: formatDateTime(locale, new Date(domain.lastCheckedAt)),
          })}
        </p>
      )}
      {canWrite && (
        <div className="flex flex-wrap gap-2">
          {domain.status !== 'active' && (
            <Button variant="secondary" disabled={check.isPending} onClick={() => check.mutate()}>
              {t('domains.check')}
            </Button>
          )}
          {domain.status === 'active' && !domain.isPrimary && (
            <Button
              variant="secondary"
              disabled={primary.isPending}
              onClick={() => primary.mutate()}
            >
              {t('domains.makePrimary')}
            </Button>
          )}
          <Button variant="ghost" className="text-danger" onClick={() => setRemoving(true)}>
            {t('domains.remove')}
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={t('domains.removeConfirm', { domain: domain.hostname })}
        confirmLabel={t('domains.remove')}
        busy={remove.isPending}
        error={remove.isError ? saveErrorMessage(remove.error, t) : undefined}
        onConfirm={() => remove.mutate()}
      >
        <p>{t('domains.removeBody')}</p>
      </ConfirmDialog>
    </li>
  );
}
