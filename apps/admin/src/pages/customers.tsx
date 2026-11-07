// Customers (phase-4-plan §3.10, §7; ADR 0033): the list, searched by phone or
// name and filtered by tag; one customer with their orders, addresses, tags
// and note; customers and addresses edited in side panels; import through the
// import screen; export.
import { formatNumber } from '@managemind/shared/i18n';
import { formatPhone, normalizePhone } from '@managemind/shared/phone';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import {
  Copy,
  FileUp,
  Flag,
  MessageCircle,
  Pencil,
  Phone,
  Plus,
  SquarePen,
  Star,
  Trash2,
  UserRound,
  UserX,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ConfirmDialog } from '../components/confirm-dialog';
import { type Column, DataList } from '../components/data-list';
import { Field } from '../components/field';
import {
  FilterButtons,
  RowMenu,
  RowMenuItem,
  RowMenuSeparator,
  SearchInput,
} from '../components/list-tools';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { emptyPlace, type PlaceDraft, PlacePicker, placeReady } from '../components/place-picker';
import { PhoneRecordHeader } from '../components/record-header';
import { RiskPanel, ScoreBadge } from '../components/risk';
import { initials } from '../components/store-switcher';
import { useToast } from '../components/toast';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { cardFrame, cardPadded, cardTitle } from '../components/ui/card';
import { Textarea } from '../components/ui/input';
import { Sheet, SheetBody, SheetDelete, SheetFooter, SheetForm } from '../components/ui/sheet';
import { StatRow } from '../components/ui/stat-row';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/orders';
import { api, unwrap } from '../lib/api';
import { formatPrice } from '../lib/catalog';
import { useRecordPage } from '../lib/crumb';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import { useOpenNew } from '../lib/open-new';
import {
  type Customer,
  type CustomerAddress,
  type CustomerFilters,
  type CustomerSummary,
  customerQuery,
  customersList,
  dateOnly,
  geoQuery,
  orderErrorMessage,
} from '../lib/orders';
import { usePagedList } from '../lib/paged';
import { cn } from '../lib/utils';
import { CustomerExportButton } from './order-export';

export type CustomerSearch = CustomerFilters & { page?: number | undefined };

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
  /** The panel: a new customer, or one being edited. */
  const [panel, setPanel] = useState<{ customer?: CustomerSummary } | null>(null);
  const [deleting, setDeleting] = useState<CustomerSummary | null>(null);
  const toast = useToast();
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: async (id: string) =>
      unwrap(await api.DELETE('/v1/admin/customers/{id}', { params: { path: { id } } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast(t('customers.deleted'));
      setDeleting(null);
    },
  });
  useOpenNew(
    useCallback(() => setPanel({}), []),
    canWrite,
  );
  const setFilter = (patch: Partial<CustomerSearch>) =>
    navigate({
      from: '/customers/',
      to: '/customers',
      search: (prev: CustomerSearch) =>
        Object.fromEntries(
          // A new filter starts again at page 1.
          Object.entries({ ...prev, page: undefined, ...patch }).filter(([, v]) => v),
        ) as CustomerSearch,
      replace: true,
    });
  useEffect(() => {
    const id = setTimeout(() => {
      if ((search.q ?? '') !== q.trim()) setFilter({ q: q.trim() || undefined });
    }, 350);
    return () => clearTimeout(id);
  });
  const { page, ...filters } = search;
  const customers = usePagedList({
    ...customersList(filters),
    page,
    onPageChange: (next) =>
      navigate({
        from: '/customers/',
        to: '/customers',
        search: (prev: CustomerSearch) => ({ ...prev, page: next > 1 ? next : undefined }),
      }),
  });
  const items = customers.items;
  // The tags on the customers loaded so far, and the one filtered by.
  const tags = useMemo(
    () =>
      [...new Set([...items.flatMap((c) => c.tags), ...(search.tag ? [search.tag] : [])])].sort(),
    [items, search.tag],
  );
  const filtered = Boolean(search.q || search.tag);
  const reset = () => {
    setQ('');
    setFilter({ q: undefined, tag: undefined });
  };
  const open = (c: CustomerSummary) => navigate({ to: '/customers/$id', params: { id: c.id } });
  const picked = (search.tag ?? '').split(',').filter(Boolean);
  const tagChips = (c: CustomerSummary) =>
    c.tags.length > 0 && (
      <span className="flex min-w-0 flex-wrap gap-1">
        {c.tags.map((tag) => (
          <button
            key={tag}
            type="button"
            aria-pressed={picked.includes(tag)}
            className="relative z-[1] inline-flex h-[22px] items-center rounded-md bg-muted px-2 text-xs font-medium whitespace-nowrap hover:bg-accent aria-pressed:bg-primary aria-pressed:text-primary-foreground"
            onClick={() => setFilter({ tag })}
          >
            {tag}
          </button>
        ))}
      </span>
    );
  const columns: Column<CustomerSummary>[] = [
    {
      header: t('order.customer'),
      skeleton: 'text',
      cell: (c) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <Avatar name={c.name} />
          <Link to="/customers/$id" params={{ id: c.id }} className="truncate font-medium">
            {c.name}
          </Link>
          {c.flagged && <FlaggedBadge />}
        </span>
      ),
    },
    {
      header: t('customer.phone'),
      cell: (c) => (
        <span className="text-muted-foreground tabular-nums">{formatPhone(c.phone)}</span>
      ),
    },
    {
      header: t('customer.orders'),
      numeric: true,
      cell: (c) => formatNumber(locale, c.orderCount),
    },
    {
      header: t('customer.totalSpent'),
      numeric: true,
      cell: (c) => (c.orderCount ? formatPrice(c.totalSpent, locale) : '—'),
    },
    {
      header: t('customer.lastOrder'),
      cell: (c) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {c.lastOrderAt ? dateOnly(locale, c.lastOrderAt) : '—'}
        </span>
      ),
    },
    { header: t('customer.tags'), skeleton: 'badge', cell: (c) => tagChips(c) },
  ];
  return (
    <div className="flex flex-col gap-3 md:gap-4">
      <PageHeader
        className="mb-0"
        title={t('nav.customers')}
        actions={
          <>
            <span className="hidden md:contents">
              <CustomerExportButton filters={filters} />
              {canWrite && (
                <Button variant="secondary" asChild>
                  <Link to="/customers/import">
                    <FileUp aria-hidden />
                    {t('customers.import')}
                  </Link>
                </Button>
              )}
            </span>
            {canWrite && (
              <span className="md:hidden">
                <RowMenu label={t('customers.importExport')} trigger="outline">
                  <RowMenuItem onSelect={() => navigate({ to: '/customers/import' })}>
                    <FileUp aria-hidden />
                    {t('customers.import')}
                  </RowMenuItem>
                </RowMenu>
              </span>
            )}
            {canWrite && (
              <Button onClick={() => setPanel({})}>
                <Plus aria-hidden />
                {t('customers.new')}
              </Button>
            )}
          </>
        }
      />
      <div className="flex items-center gap-2 md:flex-wrap">
        <SearchInput
          className="min-w-0 flex-1 md:w-[280px] md:flex-none"
          label={t('customers.search')}
          placeholder={t('customers.searchPhone')}
          value={q}
          onChange={setQ}
        />
        <FilterButtons
          filters={[
            {
              key: 'tag',
              multi: true,
              label: t('customers.tagFilter'),
              value: search.tag,
              options: tags.map((tag) => ({ value: tag, label: tag })),
              onChange: (tag) => setFilter({ tag }),
            },
          ]}
          width={220}
          onReset={filtered ? reset : undefined}
        />
      </div>
      <DataList
        label={t('nav.customers')}
        items={items}
        rowKey={(c) => c.id}
        onOpen={open}
        grid="minmax(0,1.5fr) 124px 60px 104px 92px minmax(0,1fr) 40px"
        rowHeight={52}
        menu={(c) => (
          <RowMenu label={c.name}>
            <RowMenuItem onSelect={() => open(c)}>
              <UserRound aria-hidden />
              {t('customers.view')}
            </RowMenuItem>
            <RowMenuItem onSelect={() => window.open(`tel:${c.phone}`, '_self')}>
              <Phone aria-hidden />
              {t('order.call')}
            </RowMenuItem>
            <RowMenuItem
              onSelect={() =>
                window.open(`https://wa.me/${c.phone.replace(/\D/g, '')}`, '_blank', 'noopener')
              }
            >
              <MessageCircle aria-hidden />
              {t('order.whatsapp')}
            </RowMenuItem>
            {canWrite && (
              <RowMenuItem onSelect={() => setPanel({ customer: c })}>
                <SquarePen aria-hidden />
                {t('customers.edit')}
              </RowMenuItem>
            )}
            {canWrite && (
              <>
                <RowMenuSeparator />
                <RowMenuItem danger onSelect={() => setDeleting(c)}>
                  <Trash2 aria-hidden />
                  {t('action.delete')}
                </RowMenuItem>
              </>
            )}
          </RowMenu>
        )}
        card={(c) => (
          <div className="flex items-center gap-3">
            <Avatar name={c.name} className="size-10 text-[13px]" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="flex min-w-0 items-center gap-2">
                <Link to="/customers/$id" params={{ id: c.id }} className="truncate font-medium">
                  {c.name}
                </Link>
                {c.flagged && <FlaggedBadge />}
              </span>
              <span className="truncate text-[13px] leading-[18px] text-muted-foreground tabular-nums">
                {formatPhone(c.phone)} · {t('dashboard.orders', { count: c.orderCount })}
              </span>
            </div>
            {c.orderCount > 0 && (
              <span className="flex shrink-0 flex-col items-end">
                <span className="font-medium tabular-nums">
                  {formatPrice(c.totalSpent, locale)}
                </span>
                {c.lastOrderAt && (
                  <span className="text-xs text-muted-foreground">
                    {dateOnly(locale, c.lastOrderAt)}
                  </span>
                )}
              </span>
            )}
          </div>
        )}
        columns={columns}
        isPending={customers.isPending}
        error={customers.isError ? errorMessage(customers.error, t) : undefined}
        onRetry={() => customers.refetch()}
        empty={filtered ? t('customers.noMatches') : t('customers.empty')}
        emptyAction={
          filtered ? (
            <Button variant="secondary" onClick={reset}>
              {t('list.resetFilters')}
            </Button>
          ) : undefined
        }
        pager={customers.pager}
      />
      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setDeleting(null)}
          title={t('customers.deleteTitle', { name: deleting.name })}
          confirmLabel={t('action.delete')}
          busy={remove.isPending}
          error={remove.error ? errorMessage(remove.error, t) : undefined}
          onConfirm={() => remove.mutate(deleting.id)}
        />
      )}
      {panel && <CustomerSheet customer={panel.customer} onClose={() => setPanel(null)} />}
    </div>
  );
}

/** The customer's initials in a grey circle. */
function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold',
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

function FlaggedBadge() {
  const { t } = useLocale();
  return (
    <span className="inline-flex h-[22px] shrink-0 items-center rounded-lg bg-danger-soft px-2 text-xs font-medium whitespace-nowrap text-danger">
      {t('customers.flagged')}
    </span>
  );
}

/** What the customer panel edits; a list row has it all. */
type CustomerFields = Pick<Customer, 'id' | 'phone' | 'name' | 'email' | 'tags' | 'note'>;

/** A new customer, or edits to one, in a side panel (design rule 1). */
function CustomerSheet({
  customer,
  onClose,
  onDelete,
}: {
  customer?: CustomerFields | undefined;
  onClose: () => void;
  /** Delete, at the footer's left, when the page can delete. */
  onDelete?: (() => void) | undefined;
}) {
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
    <Sheet
      open
      onOpenChange={(v) => !v && onClose()}
      title={t(customer ? 'customers.edit' : 'customers.new')}
      description={t(customer ? 'customers.editHint' : 'customers.newHint')}
    >
      <SheetForm
        onSubmit={(e) => {
          e.preventDefault();
          if (!normalizePhone(phone) || !name.trim()) {
            setInvalid(true);
            return;
          }
          save.mutate();
        }}
      >
        <SheetBody>
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
            <Textarea
              id="customer-note"
              rows={3}
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          {save.error && <Notice tone="error">{customerError(save.error, t)}</Notice>}
        </SheetBody>
        <SheetFooter
          start={onDelete && <SheetDelete onClick={onDelete}>{t('action.delete')}</SheetDelete>}
        >
          <Button variant="secondary" size="lg" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button type="submit" size="lg" disabled={save.isPending}>
            {t(customer ? 'action.save' : 'customers.new')}
          </Button>
        </SheetFooter>
      </SheetForm>
    </Sheet>
  );
}

const customerError = (e: unknown, t: Parameters<typeof orderErrorMessage>[1]) =>
  e instanceof Error && e.message === 'conflict'
    ? t('customers.phoneTaken')
    : orderErrorMessage(e, t);

export function CustomerDetailPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const { t } = useLocale();
  const customer = useQuery(customerQuery(id));
  useRecordPage(customer.data?.name, { tabBar: true });
  if (customer.isPending) return <p role="status">{t('loading')}</p>;
  if (customer.isError) return <Notice tone="error">{errorMessage(customer.error, t)}</Notice>;
  return <CustomerView customer={customer.data} />;
}

// Phones stack the cards as the phone board does: the record before the orders.
const customerOrder = {
  risk: 'max-md:order-1',
  orders: 'max-md:order-2',
  addresses: 'max-md:order-3',
  note: 'max-md:order-4',
} as const;

/** Orders still moving are dark, finished ones grey, cancelled ones outlined (as drawn). */
const orderTone = (status: string) =>
  status === 'completed'
    ? 'bg-secondary text-secondary-foreground'
    : status === 'cancelled' || status === 'returned'
      ? 'text-muted-foreground shadow-[inset_0_0_0_1px_var(--color-border)]'
      : 'bg-primary text-primary-foreground';
const deliveryDot = (status: string) =>
  status === 'delivered'
    ? 'bg-success'
    : status === 'failed' || status === 'returned'
      ? 'bg-danger'
      : status === 'shipped' || status === 'partly_shipped'
        ? 'bg-[var(--color-bar)]'
        : 'bg-muted-foreground';

/** At most this many orders on the page; "View all" lists the rest. */
const SHOWN_ORDERS = 5;

function CustomerView({ customer: c }: { customer: Customer }) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canWrite = usePermission('customers.write');
  const canOrder = usePermission('orders.write');
  const canAnonymize = usePermission('customers.delete');
  const [dialog, setDialog] = useState<'edit' | 'delete' | 'anonymize' | 'address' | null>(null);
  const [address, setAddress] = useState<CustomerAddress | undefined>();
  const remove = useMutation({
    mutationFn: async () =>
      unwrap(await api.DELETE('/v1/admin/customers/{id}', { params: { path: { id: c.id } } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast(t('customers.deleted'));
      navigate({ to: '/customers' });
    },
  });
  // A shopper's deletion request (phase-5b-plan §3.13).
  const anonymize = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST('/v1/admin/customers/{id}/anonymize', { params: { path: { id: c.id } } }),
      ),
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
          params: { path: { id: c.id } },
          body: { flagged },
        }),
      ),
    onSuccess: (saved) => queryClient.setQueryData(customerQuery(c.id).queryKey, saved),
  });
  const average = c.orderCount ? Math.round(c.totalSpent / c.orderCount / 100) * 100 : 0;
  // Staff's flag and failed deliveries can be cleared; a low score can't (phase-6-plan §3.3).
  const clearable = c.risk.reasons.some((r) => r === 'flagged' || r === 'failed_deliveries');
  const meta = [
    c.phone && formatPhone(c.phone),
    c.email,
    c.firstOrderAt
      ? t('customer.since', { date: dateOnly(locale, c.firstOrderAt) })
      : t('customer.noOrdersYet'),
  ]
    .filter(Boolean)
    .join(' · ');
  const contact = c.phone && (
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
  );
  const menu = (trigger: 'ghost' | 'outline') => (
    <RowMenu label={t('list.moreActions')} trigger={trigger} page>
      {canOrder && (
        <RowMenuItem
          onSelect={() =>
            navigate({ to: '/orders/new', search: { phone: c.phone ?? '', name: c.name } })
          }
        >
          <Plus aria-hidden />
          {t('customer.newOrder')}
        </RowMenuItem>
      )}
      {c.phone && (
        <RowMenuItem
          onSelect={() =>
            navigator.clipboard
              ?.writeText(formatPhone(c.phone as string))
              .then(() => toast(t('customer.phoneCopied')))
          }
        >
          <Copy aria-hidden />
          {t('customer.copyPhone')}
        </RowMenuItem>
      )}
      {canWrite && (c.flagged || !c.phoneFlagged) && (
        <RowMenuItem disabled={flag.isPending} onSelect={() => flag.mutate(!c.flagged)}>
          <Flag aria-hidden />
          {t(c.flagged ? 'customer.clearFlag' : 'customer.flag')}
        </RowMenuItem>
      )}
      {canWrite && (
        <>
          <RowMenuSeparator />
          <RowMenuItem danger onSelect={() => setDialog('delete')}>
            <Trash2 aria-hidden />
            {t('customers.delete')}
          </RowMenuItem>
          {canAnonymize && (
            <RowMenuItem danger onSelect={() => setDialog('anonymize')}>
              <UserX aria-hidden />
              {t('customers.anonymize')}
            </RowMenuItem>
          )}
        </>
      )}
    </RowMenu>
  );
  const shown = c.orders.slice(0, SHOWN_ORDERS);
  return (
    <div className="flex flex-col gap-3 md:gap-4">
      <PhoneRecordHeader to="/customers" backLabel={t('customer.back')} title={t('customer.title')}>
        {canWrite && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('customers.edit')}
            onClick={() => setDialog('edit')}
          >
            <Pencil aria-hidden />
          </Button>
        )}
        {menu('ghost')}
      </PhoneRecordHeader>
      <div className="flex flex-wrap items-center gap-4 max-md:hidden">
        <Avatar name={c.name} className="size-14 text-lg" />
        <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-1">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-[22px] leading-7 font-semibold tracking-[-0.01em]">
              {c.name}
            </h1>
            <ScoreBadge risk={c.risk} />
          </div>
          <p className="text-muted-foreground">{meta}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {contact}
          {canWrite && (
            <Button variant="secondary" onClick={() => setDialog('edit')}>
              <Pencil aria-hidden />
              {t('customer.edit')}
            </Button>
          )}
          {menu('outline')}
        </div>
      </div>
      <section aria-labelledby="customer-name" className={cn(cardPadded, 'gap-3.5 md:hidden')}>
        <div className="flex items-center gap-3">
          <Avatar name={c.name} className="size-12 text-base" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex min-w-0 items-center gap-2">
              <p id="customer-name" className="truncate text-lg leading-6 font-semibold">
                {c.name}
              </p>
              <ScoreBadge risk={c.risk} />
            </div>
            <p className="text-[13px] leading-[18px] text-muted-foreground">{meta}</p>
          </div>
        </div>
        {contact && <div className="flex gap-2 [&>a]:flex-1">{contact}</div>}
      </section>
      {c.phoneFlagged && (
        <Notice tone="error">
          <span className="flex flex-col gap-2.5 md:flex-row md:items-center">
            <span className="flex-1">
              {c.flagged
                ? t('customer.flaggedByHand')
                : c.risk.reasons.includes('failed_deliveries')
                  ? t('customer.flaggedByFailures', { count: c.failedDeliveries })
                  : t('customer.flaggedByScore')}
            </span>
            {canWrite && clearable && (
              <Button
                variant="secondary"
                className="self-start md:self-auto"
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
      <StatRow
        stats={[
          { label: t('customer.totalSpent'), value: formatPrice(c.totalSpent, locale) },
          { label: t('customer.orders'), value: formatNumber(locale, c.orderCount) },
          { label: t('dashboard.average'), value: formatPrice(average, locale) },
          {
            label: t('customer.lastOrder'),
            value: c.lastOrderAt ? dateOnly(locale, c.lastOrderAt) : '—',
          },
        ]}
      />
      <div className="grid items-start gap-3 md:gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section
          aria-labelledby="orders-h"
          className={cn(cardFrame, 'flex flex-col', customerOrder.orders)}
        >
          <div className="flex min-h-5 items-center justify-between gap-3 px-4 py-4 md:px-5">
            <h2 id="orders-h" className={cardTitle}>
              {t('customer.orders')}
            </h2>
            {c.orderCount > shown.length && c.phone && (
              <Button variant="ghost" className="-my-1.5 -mr-2 h-8 px-2" asChild>
                <Link to="/orders" search={{ q: c.phone }}>
                  <span className="md:hidden">{t('customer.viewAll')}</span>
                  <span className="max-md:hidden">
                    {t('customer.viewAllOrders', { count: formatNumber(locale, c.orderCount) })}
                  </span>
                </Link>
              </Button>
            )}
          </div>
          {shown.length === 0 ? (
            <div className="flex flex-col items-center gap-2 border-t border-border px-5 py-10 text-center">
              <p className="text-muted-foreground">{t('customer.noOrders')}</p>
              {canOrder && (
                <Button variant="secondary" asChild>
                  <Link to="/orders/new" search={{ phone: c.phone ?? '', name: c.name }}>
                    {t('customer.newOrder')}
                  </Link>
                </Button>
              )}
            </div>
          ) : (
            <ul className="border-t border-border">
              {shown.map((o) => (
                <li key={o.id} className="border-b border-border last:border-b-0">
                  <Link
                    to="/orders/$id"
                    params={{ id: o.id }}
                    className="grid min-h-[80px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-muted/50 md:min-h-[68px] md:grid-cols-[72px_64px_minmax(0,1fr)_auto] md:px-5 md:py-2"
                  >
                    <span className="flex items-baseline gap-2 md:contents">
                      <span className="font-semibold tabular-nums">#{o.number}</span>
                      <span className="text-muted-foreground">{dateOnly(locale, o.placedAt)}</span>
                    </span>
                    <span className="flex min-w-0 flex-wrap items-center gap-1.5 max-md:col-start-1 max-md:row-start-2">
                      <span
                        className={cn(
                          'inline-flex h-[22px] items-center rounded-lg px-2 text-xs font-medium whitespace-nowrap',
                          orderTone(o.status),
                        )}
                      >
                        {t(`orderStatus.${o.status}` as AdminKey)}
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-[13px] whitespace-nowrap text-muted-foreground">
                        <span
                          aria-hidden
                          className={cn('size-2 rounded-full', deliveryDot(o.deliveryStatus))}
                        />
                        {t(`deliveryStatus.${o.deliveryStatus}` as AdminKey)}
                      </span>
                    </span>
                    <span className="text-right font-medium tabular-nums max-md:row-span-2 max-md:row-start-1 max-md:col-start-2">
                      {formatPrice(o.total, locale)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <div className="flex flex-col gap-4 max-md:contents">
          <div className={cn('flex flex-col', customerOrder.risk)}>
            <RiskPanel risk={c.risk} failedDeliveries={c.failedDeliveries}>
              {canWrite && !c.phoneFlagged && (
                <Button
                  variant="secondary"
                  disabled={flag.isPending}
                  onClick={() => flag.mutate(true)}
                >
                  {t('customer.flag')}
                </Button>
              )}
            </RiskPanel>
          </div>
          <section
            aria-labelledby="addresses-h"
            className={cn(cardPadded, 'gap-3 md:gap-3', customerOrder.addresses)}
          >
            <div className="flex min-h-5 items-center justify-between gap-3">
              <h2 id="addresses-h" className={cardTitle}>
                {t('customer.addresses')}
              </h2>
              {canWrite && c.addresses.length < 10 && (
                <Button
                  variant="ghost"
                  className="-my-1.5 -mr-2 h-8 px-2"
                  aria-haspopup="dialog"
                  onClick={() => {
                    setAddress(undefined);
                    setDialog('address');
                  }}
                >
                  <Plus aria-hidden />
                  {t('customer.add')}
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
          <section
            aria-labelledby="note-h"
            className={cn(cardPadded, 'gap-3 md:gap-3', customerOrder.note)}
          >
            <div className="flex min-h-5 items-center justify-between gap-3">
              <h2 id="note-h" className={cardTitle}>
                {t('customer.noteAndTags')}
              </h2>
              {canWrite && (
                <Button
                  variant="ghost"
                  className="-my-1.5 -mr-2 h-8 px-2"
                  aria-haspopup="dialog"
                  onClick={() => setDialog('edit')}
                >
                  {t('order.editShort')}
                </Button>
              )}
            </div>
            {c.note && <p className="whitespace-pre-wrap">{c.note}</p>}
            {c.tags.length > 0 && (
              <p className="flex flex-wrap gap-1.5">
                {c.tags.map((tag) => (
                  <Link
                    key={tag}
                    to="/customers"
                    search={{ tag }}
                    className="inline-flex h-[22px] items-center rounded-md bg-secondary px-2 text-xs font-medium whitespace-nowrap text-secondary-foreground hover:bg-accent"
                  >
                    {tag}
                  </Link>
                ))}
              </p>
            )}
            {!c.note && c.tags.length === 0 && (
              <p className="text-muted-foreground">{t('customer.noNote')}</p>
            )}
          </section>
        </div>
      </div>
      {dialog === 'edit' && (
        <CustomerSheet
          customer={c}
          onClose={() => setDialog(null)}
          onDelete={() => setDialog('delete')}
        />
      )}
      {dialog === 'address' && (
        <AddressSheet customer={c} address={address} onClose={() => setDialog(null)} />
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
  const queryClient = useQueryClient();
  const canWrite = usePermission('customers.write');
  const geo = useQuery(geoQuery);
  const [deleting, setDeleting] = useState<CustomerAddress | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['customer', c.id] });
  const makeDefault = useMutation({
    mutationFn: async (addressId: string) =>
      unwrap(
        await api.PATCH('/v1/admin/customers/{id}/addresses/{addressId}', {
          params: { path: { id: c.id, addressId } },
          body: { isDefault: true },
        }),
      ),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: async (addressId: string) =>
      unwrap(
        await api.DELETE('/v1/admin/customers/{id}/addresses/{addressId}', {
          params: { path: { id: c.id, addressId } },
        }),
      ),
    onSuccess: async () => {
      await refresh();
      setDeleting(null);
    },
  });
  if (!c.addresses.length)
    return <p className="text-muted-foreground">{t('customer.noAddresses')}</p>;
  const g = geo.data?.geoIndex();
  return (
    <>
      <ul className="flex flex-col gap-2">
        {c.addresses.map((a) => {
          const title = a.label ?? a.name;
          return (
            <li
              key={a.id}
              className="flex items-start gap-2 rounded-[10px] border border-border px-3 py-2.5 text-[13px] leading-[18px]"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  {title}
                  {a.isDefault && <Badge>{t('customer.default')}</Badge>}
                </span>
                <span>
                  {a.name} · {formatPhone(a.phone)}
                </span>
                <span>{a.line}</span>
                <span className="text-muted-foreground">
                  {[g?.area(a.areaId)?.[locale], g?.district(a.districtId)?.[locale]]
                    .filter(Boolean)
                    .join(', ')}
                </span>
              </div>
              {canWrite && (
                <div className="-mt-1 -mr-1">
                  <RowMenu label={`${t('customer.address')}: ${title}`}>
                    <RowMenuItem onSelect={() => onEdit(a)}>
                      <SquarePen aria-hidden />
                      {t('order.editShort')}
                    </RowMenuItem>
                    {!a.isDefault && (
                      <RowMenuItem onSelect={() => makeDefault.mutate(a.id)}>
                        <Star aria-hidden />
                        {t('customer.makeDefault')}
                      </RowMenuItem>
                    )}
                    <RowMenuSeparator />
                    <RowMenuItem danger onSelect={() => setDeleting(a)}>
                      <Trash2 aria-hidden />
                      {t('action.delete')}
                    </RowMenuItem>
                  </RowMenu>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {makeDefault.error && <Notice tone="error">{orderErrorMessage(makeDefault.error, t)}</Notice>}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('customer.deleteAddressTitle')}
        confirmLabel={t('action.delete')}
        busy={remove.isPending}
        error={remove.error ? orderErrorMessage(remove.error, t) : undefined}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      >
        {deleting && (
          <p>
            {deleting.label ?? deleting.name} · {deleting.line}
          </p>
        )}
      </ConfirmDialog>
    </>
  );
}

/** An address, in a side panel; Delete sits at the footer's left. */
function AddressSheet({
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
  const [deleting, setDeleting] = useState(false);
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
  const remove = useMutation({
    mutationFn: async (addressId: string) =>
      unwrap(
        await api.DELETE('/v1/admin/customers/{id}/addresses/{addressId}', {
          params: { path: { id: c.id, addressId } },
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['customer', c.id] });
      onClose();
    },
  });
  return (
    <>
      <Sheet
        open={!deleting}
        onOpenChange={(v) => !v && onClose()}
        title={t(address ? 'customer.editAddress' : 'customer.addAddress')}
      >
        <SheetForm
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim() || !normalizePhone(phone) || !placeReady(place)) {
              setInvalid(true);
              return;
            }
            save.mutate();
          }}
        >
          <SheetBody>
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
            <label className="flex min-h-9 items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setDefault(e.target.checked)}
              />
              {t('customer.makeDefault')}
            </label>
            {invalid && <Notice tone="error">{t('newOrder.incomplete')}</Notice>}
            {save.error && <Notice tone="error">{orderErrorMessage(save.error, t)}</Notice>}
          </SheetBody>
          <SheetFooter
            start={
              address && (
                <SheetDelete onClick={() => setDeleting(true)}>{t('action.delete')}</SheetDelete>
              )
            }
          >
            <Button variant="secondary" size="lg" onClick={onClose}>
              {t('action.cancel')}
            </Button>
            <Button type="submit" size="lg" disabled={save.isPending}>
              {t(address ? 'action.save' : 'customer.addAddress')}
            </Button>
          </SheetFooter>
        </SheetForm>
      </Sheet>
      {address && (
        <ConfirmDialog
          open={deleting}
          onOpenChange={(open) => !open && setDeleting(false)}
          title={t('customer.deleteAddressTitle')}
          confirmLabel={t('action.delete')}
          busy={remove.isPending}
          error={remove.error ? orderErrorMessage(remove.error, t) : undefined}
          onConfirm={() => remove.mutate(address.id)}
        >
          <p>
            {address.label ?? address.name} · {address.line}
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
