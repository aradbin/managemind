// Expenses (phase-8-plan §3.6, §3.12): a month at a time with its category
// totals, the form with an optional receipt photo, recurring entries and the
// categories. Viewers read; owners and managers write (Q12).
import type { Locale } from '@managemind/shared/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog } from '../components/confirm-dialog';
import { type Column, DataList } from '../components/data-list';
import { ExportButtons } from '../components/export-buttons';
import { Field } from '../components/field';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
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

export interface ExpensesSearch {
  tab?: 'recurring' | 'categories' | undefined;
  month?: string | undefined;
}

const categoryName = (
  categories: readonly ExpenseCategory[] | undefined,
  id: string,
  locale: Locale,
) => categories?.find((c) => c.id === id)?.name[locale] ?? '—';

export function ExpensesPage() {
  const { t } = useLocale();
  const search = useSearch({ strict: false }) as ExpensesSearch;
  const navigate = useNavigate();
  const tab = search.tab ?? 'entries';
  const tabs = [
    ['entries', 'expenses.tab.entries'],
    ['recurring', 'expenses.tab.recurring'],
    ['categories', 'expenses.tab.categories'],
  ] as const;
  return (
    <div className="max-w-5xl">
      <PageHeader title={t('expenses.title')} description={t('expenses.intro')} />
      <nav aria-label={t('expenses.title')} className="-mx-4 mb-4 overflow-x-auto px-4">
        <ul className="flex min-w-max gap-2">
          {tabs.map(([key, label]) => (
            <li key={key}>
              <button
                type="button"
                aria-current={tab === key ? 'page' : undefined}
                onClick={() =>
                  navigate({
                    to: '/expenses',
                    search: { ...search, tab: key === 'entries' ? undefined : key },
                  })
                }
                className={
                  tab === key
                    ? 'flex min-h-10 items-center rounded-full border border-primary bg-primary-soft px-4 text-sm font-semibold text-primary'
                    : 'flex min-h-10 items-center rounded-full border border-input bg-background px-4 text-sm font-medium text-muted-foreground hover:text-foreground'
                }
              >
                {t(label)}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      {tab === 'entries' && <Entries month={search.month ?? thisMonth()} />}
      {tab === 'recurring' && <Recurring />}
      {tab === 'categories' && <Categories />}
    </div>
  );
}

function Entries({ month }: { month: string }) {
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const canWrite = usePermission('expenses.write');
  const categories = useQuery(expenseCategoriesQuery);
  const range = monthRange(month);
  const list = useQuery({
    queryKey: ['expenses', range] as const,
    queryFn: async () =>
      unwrap(await api.GET('/v1/admin/expenses', { params: { query: { ...range, limit: 200 } } })),
  });
  const [editing, setEditing] = useState<Expense | 'new' | null>(null);
  const go = (by: number) =>
    navigate({ to: '/expenses', search: { month: shiftMonth(month, by) } });
  const label = new Intl.DateTimeFormat(locale === 'bn' ? 'bn-BD' : 'en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T00:00:00Z`));
  const columns: Column<Expense>[] = [
    { header: t('expenses.date'), cell: (e) => dateOnly(locale, e.spentOn) },
    {
      header: t('expenses.category'),
      cell: (e) => (
        <button
          type="button"
          className="text-left font-medium underline-offset-2 hover:underline disabled:no-underline"
          disabled={!canWrite}
          onClick={() => setEditing(e)}
        >
          {categoryName(categories.data, e.categoryId, locale)}
          {e.recurringExpenseId && (
            <span className="ml-2 text-xs text-muted-foreground">
              {t('expenses.fromRecurring')}
            </span>
          )}
        </button>
      ),
    },
    { header: t('expenses.payee'), cell: (e) => e.payee ?? '—' },
    { header: t('expenses.method'), cell: (e) => t(`purchasing.method.${e.method}`) },
    {
      header: t('expenses.receipt'),
      cell: (e) =>
        e.hasReceipt ? (
          <a
            href={`/api/admin/expenses/${e.id}/receipt`}
            target="_blank"
            rel="noopener"
            className="text-primary hover:underline"
          >
            {t('expenses.receiptView')}
          </a>
        ) : (
          '—'
        ),
    },
    {
      header: t('expenses.amount'),
      cell: (e) => <span className="tabular-nums">{priceOrDash(e.amount, locale)}</span>,
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('expenses.previous')}
          onClick={() => go(-1)}
        >
          <ChevronLeft aria-hidden className="size-5" />
        </Button>
        <h2 className="min-w-40 text-center text-lg font-semibold">{label}</h2>
        <Button variant="ghost" size="icon" aria-label={t('expenses.next')} onClick={() => go(1)}>
          <ChevronRight aria-hidden className="size-5" />
        </Button>
        <div className="ml-auto flex flex-wrap gap-2">
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
                  categoryName(categories.data, e.categoryId, locale),
                  e.payee ?? '',
                  t(`purchasing.method.${e.method}`),
                  e.note ?? '',
                  { money: e.amount },
                ])
              }
            />
          )}
          {canWrite && <Button onClick={() => setEditing('new')}>{t('expenses.new')}</Button>}
        </div>
      </div>
      {list.data && list.data.totals.count > 0 && (
        <section className="flex flex-col gap-2 rounded-xl border border-border bg-background p-4">
          <p className="text-lg font-semibold">
            {t('expenses.total', { amount: priceOrDash(list.data.totals.total, locale) })}
          </p>
          <ul className="grid gap-1 text-sm md:grid-cols-2">
            {list.data.totals.byCategory.map((c) => (
              <li key={c.categoryId} className="flex justify-between gap-4">
                <span>{categoryName(categories.data, c.categoryId, locale)}</span>
                <span className="tabular-nums">{priceOrDash(c.amount, locale)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <DataList
        label={t('expenses.title')}
        items={list.data?.items}
        rowKey={(e) => e.id}
        columns={columns}
        isPending={list.isPending}
        error={list.isError ? errorMessage(list.error, t) : undefined}
        onRetry={() => list.refetch()}
        empty={t('expenses.empty')}
      />
      {editing && (
        <ExpenseDialog
          expense={editing === 'new' ? undefined : editing}
          defaultDate={month === thisMonth() ? dhakaToday() : monthRange(month).to}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
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
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-sm font-medium">{t('expenses.method')}</legend>
      <div className="flex flex-wrap gap-x-4">
        {SPEND_METHODS.map((m) => (
          <label key={m} className="flex min-h-11 items-center gap-2">
            <input
              type="radio"
              name="method"
              className="size-5"
              checked={value === m}
              onChange={() => onChange(m)}
            />
            {t(`purchasing.method.${m}`)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function CategorySelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { t, locale } = useLocale();
  const categories = useQuery(expenseCategoriesQuery);
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium">
      {t('expenses.category')}
      <select
        className="min-h-11 rounded-md border border-input bg-background px-3"
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
    </label>
  );
}

function ExpenseDialog({
  expense,
  defaultDate,
  onClose,
}: {
  expense?: Expense | undefined;
  defaultDate: string;
  onClose: () => void;
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [key] = useState(idempotencyKey);
  const value = readPrice(amount);
  const valid = typeof value === 'number' && value > 0 && categoryId !== '' && spentOn !== '';
  const refresh = async () => {
    for (const k of EXPENSE_KEYS) await queryClient.invalidateQueries({ queryKey: k });
  };
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
      await refresh();
      toast(photoFailed ? t('expenses.receiptFailed') : t('expenses.saved'));
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.DELETE('/v1/admin/expenses/{id}', {
          params: { path: { id: expense?.id as string } },
        }),
      ),
    onSuccess: async () => {
      await refresh();
      toast(t('expenses.deleted'));
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={expense ? t('expenses.edit') : t('expenses.new')}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) save.mutate();
        }}
      >
        <Field
          label={t('expenses.date')}
          type="date"
          value={spentOn}
          onChange={(e) => setSpentOn(e.target.value)}
        />
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
          label={`${t('expenses.payee')} (${t('form.optional')})`}
          value={payee}
          maxLength={200}
          onChange={(e) => setPayee(e.target.value)}
        />
        <Field
          label={`${t('expenses.note')} (${t('form.optional')})`}
          value={note}
          maxLength={1000}
          onChange={(e) => setNote(e.target.value)}
        />
        <Field
          label={`${expense?.hasReceipt ? t('expenses.receiptReplace') : t('expenses.receiptAdd')} (${t('form.optional')})`}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
        />
        {expense?.hasReceipt && !photo && (
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-5"
              checked={removePhoto}
              onChange={(e) => setRemovePhoto(e.target.checked)}
            />
            {t('expenses.receiptRemove')}
          </label>
        )}
        {save.isError && <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>}
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          {expense && (
            <Button variant="quiet" className="md:mr-auto" onClick={() => setConfirmDelete(true)}>
              {t('expenses.delete')}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button type="submit" disabled={!valid || save.isPending}>
            {t('action.save')}
          </Button>
        </div>
      </form>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('expenses.delete')}
        confirmLabel={t('action.delete')}
        busy={remove.isPending}
        error={remove.isError ? saveErrorMessage(remove.error, t) : undefined}
        onConfirm={() => remove.mutate()}
      >
        <p>{t('expenses.deleteBody')}</p>
      </ConfirmDialog>
    </Dialog>
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

function Recurring() {
  const { t, locale } = useLocale();
  const canWrite = usePermission('expenses.write');
  const categories = useQuery(expenseCategoriesQuery);
  const list = useQuery(recurringExpensesQuery);
  const [editing, setEditing] = useState<RecurringExpense | 'new' | null>(null);
  const columns: Column<RecurringExpense>[] = [
    {
      header: t('expenses.category'),
      cell: (r) => (
        <button
          type="button"
          className="text-left font-medium underline-offset-2 hover:underline disabled:no-underline"
          disabled={!canWrite}
          onClick={() => setEditing(r)}
        >
          {categoryName(categories.data, r.categoryId, locale)}
        </button>
      ),
    },
    { header: t('expenses.payee'), cell: (r) => r.payee ?? '—' },
    { header: t('recurring.cadence'), cell: (r) => scheduleText(r, t) },
    {
      header: t('recurring.active'),
      cell: (r) =>
        !r.active
          ? t('recurring.paused')
          : r.nextOn
            ? t('recurring.next', { date: dateOnly(locale, r.nextOn) })
            : t('recurring.ended'),
    },
    {
      header: t('expenses.amount'),
      cell: (r) => <span className="tabular-nums">{priceOrDash(r.amount, locale)}</span>,
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-muted-foreground">{t('recurring.hint')}</p>
        {canWrite && (
          <Button className="ml-auto" onClick={() => setEditing('new')}>
            {t('recurring.new')}
          </Button>
        )}
      </div>
      <DataList
        label={t('expenses.tab.recurring')}
        items={list.data}
        rowKey={(r) => r.id}
        columns={columns}
        isPending={list.isPending}
        error={list.isError ? errorMessage(list.error, t) : undefined}
        onRetry={() => list.refetch()}
        empty={t('recurring.empty')}
      />
      {editing && (
        <RecurringDialog
          entry={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function RecurringDialog({
  entry,
  onClose,
}: {
  entry?: RecurringExpense | undefined;
  onClose: () => void;
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const value = readPrice(amount);
  const valid =
    typeof value === 'number' &&
    value > 0 &&
    categoryId !== '' &&
    startsOn !== '' &&
    (!endsOn || endsOn >= startsOn);
  const refresh = async () => {
    for (const k of EXPENSE_KEYS) await queryClient.invalidateQueries({ queryKey: k });
  };
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
      await refresh();
      toast(t('recurring.saved'));
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.DELETE('/v1/admin/recurring-expenses/{id}', {
          params: { path: { id: entry?.id as string } },
        }),
      ),
    onSuccess: async () => {
      await refresh();
      toast(t('recurring.deleted'));
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={entry ? t('recurring.edit') : t('recurring.new')}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) save.mutate();
        }}
      >
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
          label={`${t('expenses.payee')} (${t('form.optional')})`}
          value={payee}
          maxLength={200}
          onChange={(e) => setPayee(e.target.value)}
        />
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-medium">{t('recurring.cadence')}</legend>
          {(['monthly', 'weekly'] as const).map((c) => (
            <label key={c} className="flex min-h-11 items-center gap-2">
              <input
                type="radio"
                name="cadence"
                className="size-5"
                checked={cadence === c}
                onChange={() => {
                  setCadence(c);
                  setDay(1);
                }}
              />
              {t(c === 'monthly' ? 'recurring.monthly' : 'recurring.weekly')}
            </label>
          ))}
        </fieldset>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {cadence === 'monthly' ? t('recurring.dayOfMonth') : t('recurring.weekday')}
          <select
            className="min-h-11 rounded-md border border-input bg-background px-3"
            value={day}
            onChange={(e) => setDay(Number(e.target.value))}
          >
            {cadence === 'monthly' ? (
              <>
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
                <option value={0}>{t('recurring.lastDay')}</option>
              </>
            ) : (
              ([1, 2, 3, 4, 5, 6, 7] as const).map((d) => (
                <option key={d} value={d}>
                  {t(`recurring.weekday.${d}`)}
                </option>
              ))
            )}
          </select>
        </label>
        <Field
          label={t('recurring.startsOn')}
          type="date"
          value={startsOn}
          onChange={(e) => setStartsOn(e.target.value)}
        />
        <Field
          label={`${t('recurring.endsOn')} (${t('form.optional')})`}
          type="date"
          value={endsOn}
          min={startsOn}
          onChange={(e) => setEndsOn(e.target.value)}
        />
        {entry && (
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              className="size-5"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            {t('recurring.active')}
          </label>
        )}
        <p className="text-sm text-muted-foreground">{t('recurring.hint')}</p>
        {save.isError && <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>}
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          {entry && (
            <Button variant="quiet" className="md:mr-auto" onClick={() => setConfirmDelete(true)}>
              {t('recurring.delete')}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button type="submit" disabled={!valid || save.isPending}>
            {t('action.save')}
          </Button>
        </div>
      </form>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('recurring.delete')}
        confirmLabel={t('action.delete')}
        busy={remove.isPending}
        error={remove.isError ? saveErrorMessage(remove.error, t) : undefined}
        onConfirm={() => remove.mutate()}
      >
        <p>{t('recurring.deleteBody')}</p>
      </ConfirmDialog>
    </Dialog>
  );
}

function Categories() {
  const { t, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canWrite = usePermission('expenses.write');
  const list = useQuery(expenseCategoriesQuery);
  const [bn, setBn] = useState('');
  const [en, setEn] = useState('');
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['expense-categories'] });
  const create = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST('/v1/admin/expense-categories', {
          body: { name: { bn: bn.trim(), en: en.trim() } },
        }),
      ),
    onSuccess: async () => {
      await refresh();
      setBn('');
      setEn('');
      toast(t('expenseCategories.saved'));
    },
  });
  const archive = useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }) =>
      unwrap(
        await api.PATCH('/v1/admin/expense-categories/{id}', {
          params: { path: { id } },
          body: { archived },
        }),
      ),
    onSuccess: refresh,
  });
  return (
    <div className="flex flex-col gap-4">
      {list.isError && <Notice tone="error">{errorMessage(list.error, t)}</Notice>}
      <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-background">
        {list.data?.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-3 p-3">
            <span className="flex-1">
              {c.name[locale]}
              {c.archived && (
                <span className="ml-2 text-sm text-muted-foreground">
                  {t('expenseCategories.archived')}
                </span>
              )}
            </span>
            {canWrite && (
              <Button
                variant="ghost"
                disabled={archive.isPending}
                onClick={() => archive.mutate({ id: c.id, archived: !c.archived })}
              >
                {c.archived ? t('expenseCategories.restore') : t('expenseCategories.archive')}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {canWrite && (
        <form
          className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 md:flex-row md:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (bn.trim() && en.trim()) create.mutate();
          }}
        >
          <div className="flex-1">
            <Field
              label={t('expenseCategories.nameBn')}
              value={bn}
              maxLength={100}
              onChange={(e) => setBn(e.target.value)}
            />
          </div>
          <div className="flex-1">
            <Field
              label={t('expenseCategories.nameEn')}
              value={en}
              maxLength={100}
              onChange={(e) => setEn(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={!bn.trim() || !en.trim() || create.isPending}>
            {t('expenseCategories.new')}
          </Button>
        </form>
      )}
      {create.isError && <Notice tone="error">{saveErrorMessage(create.error, t)}</Notice>}
    </div>
  );
}
