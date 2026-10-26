// Inventory → Suppliers (phase-8-plan §3.1, §3.12): the list with what is
// owed to each, and the form to add or edit one. Balances show only to
// those who record payments (purchasing.pay).
import type { Locale } from '@managemind/shared/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { CatalogNav } from '../components/catalog-nav';
import { type Column, DataList } from '../components/data-list';
import { Field } from '../components/field';
import { InventoryNav } from '../components/inventory-nav';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { useLocale } from '../i18n';
import '../i18n/purchasing';
import { api, unwrap } from '../lib/api';
import { priceInput, readPrice } from '../lib/catalog';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import { PURCHASING_KEYS, priceOrDash, type Supplier, suppliersQuery } from '../lib/purchasing';

/** "You owe ৳500", "Advance ৳200" or "Settled". */
export function balanceText(
  balance: number,
  t: ReturnType<typeof useLocale>['t'],
  locale: Locale,
): string {
  if (balance > 0) return t('suppliers.owed', { amount: priceOrDash(balance, locale) });
  if (balance < 0) return t('suppliers.advance', { amount: priceOrDash(-balance, locale) });
  return t('suppliers.settled');
}

export function SuppliersPage() {
  const { t, locale } = useLocale();
  const canWrite = usePermission('purchasing.write');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text]);
  const list = useQuery(suppliersQuery({ q, archived }));
  const columns: Column<Supplier>[] = [
    {
      header: t('suppliers.name'),
      cell: (s) => (
        <Link
          to="/inventory/suppliers/$id"
          params={{ id: s.id }}
          className="font-medium underline-offset-2 hover:underline"
        >
          {s.name}
        </Link>
      ),
    },
    { header: t('suppliers.phone'), cell: (s) => s.phones.join(', ') || '—' },
    { header: t('suppliers.contactName'), cell: (s) => s.contactName ?? '—' },
    ...(list.data?.some((s) => s.balance !== undefined)
      ? [
          {
            header: t('suppliers.balance'),
            cell: (s: Supplier) =>
              s.balance === undefined ? (
                '—'
              ) : (
                <span className={s.balance > 0 ? 'font-semibold' : undefined}>
                  {balanceText(s.balance, t, locale)}
                </span>
              ),
          },
        ]
      : []),
  ];
  return (
    <div className="max-w-6xl">
      <PageHeader
        title={t('suppliers.title')}
        description={t('suppliers.intro')}
        actions={
          canWrite && <Button onClick={() => setCreating(true)}>{t('suppliers.new')}</Button>
        }
      />
      <CatalogNav />
      <InventoryNav />
      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center">
        <Input
          type="search"
          aria-label={t('suppliers.search')}
          placeholder={t('suppliers.search')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="md:max-w-sm"
        />
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-5"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          {t('suppliers.showArchived')}
        </label>
      </div>
      <DataList
        label={t('suppliers.title')}
        items={list.data}
        rowKey={(s) => s.id}
        columns={columns}
        isPending={list.isPending}
        error={list.isError ? errorMessage(list.error, t) : undefined}
        onRetry={() => list.refetch()}
        empty={t('suppliers.empty')}
      />
      {creating && <SupplierDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

/** Adds a supplier, or edits one. */
export function SupplierDialog({
  supplier,
  onClose,
}: {
  supplier?: Supplier;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canPay = usePermission('purchasing.pay');
  const [name, setName] = useState(supplier?.name ?? '');
  const [contactName, setContactName] = useState(supplier?.contactName ?? '');
  const [phone, setPhone] = useState(supplier?.phones.join(', ') ?? '');
  const [email, setEmail] = useState(supplier?.email ?? '');
  const [address, setAddress] = useState(supplier?.address?.line1 ?? '');
  const [note, setNote] = useState(supplier?.note ?? '');
  const [opening, setOpening] = useState(priceInput(supplier?.openingBalance));
  const openingValue = readPrice(opening);
  const valid = name.trim() !== '' && openingValue !== undefined;
  const save = useMutation({
    mutationFn: async () => {
      const fields = {
        name: name.trim(),
        contactName: contactName.trim() || null,
        phones: phone
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean),
        email: email.trim() || null,
        address: address.trim() ? { line1: address.trim() } : null,
        note: note.trim() || null,
        ...(canPay ? { openingBalance: openingValue ?? 0 } : {}),
      };
      return supplier
        ? unwrap(
            await api.PATCH('/v1/admin/suppliers/{id}', {
              params: { path: { id: supplier.id } },
              body: fields,
            }),
          )
        : unwrap(await api.POST('/v1/admin/suppliers', { body: fields }));
    },
    onSuccess: async (saved) => {
      for (const key of PURCHASING_KEYS) await queryClient.invalidateQueries({ queryKey: key });
      toast(t('suppliers.saved'));
      onClose();
      if (!supplier) navigate({ to: '/inventory/suppliers/$id', params: { id: saved.id } });
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={supplier ? supplier.name : t('suppliers.new')}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) save.mutate();
        }}
      >
        <Field
          label={t('suppliers.name')}
          value={name}
          maxLength={200}
          required
          onChange={(e) => setName(e.target.value)}
        />
        <Field
          label={`${t('suppliers.contactName')} (${t('form.optional')})`}
          value={contactName}
          maxLength={200}
          onChange={(e) => setContactName(e.target.value)}
        />
        <Field
          label={`${t('suppliers.phone')} (${t('form.optional')})`}
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <Field
          label={`${t('suppliers.email')} (${t('form.optional')})`}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Field
          label={`${t('suppliers.address')} (${t('form.optional')})`}
          value={address}
          maxLength={200}
          onChange={(e) => setAddress(e.target.value)}
        />
        <Field
          label={`${t('suppliers.note')} (${t('form.optional')})`}
          value={note}
          maxLength={1000}
          onChange={(e) => setNote(e.target.value)}
        />
        {canPay && (
          <Field
            label={`${t('suppliers.openingBalance')} (${t('form.optional')})`}
            hint={t('suppliers.openingBalanceHint')}
            inputMode="decimal"
            value={opening}
            error={openingValue === undefined ? t('form.invalid') : undefined}
            onChange={(e) => setOpening(e.target.value)}
          />
        )}
        {save.isError && <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>}
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <Button variant="ghost" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button type="submit" disabled={!valid || save.isPending}>
            {t('action.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
