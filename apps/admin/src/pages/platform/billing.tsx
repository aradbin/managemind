// Platform → Billing (phase-5b-plan §3.7, §7): our invoices with filters
// (drafts, overdue, due this week), one store's invoices with a new manual
// one, and our own invoice details, which every invoice carries.
import { zodResolver } from '@hookform/resolvers/zod';
import type { paths } from '@managemind/sdk';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Form, SelectField, SwitchField, TextField } from '../../components/form';
import { statusLabel } from '../../components/invoice-document';
import { Notice } from '../../components/notice';
import { PageHeader } from '../../components/page-header';
import { useToast } from '../../components/toast';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { type AdminKey, useLocale } from '../../i18n';
import { formatDay } from '../../lib/billing';
import '../../i18n/billing';
import { api, meQuery, unwrap } from '../../lib/api';
import { formatPrice, readPrice } from '../../lib/catalog';
import { errorMessage, saveErrorMessage } from '../../lib/errors';

export const FILTERS = ['all', 'draft', 'overdue', 'week', 'paid', 'void'] as const;
export type Filter = (typeof FILTERS)[number];
const PAGE = 50;

function filterQuery(filter: Filter) {
  switch (filter) {
    case 'draft':
    case 'paid':
    case 'void':
      return { status: filter };
    case 'overdue':
    case 'week':
      return { due: filter };
    default:
      return {};
  }
}

export function PlatformBillingPage() {
  const { t, locale } = useLocale();
  const search = useSearch({ strict: false }) as { filter?: Filter; tenant?: string };
  const filter = search.filter ?? 'all';
  const { data: me } = useSuspenseQuery(meQuery);
  const superAdmin = me.user.platformRole === 'super_admin';
  const [creating, setCreating] = useState(false);
  const invoices = useInfiniteQuery({
    queryKey: ['platform', 'invoices', filter, search.tenant ?? null] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await api.GET('/v1/platform/invoices', {
          params: {
            query: {
              ...filterQuery(filter),
              ...(search.tenant ? { tenantId: search.tenant } : {}),
              ...(pageParam ? { before: pageParam } : {}),
              limit: PAGE,
            },
          },
        }),
      ),
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const tenant = useQuery({
    queryKey: ['platform', 'tenant', search.tenant],
    enabled: !!search.tenant,
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/platform/tenants/{id}', {
          params: { path: { id: search.tenant ?? '' } },
        }),
      ),
  });
  const issuer = useQuery({
    queryKey: ['platform', 'issuer'],
    queryFn: async () => unwrap(await api.GET('/v1/platform/billing/issuer')),
  });
  const items = invoices.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader title={t('pbilling.title')} />
      {superAdmin && issuer.isSuccess && !issuer.data && (
        <Notice tone="error">{t('pbilling.issuerMissing')}</Notice>
      )}
      <nav aria-label={t('pbilling.filters')} className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <Button key={f} variant={f === filter ? 'primary' : 'secondary'} asChild>
            <Link
              to="/platform/billing"
              search={{
                ...(f === 'all' ? {} : { filter: f }),
                ...(search.tenant ? { tenant: search.tenant } : {}),
              }}
              {...(f === filter ? { 'aria-current': 'page' as const } : {})}
            >
              {t(`pbilling.filter.${f}` as AdminKey)}
            </Link>
          </Button>
        ))}
      </nav>
      {search.tenant && (
        <div className="flex flex-wrap items-center gap-2">
          <p>{t('pbilling.forStore', { store: tenant.data?.name ?? '…' })}</p>
          <Button variant="ghost" asChild>
            <Link to="/platform/billing" search={filter === 'all' ? {} : { filter }}>
              {t('pbilling.allStores')}
            </Link>
          </Button>
          {superAdmin && tenant.data && (
            <Button className="ml-auto" onClick={() => setCreating(true)}>
              {t('pbilling.new')}
            </Button>
          )}
        </div>
      )}
      {invoices.isError && <Notice tone="error">{errorMessage(invoices.error, t)}</Notice>}
      {invoices.isPending && <p role="status">{t('loading')}</p>}
      {invoices.isSuccess && items.length === 0 && (
        <p className="text-muted-foreground">{t('pbilling.none')}</p>
      )}
      {items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground">
                <th className="py-2 text-start font-normal">{t('invoice.number')}</th>
                <th className="text-start font-normal">{t('pbilling.store')}</th>
                <th className="text-start font-normal">{t('invoice.status')}</th>
                <th className="text-start font-normal">{t('invoice.dueOn')}</th>
                <th className="text-end font-normal">{t('invoice.total')}</th>
                <th className="text-end font-normal">{t('invoice.amountDue')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className="border-t border-border">
                  <td className="py-2">
                    <Link
                      to="/platform/billing/$id"
                      params={{ id: i.id }}
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      {i.number ?? t('invoice.status.draft')}
                    </Link>
                  </td>
                  <td>
                    <Link
                      to="/platform/billing"
                      search={{ ...(filter === 'all' ? {} : { filter }), tenant: i.tenantId }}
                      className="underline-offset-2 hover:underline"
                    >
                      {i.storeName}
                    </Link>
                  </td>
                  <td className={i.overdue ? 'font-semibold text-danger' : ''}>
                    {statusLabel(locale, i)}
                  </td>
                  <td>{i.dueOn ? formatDay(locale, i.dueOn) : '—'}</td>
                  <td className="text-end">{formatPrice(i.total, locale)}</td>
                  <td className="text-end">
                    {i.amountDue ? formatPrice(i.amountDue, locale) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {invoices.hasNextPage && (
        <div>
          <Button
            variant="secondary"
            disabled={invoices.isFetchingNextPage}
            onClick={() => invoices.fetchNextPage()}
          >
            {t('pbilling.more')}
          </Button>
        </div>
      )}
      {search.tenant && tenant.data && (
        <NewInvoiceDialog
          open={creating}
          onOpenChange={setCreating}
          tenantId={search.tenant}
          storeName={tenant.data.name}
        />
      )}
      {superAdmin && issuer.isSuccess && <IssuerSection issuer={issuer.data} />}
    </div>
  );
}

/** Taka with an optional minus sign: an adjustment below zero is a credit. */
function readSigned(text: string): number | null | undefined {
  const trimmed = text.trim();
  const negative = trimmed.startsWith('-') || trimmed.startsWith('−');
  const value = readPrice(negative ? trimmed.slice(1) : trimmed);
  return value === null || value === undefined ? value : negative ? -value : value;
}

const lineSchema = z
  .object({
    kind: z.enum(['setup', 'plan', 'overage', 'adjustment']),
    en: z.string().trim().min(1, 'form.required').max(200),
    bn: z.string().trim().max(200),
    quantity: z.coerce.number<string>().int('form.invalid').min(1, 'form.invalid').max(100_000),
    unitPrice: z.string().refine((v) => typeof readSigned(v) === 'number', 'form.invalid'),
    issueNow: z.boolean(),
  })
  .refine((v) => v.kind === 'adjustment' || (readSigned(v.unitPrice) ?? 0) >= 0, {
    path: ['unitPrice'],
    message: 'form.invalid',
  });

function NewInvoiceDialog({
  open,
  onOpenChange,
  tenantId,
  storeName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
  storeName: string;
}) {
  const { t } = useLocale();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const form = useForm<z.input<typeof lineSchema>, unknown, z.output<typeof lineSchema>>({
    resolver: zodResolver(lineSchema),
    defaultValues: {
      kind: 'adjustment',
      en: '',
      bn: '',
      quantity: '1',
      unitPrice: '',
      issueNow: false,
    },
  });
  const create = useMutation({
    mutationFn: async (v: z.output<typeof lineSchema>) =>
      unwrap(
        await api.POST('/v1/platform/tenants/{id}/invoices', {
          params: { path: { id: tenantId } },
          body: {
            lines: [
              {
                kind: v.kind,
                description: { en: v.en, bn: v.bn || v.en },
                quantity: v.quantity,
                unitPrice: readSigned(v.unitPrice) ?? 0,
              },
            ],
            issueNow: v.issueNow,
          },
        }),
      ),
    onSuccess: async (created) => {
      toast(t('pbilling.created'));
      onOpenChange(false);
      form.reset();
      await queryClient.invalidateQueries({ queryKey: ['platform', 'invoices'] });
      await navigate({ to: '/platform/billing/$id', params: { id: created.id } });
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`${t('pbilling.new')} · ${storeName}`}>
      <Form form={form} onSubmit={(v) => create.mutate(v)}>
        <SelectField
          name="kind"
          label={t('pbilling.lineKind')}
          options={(['adjustment', 'setup', 'plan', 'overage'] as const).map((k) => ({
            value: k,
            label: t(`lineKind.${k}`),
          }))}
        />
        <TextField name="en" label={t('pbilling.descEn')} maxLength={200} />
        <TextField name="bn" label={t('pbilling.descBn')} maxLength={200} optional />
        <TextField name="quantity" label={t('pbilling.quantity')} type="number" min={1} />
        <TextField
          name="unitPrice"
          label={t('pbilling.unitPrice')}
          hint={t('pbilling.unitPriceHint')}
          inputMode="decimal"
        />
        <SwitchField
          name="issueNow"
          label={t('pbilling.issueNow')}
          hint={t('pbilling.issueNowHint')}
        />
        {create.isError && <Notice tone="error">{saveErrorMessage(create.error, t)}</Notice>}
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('action.cancel')}
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {t('pbilling.new')}
          </Button>
        </div>
      </Form>
    </Dialog>
  );
}

type Issuer = NonNullable<
  paths['/v1/platform/billing/issuer']['get']['responses'][200]['content']['application/json']
>;

const text = (max: number) => z.string().trim().max(max);
const issuerSchema = z.object({
  legalName: z.string().trim().min(1, 'form.required').max(200),
  address: z.string().trim().min(1, 'form.required').max(500),
  tradeLicense: text(50),
  bin: text(50),
  vatRate: z
    .string()
    .trim()
    .regex(/^(\d{1,2}(\.\d{1,2})?)?$/, 'form.invalid'),
  email: z.union([z.literal(''), z.email('form.invalid').max(254)]),
  phone: text(30),
  bankName: text(100),
  bankAccountName: text(100),
  bankAccountNumber: text(50),
  bankBranch: text(100),
  bankRouting: text(20),
  bkash: text(30),
  nagad: text(30),
});

function IssuerSection({ issuer }: { issuer: Issuer | null }) {
  const { t } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const form = useForm<z.input<typeof issuerSchema>, unknown, z.output<typeof issuerSchema>>({
    resolver: zodResolver(issuerSchema),
    values: {
      legalName: issuer?.legalName ?? '',
      address: issuer?.address ?? '',
      tradeLicense: issuer?.tradeLicense ?? '',
      bin: issuer?.bin ?? '',
      vatRate:
        issuer?.vatRateBp === null || issuer?.vatRateBp === undefined
          ? ''
          : String(issuer.vatRateBp / 100),
      email: issuer?.email ?? '',
      phone: issuer?.phone ?? '',
      bankName: issuer?.bank?.name ?? '',
      bankAccountName: issuer?.bank?.accountName ?? '',
      bankAccountNumber: issuer?.bank?.accountNumber ?? '',
      bankBranch: issuer?.bank?.branch ?? '',
      bankRouting: issuer?.bank?.routing ?? '',
      bkash: issuer?.bkash ?? '',
      nagad: issuer?.nagad ?? '',
    },
  });
  const save = useMutation({
    mutationFn: async (v: z.output<typeof issuerSchema>) => {
      const opt = (s: string) => (s ? s : undefined);
      const bank = v.bankName && v.bankAccountNumber;
      const body = Object.fromEntries(
        Object.entries({
          legalName: v.legalName,
          address: v.address,
          tradeLicense: opt(v.tradeLicense),
          bin: opt(v.bin),
          vatRateBp: v.vatRate ? Math.round(Number(v.vatRate) * 100) : null,
          email: opt(v.email),
          phone: opt(v.phone),
          bank: bank
            ? Object.fromEntries(
                Object.entries({
                  name: v.bankName,
                  accountName: v.bankAccountName,
                  accountNumber: v.bankAccountNumber,
                  branch: opt(v.bankBranch),
                  routing: opt(v.bankRouting),
                }).filter(([, x]) => x !== undefined),
              )
            : undefined,
          bkash: opt(v.bkash),
          nagad: opt(v.nagad),
        }).filter(([, x]) => x !== undefined),
      );
      return unwrap(await api.PUT('/v1/platform/billing/issuer', { body }));
    },
    onSuccess: async () => {
      toast(t('pbilling.issuerSaved'));
      await queryClient.invalidateQueries({ queryKey: ['platform', 'issuer'] });
    },
  });
  return (
    <section
      aria-labelledby="issuer-h"
      className="flex max-w-2xl flex-col gap-3 rounded-xl border border-border bg-background p-4 md:p-5"
    >
      <h2 id="issuer-h" className="font-semibold">
        {t('pbilling.issuer')}
      </h2>
      <p className="text-muted-foreground">{t('pbilling.issuerIntro')}</p>
      <Form form={form} onSubmit={(v) => save.mutate(v)}>
        <TextField name="legalName" label={t('issuer.legalName')} maxLength={200} />
        <TextField name="address" label={t('issuer.address')} maxLength={500} />
        <TextField name="tradeLicense" label={t('issuer.tradeLicense')} optional />
        <TextField name="bin" label={t('issuer.bin')} optional />
        <TextField
          name="vatRate"
          label={t('issuer.vatRate')}
          hint={t('issuer.vatRateHint')}
          inputMode="decimal"
          optional
        />
        <TextField name="email" label={t('issuer.email')} type="email" optional />
        <TextField name="phone" label={t('issuer.phone')} type="tel" optional />
        <TextField name="bankName" label={t('issuer.bankName')} optional />
        <TextField name="bankAccountName" label={t('issuer.bankAccountName')} optional />
        <TextField name="bankAccountNumber" label={t('issuer.bankAccountNumber')} optional />
        <TextField name="bankBranch" label={t('issuer.bankBranch')} optional />
        <TextField name="bankRouting" label={t('issuer.bankRouting')} optional />
        <TextField name="bkash" label={t('issuer.bkash')} type="tel" optional />
        <TextField name="nagad" label={t('issuer.nagad')} type="tel" optional />
        {save.isError && <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>}
        <div>
          <Button type="submit" disabled={save.isPending}>
            {t('action.save')}
          </Button>
        </div>
      </Form>
    </section>
  );
}
