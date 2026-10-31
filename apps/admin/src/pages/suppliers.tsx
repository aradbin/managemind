// Inventory → Suppliers (phase-8-plan §3.1, §3.12; ADR 0033): the list with
// what is owed to each, and the side panel to add or edit one. Balances show only to
// those who record payments (purchasing.pay).
import type { Locale } from '@managemind/shared/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { ClipboardList, FileText, FileUp, Plus, SquarePen } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type Column, DataList } from '../components/data-list';
import { ExportButtons } from '../components/export-buttons';
import { Field } from '../components/field';
import { RowMenu, RowMenuItem, SearchInput, StageTabs } from '../components/list-tools';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { Sheet, SheetBody, SheetFooter, SheetForm } from '../components/ui/sheet';
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
  const navigate = useNavigate();
  const canWrite = usePermission('purchasing.write');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState(false);
  const [panel, setPanel] = useState<{ supplier?: Supplier } | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text]);
  const list = useQuery(suppliersQuery({ q, archived }));
  const owes = list.data?.some((s) => s.balance !== undefined);
  const open = (s: Supplier) => navigate({ to: '/inventory/suppliers/$id', params: { id: s.id } });
  const phones = (s: Supplier) =>
    s.phones.length ? (
      <span className="flex items-center gap-1.5 whitespace-nowrap">
        <span className="font-mono text-muted-foreground">{s.phones[0]}</span>
        {s.phones.length > 1 && (
          <span className="rounded-md bg-muted px-1 text-xs font-medium">
            +{s.phones.length - 1}
          </span>
        )}
      </span>
    ) : (
      '—'
    );
  const balance = (s: Supplier) =>
    s.balance === undefined ? (
      '—'
    ) : (
      <span className={s.balance > 0 ? 'font-medium' : 'text-muted-foreground'}>
        {balanceText(s.balance, t, locale)}
      </span>
    );
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
    { header: t('suppliers.phone'), cell: phones },
    { header: t('suppliers.contactName'), wide: true, cell: (s) => s.contactName ?? '—' },
    ...(owes ? [{ header: t('suppliers.balance'), numeric: true, cell: balance }] : []),
  ];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        className="mb-0"
        title={t('suppliers.title')}
        description={t('suppliers.intro')}
        actions={
          <>
            {list.data && list.data.length > 0 && (
              <ExportButtons
                name="suppliers"
                what={t('suppliers.title')}
                head={[
                  t('suppliers.name'),
                  t('suppliers.phone'),
                  t('suppliers.contactName'),
                  ...(owes ? [t('suppliers.balance')] : []),
                ]}
                rows={() =>
                  (list.data ?? []).map((s) => [
                    s.name,
                    s.phones.join(', '),
                    s.contactName ?? '',
                    ...(owes ? [s.balance === undefined ? null : { money: s.balance }] : []),
                  ])
                }
              />
            )}
            {canWrite && (
              <Button variant="secondary" asChild>
                <Link to="/inventory/suppliers/import">
                  <FileUp aria-hidden />
                  {t('boImport.import')}
                </Link>
              </Button>
            )}
            {canWrite && (
              <Button onClick={() => setPanel({})}>
                <Plus aria-hidden />
                {t('suppliers.new')}
              </Button>
            )}
          </>
        }
      />
      <StageTabs
        label={t('suppliers.title')}
        tabs={[
          { key: 'active', label: t('suppliers.active') },
          { key: 'archived', label: t('suppliers.archived') },
        ]}
        value={archived ? 'archived' : 'active'}
        onChange={(key) => setArchived(key === 'archived')}
      />
      <SearchInput
        className="w-full md:w-64"
        label={t('suppliers.search')}
        value={text}
        onChange={setText}
      />
      <DataList
        label={t('suppliers.title')}
        items={list.data}
        rowKey={(s) => s.id}
        columns={columns}
        isPending={list.isPending}
        error={list.isError ? errorMessage(list.error, t) : undefined}
        onRetry={() => list.refetch()}
        empty={q ? t('suppliers.noMatches') : t('suppliers.empty')}
        emptyAction={
          q ? (
            <Button variant="secondary" onClick={() => setText('')}>
              {t('list.resetFilters')}
            </Button>
          ) : undefined
        }
        onOpen={open}
        menu={(s) => (
          <RowMenu label={s.name}>
            <RowMenuItem onSelect={() => open(s)}>
              <FileText aria-hidden />
              {t('list.open')}
            </RowMenuItem>
            {canWrite && (
              <RowMenuItem onSelect={() => setPanel({ supplier: s })}>
                <SquarePen aria-hidden />
                {t('suppliers.edit')}
              </RowMenuItem>
            )}
            {canWrite && !s.archived && (
              <RowMenuItem
                onSelect={() =>
                  navigate({ to: '/inventory/purchase-orders/new', search: { supplierId: s.id } })
                }
              >
                <ClipboardList aria-hidden />
                {t('suppliers.newPurchaseOrder')}
              </RowMenuItem>
            )}
          </RowMenu>
        )}
        card={(s) => (
          <div className="flex items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <Link to="/inventory/suppliers/$id" params={{ id: s.id }} className="font-medium">
                {s.name}
              </Link>
              <span className="text-xs text-muted-foreground">
                {[s.phones[0], s.contactName].filter(Boolean).join(' · ') || '—'}
              </span>
            </div>
            {owes && <span className="shrink-0 text-sm">{balance(s)}</span>}
          </div>
        )}
      />
      {panel && <SupplierDialog supplier={panel.supplier} onClose={() => setPanel(null)} />}
    </div>
  );
}

/** Adds a supplier, or edits one. */
export function SupplierDialog({
  supplier,
  onClose,
}: {
  supplier?: Supplier | undefined;
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
    <Sheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={supplier ? t('suppliers.edit') : t('suppliers.new')}
      description={supplier?.name}
    >
      <SheetForm
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) save.mutate();
        }}
      >
        <SheetBody>
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
        </SheetBody>
        <SheetFooter>
          <Button variant="secondary" size="lg" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button type="submit" size="lg" disabled={!valid || save.isPending}>
            {supplier ? t('action.save') : t('suppliers.new')}
          </Button>
        </SheetFooter>
      </SheetForm>
    </Sheet>
  );
}
