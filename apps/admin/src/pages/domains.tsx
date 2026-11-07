// Settings > Domains (phase-3-plan §3.9, §7), as the canvas draws it (ADR
// 0034): the store's default address, then its own domains, each with its
// status, a ⋯ menu ("Make primary", "Check now", "Disconnect") and, while
// waiting, the DNS record to add (with a copy button) and "Check now".
// "Connect a domain" asks for it in a dialog. Owners and Managers manage
// them (Q10); others see them read-only.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Globe, Plus, RefreshCw, Star, Unlink } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog } from '../components/confirm-dialog';
import { Field } from '../components/field';
import { RowMenu, RowMenuItem, RowMenuSeparator } from '../components/list-tools';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { useToast } from '../components/toast';
import { SecondaryBadge, StatusBadge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { cardPadded, cardTitle } from '../components/ui/card';
import { Dialog } from '../components/ui/dialog';
import { useLocale } from '../i18n';
import '../i18n/online-store';
import { ApiError, api, unwrap } from '../lib/api';
import { storeSettingsQuery } from '../lib/catalog';
import { formatDateTime } from '../lib/dates';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import { type Domain, domainsQuery } from '../lib/online-store';
import { cn } from '../lib/utils';

export function DomainsPage() {
  const { t } = useLocale();
  const domains = useQuery(domainsQuery);
  const canWrite = usePermission('settings.write');
  const [adding, setAdding] = useState(false);
  return (
    <div className="flex flex-col gap-3 md:gap-4">
      <PageHeader
        parent={{ to: '/settings', label: t('settings.title') }}
        title={t('domains.title')}
        description={t('domains.description')}
      />
      {!canWrite && <Notice>{t('store.readOnly')}</Notice>}
      {domains.isPending ? (
        <p role="status">{t('loading')}</p>
      ) : domains.isError ? (
        <Notice tone="error">{saveErrorMessage(domains.error, t)}</Notice>
      ) : (
        <>
          <section aria-labelledby="domains-default" className={cn(cardPadded, 'gap-3 md:gap-3')}>
            <h2 id="domains-default" className={cardTitle}>
              {t('domains.default')}
            </h2>
            <p className="flex flex-wrap items-center gap-2.5">
              <Globe aria-hidden className="size-4 text-muted-foreground" />
              <span dir="ltr" className="flex-1 font-mono">
                {domains.data.defaultHost}
              </span>
              {domains.data.primaryHost === domains.data.defaultHost && (
                <SecondaryBadge>{t('domains.primary')}</SecondaryBadge>
              )}
              <span className="text-[13px] text-muted-foreground">{t('domains.alwaysWorks')}</span>
            </p>
          </section>
          <section aria-labelledby="domains-own" className={cn(cardPadded, 'gap-1 md:gap-1')}>
            <h2 id="domains-own" className={cardTitle}>
              {t('domains.yours')}
            </h2>
            <p className="text-[13px] text-muted-foreground">{t('domains.primaryHint')}</p>
            {domains.data.domains.length > 0 && (
              <ul className="mt-2 flex flex-col gap-3">
                {domains.data.domains.map((d) => (
                  <DomainRow key={d.id} domain={d} canWrite={canWrite} />
                ))}
              </ul>
            )}
            {canWrite && domains.data.domains.length < 2 && (
              <Button
                variant="secondary"
                aria-haspopup="dialog"
                className="mt-3 self-start"
                onClick={() => setAdding(true)}
              >
                <Plus aria-hidden />
                {t('domains.add')}
              </Button>
            )}
            {domains.data.domains.length >= 2 && (
              <p className="mt-3 text-[13px] text-muted-foreground">{t('domains.limit')}</p>
            )}
          </section>
          {adding && <AddDomain onClose={() => setAdding(false)} />}
        </>
      )}
    </div>
  );
}

function AddDomain({ onClose }: { onClose: () => void }) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [hostname, setHostname] = useState('');
  const add = useMutation({
    mutationFn: async () =>
      unwrap(await api.POST('/v1/admin/domains', { body: { hostname: hostname.trim() } })),
    onSuccess: async () => {
      setHostname('');
      await queryClient.invalidateQueries({ queryKey: domainsQuery.queryKey });
      onClose();
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
    <Dialog open onOpenChange={(open) => !open && onClose()} title={t('domains.add')}>
      <form
        className="flex flex-col gap-4"
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
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <Button variant="secondary" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button type="submit" disabled={!hostname.trim() || add.isPending}>
            {t('domains.connect')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function DomainRow({ domain, canWrite }: { domain: Domain; canWrite: boolean }) {
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
  const tone =
    domain.status === 'active' ? 'good' : domain.status === 'pending' ? 'waiting' : 'bad';
  return (
    <li className="flex flex-col gap-2.5 border-t border-border pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <span dir="ltr" className="font-mono font-semibold">
          {domain.hostname}
        </span>
        <StatusBadge tone={tone}>{status}</StatusBadge>
        {domain.isPrimary && <SecondaryBadge>{t('domains.primary')}</SecondaryBadge>}
        <span className="flex-1" />
        {canWrite && (
          <RowMenu label={t('domains.actions', { domain: domain.hostname })}>
            {domain.status === 'active' && !domain.isPrimary && (
              <RowMenuItem disabled={primary.isPending} onSelect={() => primary.mutate()}>
                <Star aria-hidden />
                {t('domains.makePrimary')}
              </RowMenuItem>
            )}
            {domain.status !== 'active' && (
              <RowMenuItem disabled={check.isPending} onSelect={() => check.mutate()}>
                <RefreshCw aria-hidden />
                {t('domains.check')}
              </RowMenuItem>
            )}
            <RowMenuSeparator />
            <RowMenuItem danger onSelect={() => setRemoving(true)}>
              <Unlink aria-hidden />
              {t('domains.remove')}
            </RowMenuItem>
          </RowMenu>
        )}
      </div>
      {domain.failureReason && (domain.status !== 'pending' || domain.checkAttempts > 1) && (
        <p className="text-[13px] text-danger">
          {t('domains.problem', { reason: domain.failureReason })}
        </p>
      )}
      {domain.status === 'active' && domain.turnstile === false && (
        <p className="text-[13px] text-muted-foreground">{t('domains.noTurnstile')}</p>
      )}
      {domain.status !== 'active' && (
        <div className="flex flex-col gap-2.5 rounded-[10px] bg-muted px-3.5 py-3">
          <p className="font-medium">{t('domains.dns')}</p>
          <div className="overflow-x-auto rounded-lg border border-border bg-background">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  {[t('domains.dnsType'), t('domains.dnsName'), t('domains.dnsValue')].map((h) => (
                    <th
                      key={h}
                      className="h-9 bg-muted px-3 text-left font-medium whitespace-nowrap text-muted-foreground first:pl-4"
                    >
                      {h}
                    </th>
                  ))}
                  <th className="h-9 bg-muted pr-4">
                    <span className="sr-only">{t('domains.copy')}</span>
                  </th>
                </tr>
              </thead>
              <tbody dir="ltr">
                {domain.dns.map((r) => (
                  <tr key={`${r.type}-${r.name}`} className="border-t border-border">
                    <td className="h-10 px-3 pl-4 font-mono">{r.type}</td>
                    <td className="h-10 px-3 font-mono break-all">{r.name}</td>
                    <td className="h-10 px-3 font-mono break-all">{r.value}</td>
                    <td className="h-10 pr-4 text-right">
                      <Button
                        variant="ghost"
                        className="-mr-2 h-7 px-2 md:h-7"
                        onClick={() =>
                          navigator.clipboard
                            ?.writeText(r.value)
                            .then(() => toast(t('domains.copied')))
                        }
                      >
                        <Copy aria-hidden />
                        {t('domains.copy')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[13px] text-muted-foreground">{t('domains.steps')}</p>
          <div className="flex items-center gap-2">
            <span className="flex-1 text-xs text-muted-foreground">
              {domain.lastCheckedAt &&
                t('domains.lastChecked', {
                  time: formatDateTime(locale, new Date(domain.lastCheckedAt), {
                    day: 'numeric',
                    month: 'short',
                    hour: 'numeric',
                    minute: '2-digit',
                  }),
                })}
            </span>
            {canWrite && (
              <Button
                variant="secondary"
                className="bg-background"
                disabled={check.isPending}
                onClick={() => check.mutate()}
              >
                <RefreshCw aria-hidden />
                {t('domains.check')}
              </Button>
            )}
          </div>
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
