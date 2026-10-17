// Customers (phase-4-plan §3.10, §7): the list, searched by phone or name and
// filtered by tag; one customer with their orders, addresses, tags and note;
// import through the import screen; export.
import { normalizePhone } from '@managemind/shared/phone';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { ArrowLeft, FileUp, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ConfirmDialog } from '../components/confirm-dialog';
import { type Column, DataList } from '../components/data-list';
import { Field } from '../components/field';
import { Notice } from '../components/notice';
import { StatusChip } from '../components/order-status';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { emptyPlace, type PlaceDraft, PlacePicker, placeReady } from '../components/place-picker';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { useLocale } from '../i18n';
import '../i18n/orders';
import { api, unwrap } from '../lib/api';
import { formatPrice } from '../lib/catalog';
import { errorMessage } from '../lib/errors';
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
            className="rounded-md border border-border bg-background p-3 text-base"
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
  const [dialog, setDialog] = useState<'edit' | 'delete' | 'address' | null>(null);
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
  if (customer.isPending) return <p role="status">{t('loading')}</p>;
  if (customer.isError) return <Notice tone="error">{errorMessage(customer.error, t)}</Notice>;
  const c = customer.data;
  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <div>
        <Link
          to="/customers"
          className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground"
        >
          <ArrowLeft aria-hidden className="size-4" />
          {t('nav.customers')}
        </Link>
      </div>
      <PageHeader
        title={c.name}
        description={[c.phone, c.email].filter(Boolean).join(' · ')}
        actions={
          canWrite && (
            <>
              <Button variant="secondary" onClick={() => setDialog('edit')}>
                {t('customers.edit')}
              </Button>
              <Button variant="ghost" onClick={() => setDialog('delete')}>
                {t('action.delete')}
              </Button>
            </>
          )
        }
      />
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          [t('customer.orders'), String(c.orderCount)],
          [t('customer.totalSpent'), formatPrice(c.totalSpent, locale)],
          [t('customer.firstOrder'), c.firstOrderAt ? dateOnly(locale, c.firstOrderAt) : '—'],
          [t('customer.lastOrder'), c.lastOrderAt ? dateOnly(locale, c.lastOrderAt) : '—'],
        ].map(([label, value]) => (
          <div key={label} className="rounded-md border border-border p-3">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="text-lg font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      {(c.tags.length > 0 || c.note) && (
        <section className="flex flex-col gap-2 rounded-md border border-border p-4">
          {c.tags.length > 0 && (
            <p className="flex flex-wrap gap-1">
              {c.tags.map((tag) => (
                <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-xs">
                  {tag}
                </span>
              ))}
            </p>
          )}
          {c.note && <p className="whitespace-pre-wrap text-sm">{c.note}</p>}
        </section>
      )}
      <section aria-labelledby="orders-h" className="flex flex-col gap-2">
        <h2 id="orders-h" className="font-semibold">
          {t('customer.orders')}
        </h2>
        {c.orders.length === 0 ? (
          <p className="text-muted-foreground">{t('customer.noOrders')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {c.orders.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-2 p-3">
                <Link
                  to="/orders/$id"
                  params={{ id: o.id }}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  #{o.number}
                </Link>
                <span className="text-sm text-muted-foreground">
                  {dateOnly(locale, o.placedAt)}
                </span>
                <StatusChip kind="order" status={o.status} />
                <StatusChip kind="delivery" status={o.deliveryStatus} />
                <span className="ml-auto">{formatPrice(o.total, locale)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="addresses-h" className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 id="addresses-h" className="font-semibold">
            {t('customer.addresses')}
          </h2>
          {canWrite && c.addresses.length < 10 && (
            <Button
              variant="secondary"
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
        <li key={a.id} className="flex flex-col gap-1 rounded-md border border-border p-3 text-sm">
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
