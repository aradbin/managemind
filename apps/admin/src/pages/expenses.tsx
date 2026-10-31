// Expenses (phase-8-plan §3.6, §3.12; ADR 0033): a month at a time with its
// category totals, recurring entries and the categories, each list with its
// side panel: the expense with an optional receipt photo, the recurring
// entry, the category's two names. Viewers read; owners and managers write
// (Q12).
import type { Locale } from '@managemind/shared/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import {
  Archive,
  ArchiveRestore,
  ChevronLeft,
  ChevronRight,
  Paperclip,
  Pause,
  Play,
  Plus,
  SquarePen,
  Trash2,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useId, useMemo, useState } from 'react';
import { ConfirmDialog } from '../components/confirm-dialog';
import { type Column, DataList } from '../components/data-list';
import { ExportButtons } from '../components/export-buttons';
import { Field } from '../components/field';
import {
  FilterButtons,
  RowMenu,
  RowMenuItem,
  RowMenuSeparator,
  SearchInput,
  StageTabs,
} from '../components/list-tools';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { control, Textarea } from '../components/ui/input';
import { Sheet, SheetBody, SheetDelete, SheetFooter, SheetForm } from '../components/ui/sheet';
import { useLocale } from '../i18n';
import '../i18n/expenses';
import '../i18n/purchasing';
import { api, unwrap } from '../lib/api';
import { priceInput, readPrice } from '../lib/catalog';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import {
  EXPENSE_KEYS,
  type Expense,
  type ExpenseCategory,
  expenseCategoriesQuery,
  monthRange,
  type RecurringExpense,
  recurringExpensesQuery,
  shiftMonth,
  thisMonth,
  uploadReceipt,
} from '../lib/expenses';
import { dateOnly, idempotencyKey } from '../lib/orders';
import { dhakaToday, priceOrDash, SPEND_METHODS, type SpendMethod } from '../lib/purchasing';
import { cn } from '../lib/utils';

export interface ExpensesSearch {
  tab?: 'recurring' | 'categories' | undefined;
  month?: string | undefined;
}

const categoryName = (
  categories: readonly ExpenseCategory[] | undefined,
  id: string,
  locale: Locale,
) => categories?.find((c) => c.id === id)?.name[locale] ?? '—';

/** The categories' colours in the month's bar and its legend, in their order. */
const SWATCHES = [
  'oklch(0.646 0.222 41.116)',
  'oklch(0.6 0.118 184.704)',
  'oklch(0.546 0.245 262.881)',
  'oklch(0.769 0.188 70.08)',
  'oklch(0.656 0.241 354.308)',
  'oklch(0.627 0.194 149.214)',
  'oklch(0.558 0.288 302.321)',
  'oklch(0.556 0 0)',
];

function useSwatch() {
  const categories = useQuery(expenseCategoriesQuery);
  return (id: string) => {
    const at = categories.data?.findIndex((c) => c.id === id) ?? -1;
    return SWATCHES[(at < 0 ? SWATCHES.length - 1 : at) % SWATCHES.length] as string;
  };
}

const TABS = ['entries', 'recurring', 'categories'] as const;

export function ExpensesPage() {
  const { t } = useLocale();
  const search = useSearch({ strict: false }) as ExpensesSearch;
  const navigate = useNavigate();
  const tab = search.tab ?? 'entries';
  /** The title, its actions, then the tabs: the same frame on every tab. */
  const top = (actions?: ReactNode) => (
    <>
      <PageHeader
        className="mb-0"
        title={t('expenses.title')}
        description={t('expenses.intro')}
        actions={actions}
      />
      <StageTabs
        label={t('expenses.title')}
        tabs={TABS.map((key) => ({ key, label: t(`expenses.tab.${key}`) }))}
        value={tab}
        onChange={(key) =>
          navigate({
            to: '/expenses',
            search: { ...search, tab: key === 'entries' ? undefined : key },
          })
        }
      />
    </>
  );
  return (
    <div className="flex flex-col gap-4">
      {tab === 'entries' && <Entries month={search.month ?? thisMonth()} top={top} />}
      {tab === 'recurring' && <Recurring top={top} />}
      {tab === 'categories' && <Categories top={top} />}
    </div>
  );
}

type Top = (actions?: ReactNode) => ReactNode;

function Entries({ month, top }: { month: string; top: Top }) {
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canWrite = usePermission('expenses.write');
  const categories = useQuery(expenseCategoriesQuery);
  const swatch = useSwatch();
  const range = monthRange(month);
  const list = useQuery({
    queryKey: ['expenses', range] as const,
    queryFn: async () =>
      unwrap(await api.GET('/v1/admin/expenses', { params: { query: { ...range, limit: 200 } } })),
  });
  const [editing, setEditing] = useState<Expense | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Expense>();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string>();
  const remove = useMutation({
    mutationFn: async (id: string) =>
      unwrap(await api.DELETE('/v1/admin/expenses/{id}', { params: { path: { id } } })),
    onSuccess: async () => {
      for (const k of EXPENSE_KEYS) await queryClient.invalidateQueries({ queryKey: k });
      toast(t('expenses.deleted'));
      setDeleting(undefined);
    },
  });
  const go = (by: number) =>
    navigate({ to: '/expenses', search: { month: shiftMonth(month, by) } });
  const label = new Intl.DateTimeFormat(locale === 'bn' ? 'bn-BD' : 'en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T00:00:00Z`));
  const name = (id: string) => categoryName(categories.data, id, locale);
  // Search and the category filter work on the month already loaded.
  const items = useMemo(() => {
    const words = q.trim().toLowerCase();
    return (list.data?.items ?? []).filter(
      (e) =>
        (!category || e.categoryId === category) &&
        (!words || `${e.payee ?? ''} ${e.note ?? ''}`.toLowerCase().includes(words)),
    );
  }, [list.data, q, category]);
  const filtered = Boolean(q.trim() || category);
  const reset = () => {
    setQ('');
    setCategory(undefined);
  };
  const totals = list.data?.totals;

  const columns: Column<Expense>[] = [
    {
      header: t('expenses.date'),
      cell: (e) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {dateOnly(locale, e.spentOn)}
        </span>
      ),
    },
    {
      header: t('expenses.category'),
      cell: (e) => (
        <span className="flex items-center gap-2 font-medium">
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-sm"
            style={{ background: swatch(e.categoryId) }}
          />
          {name(e.categoryId)}
          {e.recurringExpenseId && (
            <span className="rounded-md border border-border px-1.5 text-xs font-medium text-muted-foreground">
              {t('expenses.fromRecurring')}
            </span>
          )}
        </span>
      ),
    },
    {
      header: t('expenses.payee'),
      cell: (e) => (
        <span className="flex flex-col">
          <span>{e.payee ?? '—'}</span>
          {e.note && <span className="text-xs text-muted-foreground">{e.note}</span>}
        </span>
      ),
    },
    {
      header: t('expenses.method'),
      cell: (e) => (
        <span className="text-muted-foreground">{t(`purchasing.method.${e.method}`)}</span>
      ),
    },
    {
      header: t('expenses.receipt'),
      wide: true,
      cell: (e) =>
        e.hasReceipt ? (
          <a
            href={`/api/admin/expenses/${e.id}/receipt`}
            target="_blank"
            rel="noopener"
            aria-label={t('expenses.receiptView')}
            title={t('expenses.receiptView')}
            className="inline-flex size-8 items-center justify-center rounded-lg hover:bg-muted"
          >
            <Paperclip aria-hidden className="size-4" />
          </a>
        ) : null,
    },
    { header: t('expenses.amount'), numeric: true, cell: (e) => priceOrDash(e.amount, locale) },
  ];
  return (
    <>
      {top(
        <>
          {canWrite && (
            <Button variant="secondary" asChild>
              <Link to="/expenses/import">{t('boImport.import')}</Link>
            </Button>
          )}
          {list.data && list.data.items.length > 0 && (
            <ExportButtons
              name={`expenses-${month}`}
              what={t('expenses.title')}
              head={[
                t('expenses.date'),
                t('expenses.category'),
                t('expenses.payee'),
                t('expenses.method'),
                t('expenses.note'),
                t('expenses.amount'),
              ]}
              rows={() =>
                (list.data?.items ?? []).map((e) => [
                  e.spentOn,
                  name(e.categoryId),
                  e.payee ?? '',
                  t(`purchasing.method.${e.method}`),
                  e.note ?? '',
                  { money: e.amount },
                ])
              }
            />
          )}
          {canWrite && (
            <Button onClick={() => setEditing('new')}>
              <Plus aria-hidden />
              {t('expenses.new')}
            </Button>
          )}
        </>,
      )}
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="icon"
          aria-label={t('expenses.previous')}
          onClick={() => go(-1)}
        >
          <ChevronLeft aria-hidden />
        </Button>
        <h2 className="min-w-36 text-center font-semibold">{label}</h2>
        <Button
          variant="secondary"
          size="icon"
          aria-label={t('expenses.next')}
          disabled={month >= thisMonth()}
          onClick={() => go(1)}
        >
          <ChevronRight aria-hidden />
        </Button>
      </div>
      {totals && totals.count > 0 && (
        <section
          aria-label={t('expenses.total', { amount: priceOrDash(totals.total, locale) })}
          className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 md:p-5"
        >
          <p className="flex flex-wrap items-baseline gap-x-3">
            <span className="text-2xl font-semibold tracking-tight tabular-nums">
              {priceOrDash(totals.total, locale)}
            </span>
            <span className="text-sm text-muted-foreground">
              {t('expenses.count', { count: totals.count })}
            </span>
          </p>
          <div aria-hidden className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
            {totals.byCategory.map((c) => (
              <span
                key={c.categoryId}
                style={{ flexGrow: c.amount, background: swatch(c.categoryId) }}
              />
            ))}
          </div>
          <ul className="grid gap-x-8 gap-y-2 text-sm md:grid-cols-2">
            {totals.byCategory.map((c) => (
              <li key={c.categoryId} className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-sm"
                  style={{ background: swatch(c.categoryId) }}
                />
                <span className="flex-1 truncate">{name(c.categoryId)}</span>
                <span className="tabular-nums">{priceOrDash(c.amount, locale)}</span>
                <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">
                  {new Intl.NumberFormat(locale === 'bn' ? 'bn-BD' : 'en-GB', {
                    style: 'percent',
                  }).format(totals.total ? c.amount / totals.total : 0)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          className="min-w-0 flex-1 basis-48 md:w-64 md:flex-none"
          label={t('expenses.searchList')}
          value={q}
          onChange={setQ}
        />
        <FilterButtons
          filters={[
            {
              key: 'category',
              label: t('expenses.category'),
              value: category,
              options: (categories.data ?? []).map((c) => ({ value: c.id, label: c.name[locale] })),
              onChange: setCategory,
            },
          ]}
          onReset={filtered ? reset : undefined}
        />
      </div>
      <DataList
        label={t('expenses.title')}
        items={list.data ? items : undefined}
        rowKey={(e) => e.id}
        columns={columns}
        isPending={list.isPending}
        error={list.isError ? errorMessage(list.error, t) : undefined}
        onRetry={() => list.refetch()}
        empty={filtered ? t('expenses.noMatches') : t('expenses.empty')}
        emptyAction={
          filtered ? (
            <Button variant="secondary" onClick={reset}>
              {t('list.resetFilters')}
            </Button>
          ) : canWrite ? (
            <Button variant="secondary" onClick={() => setEditing('new')}>
              {t('expenses.new')}
            </Button>
          ) : undefined
        }
        {...(canWrite ? { onOpen: (e: Expense) => setEditing(e) } : {})}
        menu={(e) => (
          <RowMenu label={`${name(e.categoryId)} ${dateOnly(locale, e.spentOn)}`}>
            {canWrite && (
              <RowMenuItem onSelect={() => setEditing(e)}>
                <SquarePen aria-hidden />
                {t('expenses.edit')}
              </RowMenuItem>
            )}
            {e.hasReceipt && (
              <RowMenuItem
                onSelect={() =>
                  window.open(`/api/admin/expenses/${e.id}/receipt`, '_blank', 'noopener')
                }
              >
                <Paperclip aria-hidden />
                {t('expenses.receiptView')}
              </RowMenuItem>
            )}
            {canWrite && (
              <>
                <RowMenuSeparator />
                <RowMenuItem danger onSelect={() => setDeleting(e)}>
                  <Trash2 aria-hidden />
                  {t('expenses.delete')}
                </RowMenuItem>
              </>
            )}
          </RowMenu>
        )}
        card={(e) => (
          <div className="flex items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex items-center gap-2 font-medium">
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-sm"
                  style={{ background: swatch(e.categoryId) }}
                />
                {name(e.categoryId)}
              </span>
              <span className="truncate text-sm">{e.payee ?? '—'}</span>
              <span className="text-xs text-muted-foreground">
                {dateOnly(locale, e.spentOn)} · {t(`purchasing.method.${e.method}`)}
              </span>
            </div>
            <span className="shrink-0 font-medium tabular-nums">
              {priceOrDash(e.amount, locale)}
            </span>
          </div>
        )}
      />
      {editing && (
        <ExpenseSheet
          expense={editing === 'new' ? undefined : editing}
          defaultDate={month === thisMonth() ? dhakaToday() : monthRange(month).to}
          onClose={() => setEditing(null)}
          onDelete={editing === 'new' ? undefined : () => setDeleting(editing)}
        />
      )}
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(undefined)}
        title={t('expenses.delete')}
        confirmLabel={t('action.delete')}
        busy={remove.isPending}
        error={remove.isError ? saveErrorMessage(remove.error, t) : undefined}
        onConfirm={() =>
          deleting && remove.mutate(deleting.id, { onSuccess: () => setEditing(null) })
        }
      >
        <p>{t('expenses.deleteBody')}</p>
      </ConfirmDialog>
    </>
  );
}

/**
 * Choice buttons (design rule 3): radios drawn as buttons that wrap, for five
 * to seven short options, the same on desktop and phone.
 */
function ChoiceButtons<V extends string | number>({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string;
  options: readonly { value: V; label: string }[];
  value: V;
  onChange: (value: V) => void;
}) {
  const name = useId();
  return (
    <fieldset className="flex flex-col">
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label
            key={o.value}
            className="relative flex min-h-9 cursor-pointer items-center rounded-lg border border-input bg-background px-3 text-sm shadow-xs has-checked:border-primary has-checked:bg-primary has-checked:text-primary-foreground has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring md:min-h-8 dark:bg-white/5"
          >
            <input
              type="radio"
              name={name}
              className="absolute inset-0 cursor-pointer opacity-0"
              checked={value === o.value}
              onChange={() => onChange(o.value)}
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** A segmented control (design rule 3), for two to four short options. */
function Segmented<V extends string>({
  legend,
  hideLegend,
  options,
  value,
  onChange,
}: {
  legend: string;
  /** When a label beside it already says what it is. */
  hideLegend?: boolean;
  options: readonly { value: V; label: string }[];
  value: V;
  onChange: (value: V) => void;
}) {
  const name = useId();
  return (
    <fieldset className="flex flex-col">
      <legend className={hideLegend ? 'sr-only' : 'mb-2 text-sm font-medium'}>{legend}</legend>
      <div className="inline-flex h-9 self-start rounded-[10px] bg-muted p-[3px]">
        {options.map((o) => (
          <label
            key={o.value}
            className="relative flex cursor-pointer items-center rounded-lg px-3 text-sm font-medium text-muted-foreground has-checked:bg-background has-checked:text-foreground has-checked:shadow-sm has-focus-visible:outline-2 has-focus-visible:outline-ring dark:has-checked:bg-input"
          >
            <input
              type="radio"
              name={name}
              className="absolute inset-0 cursor-pointer opacity-0"
              checked={value === o.value}
              onChange={() => onChange(o.value)}
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function MethodChoice({
  value,
  onChange,
}: {
  value: SpendMethod;
  onChange: (m: SpendMethod) => void;
}) {
  const { t } = useLocale();
  return (
    <ChoiceButtons
      legend={t('expenses.method')}
      options={SPEND_METHODS.map((m) => ({ value: m, label: t(`purchasing.method.${m}`) }))}
      value={value}
      onChange={onChange}
    />
  );
}

function CategorySelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { t, locale } = useLocale();
  const categories = useQuery(expenseCategoriesQuery);
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {t('expenses.category')}
      </label>
      <select
        id={id}
        className={cn(control, 'min-h-10 md:min-h-9')}
        value={value}
        required
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="" />
        {categories.data
          ?.filter((c) => !c.archived || c.id === value)
          .map((c) => (
            <option key={c.id} value={c.id}>
              {c.name[locale]}
            </option>
          ))}
      </select>
    </div>
  );
}

/** "(optional)" after a label. */
const optional = (label: string, t: ReturnType<typeof useLocale>['t']) =>
  `${label} (${t('form.optional')})`;

function ExpenseSheet({
  expense,
  defaultDate,
  onClose,
  onDelete,
}: {
  expense?: Expense | undefined;
  defaultDate: string;
  onClose: () => void;
  onDelete?: (() => void) | undefined;
}) {
  const { t } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [spentOn, setSpentOn] = useState(expense?.spentOn ?? defaultDate);
  const [categoryId, setCategoryId] = useState(expense?.categoryId ?? '');
  const [amount, setAmount] = useState(priceInput(expense?.amount));
  const [method, setMethod] = useState<SpendMethod>(expense?.method ?? 'cash');
  const [payee, setPayee] = useState(expense?.payee ?? '');
  const [note, setNote] = useState(expense?.note ?? '');
  const [photo, setPhoto] = useState<File | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [key] = useState(idempotencyKey);
  const value = readPrice(amount);
  const valid = typeof value === 'number' && value > 0 && categoryId !== '' && spentOn !== '';
  const today = dhakaToday();
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000)
    .toISOString()
    .slice(0, 10);
  const save = useMutation({
    mutationFn: async () => {
      const fields = {
        spentOn,
        categoryId,
        amount: value as number,
        method,
        payee: payee.trim() || null,
        note: note.trim() || null,
      };
      const saved = expense
        ? unwrap(
            await api.PATCH('/v1/admin/expenses/{id}', {
              params: { path: { id: expense.id } },
              body: fields,
            }),
          )
        : unwrap(
            await api.POST('/v1/admin/expenses', {
              params: { header: { 'idempotency-key': key } },
              body: fields,
            }),
          );
      if (removePhoto && expense?.hasReceipt) {
        unwrap(
          await api.DELETE('/v1/admin/expenses/{id}/receipt', {
            params: { path: { id: saved.id } },
          }),
        );
      }
      if (photo) {
        try {
          await uploadReceipt(saved.id, photo);
        } catch {
          return { photoFailed: true };
        }
      }
      return { photoFailed: false };
    },
    onSuccess: async ({ photoFailed }) => {
      for (const k of EXPENSE_KEYS) await queryClient.invalidateQueries({ queryKey: k });
      toast(photoFailed ? t('expenses.receiptFailed') : t('expenses.saved'));
      onClose();
    },
  });
  return (
    <Sheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={expense ? t('expenses.edit') : t('expenses.new')}
      description={expense ? undefined : t('expenses.newHint')}
    >
      <SheetForm
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) save.mutate();
        }}
      >
        <SheetBody>
          <div className="flex flex-col gap-2">
            <Field
              label={t('expenses.date')}
              type="date"
              value={spentOn}
              max={today}
              onChange={(e) => setSpentOn(e.target.value)}
            />
            {/* Chips fill the date; they aren't a choice (design rule 3). */}
            <div className="flex gap-2">
              {(
                [
                  [today, 'expenses.today'],
                  [yesterday, 'expenses.yesterday'],
                ] as const
              ).map(([date, label]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setSpentOn(date)}
                  className="h-7 rounded-md bg-muted px-2 text-xs font-medium hover:bg-border"
                >
                  {t(label)}
                </button>
              ))}
            </div>
          </div>
          <CategorySelect value={categoryId} onChange={setCategoryId} />
          <Field
            label={t('expenses.amount')}
            hint={t('expenses.amountHint')}
            inputMode="decimal"
            value={amount}
            required
            onChange={(e) => setAmount(e.target.value)}
          />
          <MethodChoice value={method} onChange={setMethod} />
          <Field
            label={optional(t('expenses.payee'), t)}
            value={payee}
            maxLength={200}
            onChange={(e) => setPayee(e.target.value)}
          />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="expense-note" className="text-sm font-medium">
              {optional(t('expenses.note'), t)}
            </label>
            <Textarea
              id="expense-note"
              rows={2}
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <Field
            label={optional(
              expense?.hasReceipt ? t('expenses.receiptReplace') : t('expenses.receiptAdd'),
              t,
            )}
            type="file"
            accept="image/*"
            capture="environment"
            className="py-1.5"
            onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
          />
          {expense?.hasReceipt && !photo && (
            <label className="flex min-h-9 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={removePhoto}
                onChange={(e) => setRemovePhoto(e.target.checked)}
              />
              {t('expenses.receiptRemove')}
            </label>
          )}
          {save.isError && <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>}
        </SheetBody>
        <SheetFooter
          start={onDelete && <SheetDelete onClick={onDelete}>{t('action.delete')}</SheetDelete>}
        >
          <Button variant="secondary" size="lg" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button type="submit" size="lg" disabled={!valid || save.isPending}>
            {expense ? t('action.save') : t('expenses.new')}
          </Button>
        </SheetFooter>
      </SheetForm>
    </Sheet>
  );
}

function scheduleText(r: RecurringExpense, t: ReturnType<typeof useLocale>['t']): string {
  if (r.cadence === 'weekly') {
    return t('recurring.weeklyOn', {
      weekday: t(`recurring.weekday.${r.day as 1 | 2 | 3 | 4 | 5 | 6 | 7}`),
    });
  }
  return r.day === 0
    ? t('recurring.monthlyLast')
    : t('recurring.monthlyOn', { day: String(r.day) });
}

function Recurring({ top }: { top: Top }) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canWrite = usePermission('expenses.write');
  const categories = useQuery(expenseCategoriesQuery);
  const swatch = useSwatch();
  const list = useQuery(recurringExpensesQuery);
  const [editing, setEditing] = useState<RecurringExpense | 'new' | null>(null);
  const [deleting, setDeleting] = useState<RecurringExpense>();
  const refresh = async () => {
    for (const k of EXPENSE_KEYS) await queryClient.invalidateQueries({ queryKey: k });
  };
  const pause = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) =>
      unwrap(
        await api.PATCH('/v1/admin/recurring-expenses/{id}', {
          params: { path: { id } },
          body: { active },
        }),
      ),
    onSuccess: async () => {
      await refresh();
      toast(t('recurring.saved'));
    },
    onError: (e) => toast(saveErrorMessage(e, t)),
  });
  const remove = useMutation({
    mutationFn: async (id: string) =>
      unwrap(await api.DELETE('/v1/admin/recurring-expenses/{id}', { params: { path: { id } } })),
    onSuccess: async () => {
      await refresh();
      toast(t('recurring.deleted'));
      setDeleting(undefined);
      setEditing(null);
    },
  });
  const name = (id: string) => categoryName(categories.data, id, locale);
  const state = (r: RecurringExpense) =>
    !r.active
      ? t('recurring.paused')
      : r.nextOn
        ? t('recurring.next', { date: dateOnly(locale, r.nextOn) })
        : t('recurring.ended');
  const columns: Column<RecurringExpense>[] = [
    {
      header: t('expenses.category'),
      cell: (r) => (
        <span className="flex items-center gap-2 font-medium">
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-sm"
            style={{ background: swatch(r.categoryId) }}
          />
          {name(r.categoryId)}
        </span>
      ),
    },
    { header: t('expenses.payee'), cell: (r) => r.payee ?? '—' },
    { header: t('recurring.cadence'), cell: (r) => scheduleText(r, t) },
    {
      header: t('recurring.active'),
      cell: (r) =>
        r.active ? (
          <span className="text-muted-foreground">{state(r)}</span>
        ) : (
          <span className="inline-flex h-[22px] items-center rounded-md bg-warning px-2 text-xs font-medium text-warning-foreground">
            {state(r)}
          </span>
        ),
    },
    { header: t('expenses.amount'), numeric: true, cell: (r) => priceOrDash(r.amount, locale) },
  ];
  return (
    <>
      {top(
        canWrite && (
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden />
            {t('recurring.new')}
          </Button>
        ),
      )}
      <Notice>{t('recurring.hint')}</Notice>
      <DataList
        label={t('expenses.tab.recurring')}
        items={list.data}
        rowKey={(r) => r.id}
        columns={columns}
        isPending={list.isPending}
        error={list.isError ? errorMessage(list.error, t) : undefined}
        onRetry={() => list.refetch()}
        empty={t('recurring.empty')}
        {...(canWrite ? { onOpen: (r: RecurringExpense) => setEditing(r) } : {})}
        menu={
          canWrite
            ? (r) => (
                <RowMenu label={name(r.categoryId)}>
                  <RowMenuItem onSelect={() => setEditing(r)}>
                    <SquarePen aria-hidden />
                    {t('recurring.edit')}
                  </RowMenuItem>
                  <RowMenuItem onSelect={() => pause.mutate({ id: r.id, active: !r.active })}>
                    {r.active ? <Pause aria-hidden /> : <Play aria-hidden />}
                    {r.active ? t('recurring.pause') : t('recurring.resume')}
                  </RowMenuItem>
                  <RowMenuSeparator />
                  <RowMenuItem danger onSelect={() => setDeleting(r)}>
                    <Trash2 aria-hidden />
                    {t('recurring.delete')}
                  </RowMenuItem>
                </RowMenu>
              )
            : undefined
        }
        card={(r) => (
          <div className="flex items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="font-medium">{name(r.categoryId)}</span>
              <span className="text-sm">{r.payee ?? '—'}</span>
              <span className="text-xs text-muted-foreground">
                {scheduleText(r, t)} · {state(r)}
              </span>
            </div>
            <span className="shrink-0 font-medium tabular-nums">
              {priceOrDash(r.amount, locale)}
            </span>
          </div>
        )}
      />
      {editing && (
        <RecurringSheet
          entry={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onDelete={editing === 'new' ? undefined : () => setDeleting(editing)}
        />
      )}
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(undefined)}
        title={t('recurring.delete')}
        confirmLabel={t('action.delete')}
        busy={remove.isPending}
        error={remove.isError ? saveErrorMessage(remove.error, t) : undefined}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      >
        <p>{t('recurring.deleteBody')}</p>
      </ConfirmDialog>
    </>
  );
}

function RecurringSheet({
  entry,
  onClose,
  onDelete,
}: {
  entry?: RecurringExpense | undefined;
  onClose: () => void;
  onDelete?: (() => void) | undefined;
}) {
  const { t } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [categoryId, setCategoryId] = useState(entry?.categoryId ?? '');
  const [amount, setAmount] = useState(priceInput(entry?.amount));
  const [method, setMethod] = useState<SpendMethod>(entry?.method ?? 'bank');
  const [payee, setPayee] = useState(entry?.payee ?? '');
  const [cadence, setCadence] = useState<'monthly' | 'weekly'>(entry?.cadence ?? 'monthly');
  const [day, setDay] = useState(entry?.day ?? 1);
  const [startsOn, setStartsOn] = useState(entry?.startsOn ?? dhakaToday());
  const [endsOn, setEndsOn] = useState(entry?.endsOn ?? '');
  const [active, setActive] = useState(entry?.active ?? true);
  const dayId = useId();
  const activeId = useId();
  const value = readPrice(amount);
  const valid =
    typeof value === 'number' &&
    value > 0 &&
    categoryId !== '' &&
    startsOn !== '' &&
    (!endsOn || endsOn >= startsOn);
  const save = useMutation({
    mutationFn: async () => {
      const fields = {
        categoryId,
        amount: value as number,
        method,
        payee: payee.trim() || null,
        cadence,
        day,
        startsOn,
        endsOn: endsOn || null,
        active,
      };
      return entry
        ? unwrap(
            await api.PATCH('/v1/admin/recurring-expenses/{id}', {
              params: { path: { id: entry.id } },
              body: fields,
            }),
          )
        : unwrap(await api.POST('/v1/admin/recurring-expenses', { body: fields }));
    },
    onSuccess: async () => {
      for (const k of EXPENSE_KEYS) await queryClient.invalidateQueries({ queryKey: k });
      toast(t('recurring.saved'));
      onClose();
    },
  });
  return (
    <Sheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={entry ? t('recurring.edit') : t('recurring.new')}
      description={t('recurring.newHint')}
    >
      <SheetForm
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) save.mutate();
        }}
      >
        <SheetBody>
          <CategorySelect value={categoryId} onChange={setCategoryId} />
          <Field
            label={t('expenses.amount')}
            inputMode="decimal"
            value={amount}
            required
            onChange={(e) => setAmount(e.target.value)}
          />
          <MethodChoice value={method} onChange={setMethod} />
          <Field
            label={optional(t('expenses.payee'), t)}
            value={payee}
            maxLength={200}
            onChange={(e) => setPayee(e.target.value)}
          />
          <Segmented
            legend={t('recurring.cadence')}
            options={[
              { value: 'monthly', label: t('recurring.monthly') },
              { value: 'weekly', label: t('recurring.weekly') },
            ]}
            value={cadence}
            onChange={(c) => {
              setCadence(c);
              setDay(1);
            }}
          />
          {cadence === 'monthly' ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={dayId} className="text-sm font-medium">
                {t('recurring.dayOfMonth')}
              </label>
              <select
                id={dayId}
                className={cn(control, 'min-h-10 md:min-h-9')}
                value={day}
                onChange={(e) => setDay(Number(e.target.value))}
              >
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
                <option value={0}>{t('recurring.lastDay')}</option>
              </select>
            </div>
          ) : (
            <ChoiceButtons
              legend={t('recurring.weekday')}
              options={([1, 2, 3, 4, 5, 6, 7] as const).map((d) => ({
                value: d,
                label: t(`recurring.weekday.${d}`),
              }))}
              value={day as 1 | 2 | 3 | 4 | 5 | 6 | 7}
              onChange={setDay}
            />
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field
              label={t('recurring.startsOn')}
              type="date"
              value={startsOn}
              onChange={(e) => setStartsOn(e.target.value)}
            />
            <Field
              label={optional(t('recurring.endsOn'), t)}
              type="date"
              value={endsOn}
              min={startsOn}
              onChange={(e) => setEndsOn(e.target.value)}
            />
          </div>
          {entry && (
            <div className="flex min-h-9 items-center justify-between gap-3">
              <label htmlFor={activeId} className="text-sm font-medium">
                {t('recurring.active')}
              </label>
              <Switch id={activeId} checked={active} onChange={setActive} />
            </div>
          )}
          {save.isError && <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>}
        </SheetBody>
        <SheetFooter
          start={onDelete && <SheetDelete onClick={onDelete}>{t('action.delete')}</SheetDelete>}
        >
          <Button variant="secondary" size="lg" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button type="submit" size="lg" disabled={!valid || save.isPending}>
            {entry ? t('action.save') : t('recurring.new')}
          </Button>
        </SheetFooter>
      </SheetForm>
    </Sheet>
  );
}

/** A setting that's on or off (design rule 3): a checkbox drawn as a switch. */
function Switch({
  id,
  checked,
  onChange,
}: {
  id: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <input
      id={id}
      type="checkbox"
      role="switch"
      aria-checked={checked}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="relative h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-full bg-input transition-colors before:absolute before:top-0.5 before:left-0.5 before:size-4 before:rounded-full before:bg-background before:shadow-sm before:transition-transform checked:bg-primary checked:before:translate-x-4"
    />
  );
}

function Categories({ top }: { top: Top }) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canWrite = usePermission('expenses.write');
  const list = useQuery(expenseCategoriesQuery);
  const swatch = useSwatch();
  const [editing, setEditing] = useState<ExpenseCategory | 'new' | null>(null);
  const archive = useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }) =>
      unwrap(
        await api.PATCH('/v1/admin/expense-categories/{id}', {
          params: { path: { id } },
          body: { archived },
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['expense-categories'] });
      toast(t('expenseCategories.saved'));
    },
    onError: (e) => toast(saveErrorMessage(e, t)),
  });
  return (
    <>
      {top(
        canWrite && (
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden />
            {t('expenseCategories.new')}
          </Button>
        ),
      )}
      <DataList
        label={t('expenses.tab.categories')}
        items={list.data}
        rowKey={(c) => c.id}
        isPending={list.isPending}
        error={list.isError ? errorMessage(list.error, t) : undefined}
        onRetry={() => list.refetch()}
        empty={t('expenseCategories.empty')}
        {...(canWrite ? { onOpen: (c: ExpenseCategory) => setEditing(c) } : {})}
        columns={[
          {
            header: t('expenseCategories.name'),
            cell: (c) => (
              <span className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-sm"
                  style={{ background: swatch(c.id) }}
                />
                <span className={cn('font-medium', c.archived && 'text-muted-foreground')}>
                  {c.name[locale]}
                </span>
                {c.archived && (
                  <span className="rounded-md border border-border px-1.5 text-xs font-medium text-muted-foreground">
                    {t('expenseCategories.archived')}
                  </span>
                )}
              </span>
            ),
          },
          {
            header: t(locale === 'bn' ? 'expenseCategories.nameEn' : 'expenseCategories.nameBn'),
            cell: (c) => (
              <span className="text-muted-foreground">{c.name[locale === 'bn' ? 'en' : 'bn']}</span>
            ),
          },
        ]}
        menu={
          canWrite
            ? (c) => (
                <RowMenu label={c.name[locale]}>
                  <RowMenuItem onSelect={() => setEditing(c)}>
                    <SquarePen aria-hidden />
                    {t('expenseCategories.edit')}
                  </RowMenuItem>
                  <RowMenuItem onSelect={() => archive.mutate({ id: c.id, archived: !c.archived })}>
                    {c.archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
                    {c.archived ? t('expenseCategories.restore') : t('expenseCategories.archive')}
                  </RowMenuItem>
                </RowMenu>
              )
            : undefined
        }
      />
      {editing && (
        <CategorySheet
          category={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onArchive={
            editing === 'new'
              ? undefined
              : () => {
                  archive.mutate({ id: editing.id, archived: !editing.archived });
                  setEditing(null);
                }
          }
        />
      )}
    </>
  );
}

/**
 * A category's two names in one field with বাংলা | English tabs (design
 * rule 2). The API needs both, so both tabs show and an empty one says Needed.
 */
function CategorySheet({
  category,
  onClose,
  onArchive,
}: {
  category?: ExpenseCategory | undefined;
  onClose: () => void;
  onArchive?: (() => void) | undefined;
}) {
  const { t } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [names, setNames] = useState({ bn: category?.name.bn ?? '', en: category?.name.en ?? '' });
  const [lang, setLang] = useState<'bn' | 'en'>('bn');
  const [tried, setTried] = useState(false);
  const fieldId = useId();
  const valid = names.bn.trim() !== '' && names.en.trim() !== '';
  const save = useMutation({
    mutationFn: async () => {
      const body = { name: { bn: names.bn.trim(), en: names.en.trim() } };
      return category
        ? unwrap(
            await api.PATCH('/v1/admin/expense-categories/{id}', {
              params: { path: { id: category.id } },
              body,
            }),
          )
        : unwrap(await api.POST('/v1/admin/expense-categories', { body }));
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['expense-categories'] });
      toast(t('expenseCategories.saved'));
      onClose();
    },
  });
  return (
    <Sheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={category ? t('expenseCategories.edit') : t('expenseCategories.new')}
      description={t('expenseCategories.newHint')}
    >
      <SheetForm
        onSubmit={(e) => {
          e.preventDefault();
          setTried(true);
          if (!valid) {
            setLang(names.bn.trim() ? 'en' : 'bn');
            return;
          }
          save.mutate();
        }}
      >
        <SheetBody>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor={fieldId} className="text-sm font-medium">
                {t('expenseCategories.name')}
              </label>
              <Segmented
                legend={t('list.language')}
                hideLegend
                options={(['bn', 'en'] as const).map((l) => ({
                  value: l,
                  label: `${l === 'bn' ? 'বাংলা' : 'English'}${names[l].trim() ? '' : ` · ${t('expenseCategories.needed')}`}`,
                }))}
                value={lang}
                onChange={setLang}
              />
            </div>
            <input
              id={fieldId}
              lang={lang}
              aria-invalid={tried && !names[lang].trim() ? true : undefined}
              aria-label={t(
                lang === 'bn' ? 'expenseCategories.nameBn' : 'expenseCategories.nameEn',
              )}
              className={cn(control, 'min-h-10 md:min-h-9')}
              value={names[lang]}
              maxLength={100}
              onChange={(e) => setNames({ ...names, [lang]: e.target.value })}
            />
            {tried && !valid && (
              <p role="alert" className="text-sm text-danger">
                {t('form.required')}
              </p>
            )}
          </div>
          {save.isError && <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>}
        </SheetBody>
        <SheetFooter
          start={
            onArchive && (
              <SheetDelete onClick={onArchive}>
                {category?.archived
                  ? t('expenseCategories.restore')
                  : t('expenseCategories.archive')}
              </SheetDelete>
            )
          }
        >
          <Button variant="secondary" size="lg" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button type="submit" size="lg" disabled={save.isPending}>
            {category ? t('action.save') : t('expenseCategories.new')}
          </Button>
        </SheetFooter>
      </SheetForm>
    </Sheet>
  );
}
