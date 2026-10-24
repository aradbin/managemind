// Customers (phase-4-plan §3.10, §7): the list, searched by phone or name and
// filtered by tag; one customer with their orders, addresses, tags and note;
// import through the import screen; export.
import { formatNumber } from '@managemind/shared/i18n';
import { normalizePhone } from '@managemind/shared/phone';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { ChevronRight, FileUp, MessageCircle, Phone, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ConfirmDialog } from '../components/confirm-dialog';
import { type Column, DataList } from '../components/data-list';
import { Field } from '../components/field';
import { Notice } from '../components/notice';
import { StatusChip } from '../components/order-status';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { emptyPlace, type PlaceDraft, PlacePicker, placeReady } from '../components/place-picker';
import { RiskPanel } from '../components/risk';
import { initials } from '../components/store-switcher';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { useLocale } from '../i18n';
import '../i18n/orders';
import { api, unwrap } from '../lib/api';
import { formatPrice } from '../lib/catalog';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import {
  type Customer,
  type CustomerAddress,
  type CustomerFilters,
  type CustomerSummary,
  customerQuery,
  customersQuery,
  dateOnly,
  geoQuery,
  orderErrorMessage,
} from '../lib/orders';
import { CustomerExportButton } from './order-export';

export type CustomerSearch = CustomerFilters;

const splitTags = (text: string) =>
  text
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

export function CustomersPage() {
  const { t, locale } = useLocale();
  const search = useSearch({ strict: false }) as CustomerSearch;
  const navigate = useNavigate();
  const canWrite = usePermission('customers.write');
  const [q, setQ] = useState(search.q ?? '');
  const [adding, setAdding] = useState(false);
  const setFilter = (patch: Partial<CustomerSearch>) =>
    navigate({
      from: '/customers/',
      to: '/customers',
      search: (prev: CustomerSearch) =>
        Object.fromEntries(
          Object.entries({ ...prev, ...patch }).filter(([, v]) => v),
        ) as CustomerSearch,
      replace: true,
    });
  useEffect(() => {
    const id = setTimeout(() => {
      if ((search.q ?? '') !== q.trim()) setFilter({ q: q.trim() || undefined });
    }, 350);
    return () => clearTimeout(id);
  });
  const customers = useInfiniteQuery(customersQuery(search));
  const items = useMemo(
    () => customers.data?.pages.flatMap((p) => p.items) ?? [],
    [customers.data],
  );
  const columns: Column<CustomerSummary>[] = [
    {
      header: t('customer.name'),
      cell: (c) => (
        <Link
          to="/customers/$id"
          params={{ id: c.id }}
          className="font-medium underline-offset-2 hover:underline"
        >
          {c.name}
        </Link>
      ),
    },
    { header: t('customer.phone'), cell: (c) => c.phone },
    { header: t('customer.orders'), cell: (c) => c.orderCount },
    { header: t('customer.totalSpent'), cell: (c) => formatPrice(c.totalSpent, locale) },
    {
      header: t('customer.lastOrder'),
      cell: (c) => (c.lastOrderAt ? dateOnly(locale, c.lastOrderAt) : '—'),
    },
    {
      header: t('customer.tags'),
      cell: (c) => (
        <span className="flex flex-wrap gap-1">
          {c.tags.map((tag) => (
            <button
              key={tag}
              type="button"
              className="min-h-8 rounded-full bg-muted px-2 text-xs"
              onClick={() => setFilter({ tag })}
            >
              {tag}
            </button>
          ))}
        </span>
      ),
    },
  ];
  return (
    <div className="max-w-6xl">
      <PageHeader
        title={t('nav.customers')}
        actions={
          <>
            <CustomerExportButton filters={search} />
            {canWrite && (
              <Button variant="secondary" asChild>
                <Link to="/customers/import">
                  <FileUp aria-hidden className="size-4" />
                  {t('customers.import')}
                </Link>
              </Button>
            )}
            {canWrite && (
              <Button onClick={() => setAdding(true)}>
                <Plus aria-hidden className="size-4" />
                {t('customers.new')}
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center">
        <Input
          type="search"
          aria-label={t('customers.search')}
          placeholder={t('customers.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {search.tag && (
          <Button variant="secondary" onClick={() => setFilter({ tag: undefined })}>
            {t('orders.tagFilter', { tag: search.tag })} ×
          </Button>
        )}
      </div>
      <DataList
        label={t('nav.customers')}
        items={items}
        rowKey={(c) => c.id}
        card={(c) => (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-start justify-between gap-3">
              <Link to="/customers/$id" params={{ id: c.id }} className="font-semibold">
                {c.name}
              </Link>
              <span className="font-semibold tabular-nums">
                {formatPrice(c.totalSpent, locale)}
              </span>
            </div>
            <span className="text-sm text-muted-foreground">
              {c.phone} · {t('dashboard.orders', { count: c.orderCount })}
              {c.lastOrderAt ? ` · ${dateOnly(locale, c.lastOrderAt)}` : ''}
            </span>
            {c.tags.length > 0 && (
              <span className="flex flex-wrap gap-1">
                {c.tags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className="min-h-8 rounded-full bg-muted px-2.5 text-xs"
                    onClick={() => setFilter({ tag })}
                  >
                    {tag}
                  </button>
                ))}
              </span>
            )}
          </div>
        )}
        columns={columns}
        isPending={customers.isPending}
        error={customers.isError ? errorMessage(customers.error, t) : undefined}
        onRetry={() => customers.refetch()}
        empty={search.q || search.tag ? t('customers.noMatches') : t('customers.empty')}
        hasMore={customers.hasNextPage}
        loadingMore={customers.isFetchingNextPage}
        onLoadMore={() => customers.fetchNextPage()}
      />
      {adding && <CustomerDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

/** A new customer, or edits to one. */
function CustomerDialog({ customer, onClose }: { customer?: Customer; onClose: () => void }) {
  const { t } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [phone, setPhone] = useState(customer?.phone ?? '');
  const [name, setName] = useState(customer?.name ?? '');
  const [email, setEmail] = useState(customer?.email ?? '');
  const [tags, setTags] = useState(customer?.tags.join(', ') ?? '');
  const [note, setNote] = useState(customer?.note ?? '');
  const [invalid, setInvalid] = useState(false);
  const save = useMutation({
    mutationFn: async () => {
      const body = {
        phone: normalizePhone(phone) as string,
        name: name.trim(),
        email: email.trim() || null,
        tags: splitTags(tags),
        note: note.trim() || null,
      };
      return customer
        ? unwrap(
            await api.PATCH('/v1/admin/customers/{id}', {
              params: { path: { id: customer.id } },
              body,
            }),
          )
        : unwrap(await api.POST('/v1/admin/customers', { body }));
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
      await queryClient.invalidateQueries({ queryKey: ['customer', saved.id] });
      toast(t('account.saved'));
      onClose();
      if (!customer) navigate({ to: '/customers/$id', params: { id: saved.id } });
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={t(customer ? 'customers.edit' : 'customers.new')}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!normalizePhone(phone) || !name.trim()) {
            setInvalid(true);
            return;
          }
          save.mutate();
        }}
      >
        <Field
          label={t('customer.phone')}
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          error={invalid && !normalizePhone(phone) ? t('form.invalidPhone') : undefined}
        />
        <Field
          label={t('customer.name')}
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
          error={invalid && !name.trim() ? t('form.required') : undefined}
        />
        <Field
          label={t('customer.email')}
          type="email"
          value={email}
          maxLength={254}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Field
          label={t('customer.tags')}
          hint={t('order.tagsHint')}
          value={tags}
          onChange={(e) => setTags(e.target.value)}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="customer-note" className="text-sm font-medium">
            {t('customer.note')}
          </label>
          <textarea
            id="customer-note"
            rows={3}
            maxLength={2000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="rounded-lg border border-border bg-background p-3 text-base"
          />
        </div>
        {save.error && <Notice tone="error">{customerError(save.error, t)}</Notice>}
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <Button variant="ghost" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {t('action.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

const customerError = (e: unknown, t: Parameters<typeof orderErrorMessage>[1]) =>
  e instanceof Error && e.message === 'conflict'
    ? t('customers.phoneTaken')
    : orderErrorMessage(e, t);

export function CustomerDetailPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const { t, locale } = useLocale();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canWrite = usePermission('customers.write');
  const customer = useQuery(customerQuery(id));
  const [dialog, setDialog] = useState<'edit' | 'delete' | 'anonymize' | 'address' | null>(null);
  const canAnonymize = usePermission('customers.delete');
  const [address, setAddress] = useState<CustomerAddress | undefined>();
  const remove = useMutation({
    mutationFn: async () =>
      unwrap(await api.DELETE('/v1/admin/customers/{id}', { params: { path: { id } } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast(t('customers.deleted'));
      navigate({ to: '/customers' });
    },
  });
  // A shopper's deletion request (phase-5b-plan §3.13).
  const anonymize = useMutation({
    mutationFn: async () =>
      unwrap(await api.POST('/v1/admin/customers/{id}/anonymize', { params: { path: { id } } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast(t('customers.anonymized'));
      navigate({ to: '/customers' });
    },
  });
  // Flag by hand, or clear, which resets the failed deliveries (phase-5a-plan §3.11).
  const flag = useMutation({
    mutationFn: async (flagged: boolean) =>
      unwrap(
        await api.PUT('/v1/admin/customers/{id}/flag', {
          params: { path: { id } },
          body: { flagged },
        }),
      ),
    onSuccess: (saved) => queryClient.setQueryData(customerQuery(id).queryKey, saved),
  });
  if (customer.isPending) return <p role="status">{t('loading')}</p>;
  if (customer.isError) return <Notice tone="error">{errorMessage(customer.error, t)}</Notice>;
  const c = customer.data;
  const average = c.orderCount ? Math.round(c.totalSpent / c.orderCount) : 0;
  // Staff's flag and failed deliveries can be cleared; a low score can't (phase-6-plan §3.3).
  const clearable = c.risk.reasons.some((r) => r === 'flagged' || r === 'failed_deliveries');
  const card = 'flex flex-col gap-3 rounded-xl border border-border bg-background p-4 md:p-5';
  return (
    <div className="flex flex-col gap-5">
      <nav aria-label={t('nav.breadcrumb')} className="flex items-center gap-1.5 text-sm">
        <Link to="/customers" className="font-medium text-primary hover:underline">
          {t('nav.customers')}
        </Link>
        <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
        <span className="truncate text-muted-foreground">{c.name}</span>
      </nav>
      <div className="flex flex-wrap items-center gap-4">
        <span
          aria-hidden
          className="inline-flex size-14 shrink-0 items-center justify-center rounded-full bg-warning text-lg font-semibold text-warning-foreground"
        >
          {initials(c.name)}
        </span>
        <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{c.name}</h1>
          <p className="text-sm text-muted-foreground">
            {[
              c.phone,
              c.email,
              c.firstOrderAt && t('customer.since', { date: dateOnly(locale, c.firstOrderAt) }),
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {c.phone && (
            <>
              <Button variant="secondary" asChild>
                <a href={`tel:${c.phone}`}>
                  <Phone aria-hidden className="size-4" />
                  {t('order.call')}
                </a>
              </Button>
              <Button variant="secondary" asChild>
                <a
                  href={`https://wa.me/${c.phone.replace(/\D/g, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <MessageCircle aria-hidden className="size-4" />
                  {t('order.whatsapp')}
                </a>
              </Button>
            </>
          )}
          {canWrite && (
            <>
              <Button variant="secondary" onClick={() => setDialog('edit')}>
                {t('customers.edit')}
              </Button>
              <Button variant="quiet" onClick={() => setDialog('delete')}>
                {t('action.delete')}
              </Button>
            </>
          )}
        </div>
      </div>
      {c.phoneFlagged && (
        <Notice tone="error">
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {c.flagged
                ? t('customer.flaggedByHand')
                : c.risk.reasons.includes('failed_deliveries')
                  ? t('customer.flaggedByFailures', { count: c.failedDeliveries })
                  : t('customer.flaggedByScore')}
            </span>
            {canWrite && clearable && (
              <Button
                variant="secondary"
                disabled={flag.isPending}
                onClick={() => flag.mutate(false)}
              >
                {t('customer.clearFlag')}
              </Button>
            )}
          </span>
        </Notice>
      )}
      {flag.error && <Notice tone="error">{saveErrorMessage(flag.error, t)}</Notice>}
      <dl className="grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-background md:grid-cols-4">
        {[
          [t('customer.totalSpent'), formatPrice(c.totalSpent, locale)],
          [t('customer.orders'), formatNumber(locale, c.orderCount)],
          [t('dashboard.average'), formatPrice(average, locale)],
          [t('customer.lastOrder'), c.lastOrderAt ? dateOnly(locale, c.lastOrderAt) : '—'],
        ].map(([label, value]) => (
          <div
            key={label}
            className="flex flex-col gap-1.5 border-border p-4 not-first:border-l max-md:nth-3:border-l-0 max-md:nth-[n+3]:border-t md:p-5"
          >
            <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
            <dd className="text-lg font-semibold tracking-tight tabular-nums md:text-xl">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section
          aria-labelledby="orders-h"
          className="overflow-hidden rounded-xl border border-border bg-background"
        >
          <h2 id="orders-h" className="px-4 py-4 font-semibold md:px-5">
            {t('customer.orders')}
          </h2>
          {c.orders.length === 0 ? (
            <p className="px-4 pb-5 text-muted-foreground md:px-5">{t('customer.noOrders')}</p>
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {c.orders.map((o) => (
                <li key={o.id}>
                  <Link
                    to="/orders/$id"
                    params={{ id: o.id }}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 hover:bg-muted md:px-5"
                  >
                    <span className="font-semibold text-primary">#{o.number}</span>
                    <span className="text-sm text-muted-foreground">
                      {dateOnly(locale, o.placedAt)}
                    </span>
                    <span className="flex flex-wrap gap-1.5">
                      <StatusChip kind="order" status={o.status} />
                      <StatusChip kind="delivery" status={o.deliveryStatus} />
                    </span>
                    <span className="ms-auto font-semibold tabular-nums">
                      {formatPrice(o.total, locale)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <div className="flex flex-col gap-5">
          <RiskPanel risk={c.risk} failedDeliveries={c.failedDeliveries}>
            {canWrite && !c.flagged && (
              <Button
                variant="secondary"
                disabled={flag.isPending}
                onClick={() => flag.mutate(true)}
              >
                {t('customer.flag')}
              </Button>
            )}
          </RiskPanel>
          <section aria-labelledby="addresses-h" className={card}>
            <div className="flex items-center justify-between gap-2">
              <h2 id="addresses-h" className="font-semibold">
                {t('customer.addresses')}
              </h2>
              {canWrite && c.addresses.length < 10 && (
                <Button
                  variant="ghost"
                  className="text-primary"
                  onClick={() => {
                    setAddress(undefined);
                    setDialog('address');
                  }}
                >
                  <Plus aria-hidden className="size-4" />
                  {t('customer.addAddress')}
                </Button>
              )}
            </div>
            <AddressList
              customer={c}
              onEdit={(a) => {
                setAddress(a);
                setDialog('address');
              }}
            />
          </section>
          {(c.tags.length > 0 || c.note) && (
            <section aria-labelledby="note-h" className={card}>
              <h2 id="note-h" className="font-semibold">
                {t('customer.noteAndTags')}
              </h2>
              {c.note && <p className="whitespace-pre-wrap text-sm">{c.note}</p>}
              {c.tags.length > 0 && (
                <p className="flex flex-wrap gap-1.5">
                  {c.tags.map((tag) => (
                    <span key={tag} className="rounded-md bg-muted px-2 py-1 text-xs font-medium">
                      {tag}
                    </span>
                  ))}
                </p>
              )}
            </section>
          )}
          {canWrite && canAnonymize && (
            <Button
              variant="ghost"
              className="self-start text-danger"
              onClick={() => setDialog('anonymize')}
            >
              {t('customers.anonymize')}
            </Button>
          )}
        </div>
      </div>
      {dialog === 'edit' && <CustomerDialog customer={c} onClose={() => setDialog(null)} />}
      {dialog === 'address' && (
        <AddressDialog customer={c} address={address} onClose={() => setDialog(null)} />
      )}
      <ConfirmDialog
        open={dialog === 'delete'}
        onOpenChange={(open) => !open && setDialog(null)}
        title={t('customers.deleteTitle', { name: c.name })}
        confirmLabel={t('action.delete')}
        busy={remove.isPending}
        error={remove.error ? orderErrorMessage(remove.error, t) : undefined}
        onConfirm={() => remove.mutate()}
      >
        <p>{t('customers.deleteBody')}</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === 'anonymize'}
        onOpenChange={(open) => !open && setDialog(null)}
        title={t('customers.anonymizeTitle', { name: c.name })}
        confirmLabel={t('customers.anonymize')}
        confirmText={c.phone}
        busy={anonymize.isPending}
        error={anonymize.error ? orderErrorMessage(anonymize.error, t) : undefined}
        onConfirm={() => anonymize.mutate()}
      >
        <p>{t('customers.anonymizeBody')}</p>
      </ConfirmDialog>
    </div>
  );
}

function AddressList({
  customer: c,
  onEdit,
}: {
  customer: Customer;
  onEdit: (a: CustomerAddress) => void;
}) {
  const { t, locale } = useLocale();
  const canWrite = usePermission('customers.write');
  const queryClient = useQueryClient();
  const geo = useQuery(geoQuery);
  const remove = useMutation({
    mutationFn: async (addressId: string) =>
      unwrap(
        await api.DELETE('/v1/admin/customers/{id}/addresses/{addressId}', {
          params: { path: { id: c.id, addressId } },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['customer', c.id] }),
  });
  if (!c.addresses.length)
    return <p className="text-muted-foreground">{t('customer.noAddresses')}</p>;
  const g = geo.data?.geoIndex();
  return (
    <ul className="grid gap-2 md:grid-cols-2">
      {c.addresses.map((a) => (
        <li
          key={a.id}
          className="flex flex-col gap-1 rounded-lg border border-border bg-background p-3 text-sm"
        >
          <span className="font-medium">
            {a.label ?? a.name}
            {a.isDefault && (
              <span className="ml-2 text-xs text-muted-foreground">({t('customer.default')})</span>
            )}
          </span>
          <span>
            {a.name} · {a.phone}
          </span>
          <span>{a.line}</span>
          <span>
            {[g?.area(a.areaId)?.[locale], g?.district(a.districtId)?.[locale]]
              .filter(Boolean)
              .join(', ')}
          </span>
          {canWrite && (
            <span className="mt-1 flex gap-2">
              <Button variant="secondary" onClick={() => onEdit(a)}>
                {t('action.edit')}
              </Button>
              <Button
                variant="ghost"
                disabled={remove.isPending}
                onClick={() => remove.mutate(a.id)}
              >
                {t('action.delete')}
              </Button>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function AddressDialog({
  customer: c,
  address,
  onClose,
}: {
  customer: Customer;
  address?: CustomerAddress | undefined;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [name, setName] = useState(address?.name ?? c.name);
  const [phone, setPhone] = useState(address?.phone ?? c.phone);
  const [label, setLabel] = useState(address?.label ?? '');
  const [isDefault, setDefault] = useState(address?.isDefault ?? c.addresses.length === 0);
  const [place, setPlace] = useState<PlaceDraft>(
    address
      ? {
          divisionId: address.divisionId,
          districtId: address.districtId,
          areaId: address.areaId,
          line: address.line,
        }
      : emptyPlace(),
  );
  const [invalid, setInvalid] = useState(false);
  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        phone: normalizePhone(phone) as string,
        divisionId: place.divisionId as number,
        districtId: place.districtId as number,
        areaId: place.areaId as number,
        line: place.line.trim(),
        label: label.trim() || null,
        isDefault,
      };
      return address
        ? unwrap(
            await api.PATCH('/v1/admin/customers/{id}/addresses/{addressId}', {
              params: { path: { id: c.id, addressId: address.id } },
              body,
            }),
          )
        : unwrap(
            await api.POST('/v1/admin/customers/{id}/addresses', {
              params: { path: { id: c.id } },
              body,
            }),
          );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['customer', c.id] });
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={t(address ? 'customer.editAddress' : 'customer.addAddress')}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim() || !normalizePhone(phone) || !placeReady(place)) {
            setInvalid(true);
            return;
          }
          save.mutate();
        }}
      >
        <Field
          label={t('customer.name')}
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
        />
        <Field
          label={t('customer.phone')}
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <PlacePicker value={place} onChange={setPlace} />
        <Field
          label={t('customer.addressLabel')}
          hint={t('customer.addressLabelHint')}
          value={label}
          maxLength={40}
          onChange={(e) => setLabel(e.target.value)}
        />
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            className="size-5"
            checked={isDefault}
            onChange={(e) => setDefault(e.target.checked)}
          />
          {t('customer.makeDefault')}
        </label>
        {invalid && <Notice tone="error">{t('newOrder.incomplete')}</Notice>}
        {save.error && <Notice tone="error">{orderErrorMessage(save.error, t)}</Notice>}
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <Button variant="ghost" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {t('action.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
