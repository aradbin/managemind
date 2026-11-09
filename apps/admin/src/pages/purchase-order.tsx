// A purchase order (phase-8-plan §3.2, §3.12): the editor for a new or open
// PO, with the variant picker, quantities, costs, other costs and totals,
// then Mark as ordered, Receive, Close, Cancel and the print view. The
// totals shown are a preview; the server computes the ones it keeps.
import { purchaseTotals } from '@managemind/shared/back-office';
import { formatNumber } from '@managemind/shared/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import {
  ChevronRight,
  CircleX,
  PackageCheck,
  PackageOpen,
  Plus,
  Printer,
  RefreshCw,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { ConfirmDialog } from '../components/confirm-dialog';
import { Field } from '../components/field';
import { fieldLabel } from '../components/field-styles';
import { RowMenu, RowMenuItem } from '../components/list-tools';
import { Notice } from '../components/notice';
import { BackLink } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { PhoneRecordHeader } from '../components/record-header';
import { SaveBar } from '../components/save-bar';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { cardPadded, cardTitle } from '../components/ui/card';
import { Combobox } from '../components/ui/combobox';
import { Input } from '../components/ui/input';
import { chipClass } from '../components/ui/segmented';
import { StatRow } from '../components/ui/stat-row';
import { VariantPicker } from '../components/variant-picker';
import { useLocale } from '../i18n';
import '../i18n/orders';
import '../i18n/purchasing';
import { DateField } from '../components/date-field';
import { api, unwrap } from '../lib/api';
import { priceInput, readPrice } from '../lib/catalog';
import { useRecordPage } from '../lib/crumb';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import { dateOnly, type Localized, lineLabel, pickText } from '../lib/orders';
import {
  PURCHASING_KEYS,
  type PurchaseOrder,
  priceOrDash,
  purchaseOrderQuery,
  readCount,
  suppliersQuery,
} from '../lib/purchasing';
import { cn } from '../lib/utils';
import { PoStatusChip } from './purchase-orders';

interface Line {
  variantId: string;
  title: Localized;
  optionLabels: Localized[];
  sku: string | null;
  quantity: string;
  unitCost: string;
  receivedQuantity: number;
}
interface Cost {
  label: string;
  amount: string;
}

export function PurchaseOrderPage() {
  const { t } = useLocale();
  const { id } = useParams({ strict: false }) as { id?: string };
  const order = useQuery({ ...purchaseOrderQuery(id ?? ''), enabled: Boolean(id) });
  if (!id) return <PurchaseOrderEditor />;
  if (order.isPending) return <p role="status">{t('loading')}</p>;
  if (order.isError) return <Notice tone="error">{errorMessage(order.error, t)}</Notice>;
  return <PurchaseOrderEditor key={order.data.updatedAt} order={order.data} />;
}

function PurchaseOrderEditor({ order }: { order?: PurchaseOrder }) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const search = useSearch({ strict: false }) as { supplierId?: string };
  const canWrite = usePermission('purchasing.write');
  const seesCost = usePermission('catalog.cost');
  const canReceive = usePermission('inventory.write');
  const editable =
    canWrite &&
    seesCost &&
    (!order || ['draft', 'ordered', 'partially_received'].includes(order.status));
  const suppliers = useQuery({ ...suppliersQuery(), enabled: editable });
  const [supplierId, setSupplierId] = useState(order?.supplier.id ?? search.supplierId ?? '');
  const supplierField = useId();
  const [expectedOn, setExpectedOn] = useState(order?.expectedOn ?? '');
  const [supplierRef, setSupplierRef] = useState(order?.supplierRef ?? '');
  const [note, setNote] = useState(order?.note ?? '');
  const [lines, setLines] = useState<Line[]>(
    order?.lines.map((l) => ({
      variantId: l.variantId,
      title: l.title,
      optionLabels: l.optionLabels,
      sku: l.sku,
      quantity: String(l.quantity),
      unitCost: priceInput(l.unitCost),
      receivedQuantity: l.receivedQuantity,
    })) ?? [],
  );
  const [costs, setCosts] = useState<Cost[]>(
    order?.otherCosts?.map((c) => ({ label: c.label, amount: priceInput(c.amount) })) ?? [],
  );
  const [confirm, setConfirm] = useState<'close' | 'cancel' | 'delete' | null>(null);
  const formId = useId();
  // What was last saved, to show the save bar only when something changed.
  const snapshot = JSON.stringify({ supplierId, expectedOn, supplierRef, note, lines, costs });
  const [base, setBase] = useState(snapshot);
  const dirty = snapshot !== base;
  useEffect(() => {
    if (!order) document.title = t('po.new');
  }, [order, t]);

  const parsed = lines.map((l) => ({
    quantity: readCount(l.quantity),
    unitCost: l.unitCost.trim() ? readPrice(l.unitCost) : null,
  }));
  const parsedCosts = costs.map((c) => ({ label: c.label.trim(), amount: readPrice(c.amount) }));
  const linesValid =
    lines.length > 0 &&
    parsed.every(
      (p, i) =>
        Number.isInteger(p.quantity) &&
        p.quantity >= Math.max(1, lines[i]?.receivedQuantity ?? 0) &&
        p.unitCost !== undefined,
    );
  const costsValid = parsedCosts.every(
    (c) => c.label && typeof c.amount === 'number' && c.amount > 0,
  );
  const valid = supplierId !== '' && linesValid && costsValid;
  const totals = purchaseTotals(
    parsed.map((p) => ({
      quantity: Number.isInteger(p.quantity) ? p.quantity : 0,
      unitCost: typeof p.unitCost === 'number' ? p.unitCost : 0,
    })),
    parsedCosts.map((c) => ({ amount: typeof c.amount === 'number' ? c.amount : 0 })),
  );

  const refresh = async () => {
    for (const key of PURCHASING_KEYS) await queryClient.invalidateQueries({ queryKey: key });
  };
  const save = useMutation({
    mutationFn: async () => {
      const body = {
        supplierId,
        expectedOn: expectedOn || null,
        supplierRef: supplierRef.trim() || null,
        note: note.trim() || null,
        lines: lines.map((l, i) => ({
          variantId: l.variantId,
          quantity: parsed[i]?.quantity as number,
          ...(typeof parsed[i]?.unitCost === 'number'
            ? { unitCost: parsed[i]?.unitCost as number }
            : {}),
        })),
        otherCosts: parsedCosts.map((c) => ({ label: c.label, amount: c.amount as number })),
      };
      return order
        ? unwrap(
            await api.PATCH('/v1/admin/purchase-orders/{id}', {
              params: { path: { id: order.id } },
              body: order.status === 'draft' ? body : (({ supplierId: _s, ...rest }) => rest)(body),
            }),
          )
        : unwrap(await api.POST('/v1/admin/purchase-orders', { body }));
    },
    onSuccess: async (saved) => {
      await refresh();
      setBase(snapshot);
      toast(t('po.saved'));
      if (!order) navigate({ to: '/inventory/purchase-orders/$id', params: { id: saved.id } });
    },
  });
  const move = useMutation({
    mutationFn: async (event: 'place' | 'close' | 'cancel') => {
      const path = {
        place: '/v1/admin/purchase-orders/{id}/place',
        close: '/v1/admin/purchase-orders/{id}/close',
        cancel: '/v1/admin/purchase-orders/{id}/cancel',
      } as const;
      return unwrap(await api.POST(path[event], { params: { path: { id: order?.id as string } } }));
    },
    onSuccess: async (_, event) => {
      await refresh();
      setConfirm(null);
      toast(t(event === 'place' ? 'po.placed' : event === 'close' ? 'po.closed' : 'po.cancelled'));
    },
  });
  const remove = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.DELETE('/v1/admin/purchase-orders/{id}', {
          params: { path: { id: order?.id as string } },
        }),
      ),
    onSuccess: async () => {
      await refresh();
      toast(t('po.deleted'));
      navigate({ to: '/inventory/purchase-orders' });
    },
  });
  const addReorder = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.GET('/v1/admin/purchase-orders/reorder', { params: { query: { supplierId } } }),
      ).items,
    onSuccess: (items) => {
      if (!items.length) {
        toast(t('po.reorderNone'));
        return;
      }
      setLines((current) => [
        ...current,
        ...items
          .filter((r) => !current.some((l) => l.variantId === r.variantId))
          .map((r) => ({
            variantId: r.variantId,
            title: r.title,
            optionLabels: r.optionLabels,
            sku: r.sku,
            quantity: String(r.quantity),
            unitCost: priceInput(r.unitCost),
            receivedQuantity: 0,
          })),
      ]);
    },
  });

  const title = order ? order.reference : t('po.new');
  useRecordPage(title);
  const supplierName =
    order?.supplier.name ?? suppliers.data?.find((s) => s.id === supplierId)?.name ?? '';
  const ordered = parsed.reduce((n, p) => n + (Number(p.quantity) || 0), 0);
  const received = lines.reduce((n, l) => n + l.receivedQuantity, 0);
  const canReceiveNow =
    canReceive && order && (order.status === 'ordered' || order.status === 'partially_received');
  const hasMore =
    canWrite &&
    order &&
    (order.actions.includes('close') ||
      (order.actions.includes('cancel') && order.status !== 'draft') ||
      order.status === 'draft');
  const menu = (trigger: 'outline' | 'ghost') =>
    hasMore && (
      <RowMenu label={t('list.moreActions')} trigger={trigger} page>
        {order.actions.includes('close') && (
          <RowMenuItem onSelect={() => setConfirm('close')}>
            <PackageCheck aria-hidden />
            {t('po.close')}
          </RowMenuItem>
        )}
        {order.actions.includes('cancel') && order.status !== 'draft' && (
          <RowMenuItem danger onSelect={() => setConfirm('cancel')}>
            <CircleX aria-hidden />
            {t('po.cancel')}
          </RowMenuItem>
        )}
        {order.status === 'draft' && (
          <RowMenuItem danger onSelect={() => setConfirm('delete')}>
            <Trash2 aria-hidden />
            {t('po.delete')}
          </RowMenuItem>
        )}
      </RowMenu>
    );
  const primary =
    canWrite && order?.actions.includes('place') ? (
      <Button disabled={move.isPending} onClick={() => move.mutate('place')}>
        <Send aria-hidden />
        {t('po.place')}
      </Button>
    ) : canReceiveNow ? (
      <Button asChild>
        <Link to="/inventory/receive" search={{ purchaseOrderId: order.id }}>
          <PackageOpen aria-hidden />
          {t('po.receive')}
        </Link>
      </Button>
    ) : null;
  const affix =
    'pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground';
  const grid =
    'grid grid-cols-[minmax(0,1fr)_72px_104px] items-center gap-x-2 md:grid-cols-[minmax(0,1fr)_80px_110px_96px_32px]';

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-3 pb-28 md:gap-4 md:pb-8">
      <PhoneRecordHeader to="/inventory/purchase-orders" backLabel={t('po.back')} title={title}>
        {menu('ghost')}
      </PhoneRecordHeader>
      <div className="flex flex-wrap items-center gap-3">
        <span className="max-md:hidden">
          <BackLink to="/inventory/purchase-orders" label={t('po.back')} />
        </span>
        <h1 className="truncate text-xl leading-7 font-semibold tracking-[-0.01em] max-md:hidden">
          {title}
        </h1>
        {order && <PoStatusChip status={order.status} />}
        <span className="flex-1" />
        {order && (
          <Button variant="secondary" asChild>
            <a href={`/print/purchase-order?id=${order.id}`} target="_blank" rel="noopener">
              <Printer aria-hidden />
              {t('po.print')}
            </a>
          </Button>
        )}
        {primary}
        <span className="max-md:hidden">{menu('outline')}</span>
      </div>
      {order && (
        <p className="-mt-2 text-muted-foreground">
          {[order.supplier.name, t('po.created', { when: dateOnly(locale, order.createdAt) })].join(
            ' · ',
          )}
        </p>
      )}
      {order && order.status !== 'draft' && (
        <StatRow
          stats={[
            {
              label: t('po.ordered'),
              value: t('po.units', { count: formatNumber(locale, ordered) }),
            },
            {
              label: t('po.receivedStat'),
              value: t('po.receivedOf', {
                received: formatNumber(locale, received),
                ordered: formatNumber(locale, ordered),
              }),
            },
            {
              label: t('po.toCome'),
              value: formatNumber(locale, Math.max(0, ordered - received)),
            },
            {
              label: t('po.expectedOn'),
              value: order.expectedOn ? dateOnly(locale, order.expectedOn) : '—',
            },
          ]}
        />
      )}
      {order && !editable && <Notice>{t('po.readOnly')}</Notice>}
      {move.isError && <Notice tone="error">{saveErrorMessage(move.error, t)}</Notice>}

      <form
        id={formId}
        className="contents"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && editable) save.mutate();
        }}
      >
        <section aria-labelledby="po-details" className={cardPadded}>
          <h2 id="po-details" className={cardTitle}>
            {t('po.details')}
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            {editable && (!order || order.status === 'draft') ? (
              <div className="flex flex-col">
                <label htmlFor={supplierField} className={fieldLabel}>
                  {t('po.supplier')}
                </label>
                <Combobox
                  id={supplierField}
                  searchLabel={t('po.findSupplier')}
                  placeholder={t('po.chooseSupplier')}
                  value={supplierId}
                  options={(suppliers.data ?? []).map((s) => ({
                    value: s.id,
                    label: s.name,
                    keywords: [s.contactName, ...s.phones].filter(Boolean).join(' '),
                  }))}
                  onChange={setSupplierId}
                />
              </div>
            ) : (
              <div className="flex flex-col">
                <span className={fieldLabel}>{t('po.supplier')}</span>
                {order ? (
                  <Link
                    to="/inventory/suppliers/$id"
                    params={{ id: order.supplier.id }}
                    className="flex h-10 items-center gap-2 rounded-lg border border-input bg-muted pr-2.5 pl-3 hover:bg-accent md:h-9"
                  >
                    <span className="min-w-0 flex-1 truncate">{supplierName}</span>
                    <ChevronRight aria-hidden className="size-4 opacity-50" />
                  </Link>
                ) : (
                  supplierName
                )}
              </div>
            )}
            <DateField
              label={t('po.expectedOn')}
              optional
              value={expectedOn}
              disabled={!editable}
              onChange={setExpectedOn}
            />
            <Field
              label={t('po.supplierRef')}
              optional
              placeholder={t('po.supplierRefExample')}
              value={supplierRef}
              maxLength={100}
              disabled={!editable}
              onChange={(e) => setSupplierRef(e.target.value)}
            />
            <Field
              label={t('po.note')}
              optional
              value={note}
              maxLength={1000}
              disabled={!editable}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </section>

        <section aria-labelledby="po-items" className={cardPadded}>
          <div className="flex min-h-5 items-center justify-between gap-3">
            <h2 id="po-items" className={cardTitle}>
              {t('po.lines')}
              {lines.length > 0 && (
                <span className="font-normal text-muted-foreground">
                  {' · '}
                  {t('po.itemCount', { count: formatNumber(locale, lines.length) })}
                </span>
              )}
            </h2>
            {editable && supplierId && (
              <Button
                variant="ghost"
                className="-my-1 -mr-2 h-7 px-2 md:h-7"
                disabled={addReorder.isPending}
                onClick={() => addReorder.mutate()}
              >
                <RefreshCw aria-hidden />
                {t('po.reorder')}
              </Button>
            )}
          </div>
          {addReorder.isError && <Notice tone="error">{errorMessage(addReorder.error, t)}</Notice>}
          {lines.length === 0 && (
            <p className="rounded-[10px] border border-dashed border-border p-4">
              {t('po.noLines')}
            </p>
          )}
          {lines.length > 0 && (
            <div className="overflow-hidden rounded-[10px] border border-border">
              <div
                aria-hidden
                className={cn(grid, 'h-9 bg-muted pr-2 pl-4 text-[13px] font-medium max-md:hidden')}
              >
                <span>{t('po.item')}</span>
                <span className="text-right">{t('po.ordered')}</span>
                <span className="text-right">{t('po.unitCost')}</span>
                <span className="text-right">{t('po.total')}</span>
                <span />
              </div>
              <ul aria-label={t('po.lines')}>
                {lines.map((l, i) => {
                  const p = parsed[i];
                  const title = pickText(l.title, locale);
                  const options = l.optionLabels
                    .map((o) => pickText(o, locale))
                    .filter(Boolean)
                    .join(' / ');
                  const lineTotal =
                    Number.isInteger(p?.quantity) && typeof p?.unitCost === 'number'
                      ? (p.quantity as number) * p.unitCost
                      : null;
                  return (
                    <li
                      key={l.variantId}
                      className={cn(grid, 'min-h-14 border-t border-border py-2 pr-2 pl-4')}
                    >
                      <span className="flex min-w-0 flex-col max-md:col-span-3">
                        <span id={`po-line-${i}`} className="truncate font-medium">
                          {title}
                        </span>
                        {options && (
                          <span className="truncate text-[13px] text-muted-foreground">
                            {options}
                          </span>
                        )}
                        <span className="truncate text-xs text-muted-foreground">
                          {[
                            l.sku,
                            order &&
                              t('po.progress', {
                                received: l.receivedQuantity,
                                ordered: l.quantity,
                              }),
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                      <Input
                        inputMode="numeric"
                        aria-label={t('po.ordered')}
                        aria-describedby={`po-line-${i}`}
                        className="h-8 text-right tabular-nums md:h-8"
                        value={l.quantity}
                        disabled={!editable}
                        aria-invalid={
                          !Number.isInteger(p?.quantity) ||
                          (p?.quantity ?? 0) < Math.max(1, l.receivedQuantity)
                            ? true
                            : undefined
                        }
                        onChange={(e) =>
                          setLines(
                            lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)),
                          )
                        }
                      />
                      {seesCost ? (
                        <span className="relative block">
                          <span aria-hidden className={affix}>
                            ৳
                          </span>
                          <Input
                            inputMode="decimal"
                            aria-label={t('po.unitCost')}
                            aria-describedby={`po-line-${i}`}
                            className="h-8 pl-6 text-right tabular-nums md:h-8"
                            value={l.unitCost}
                            disabled={!editable}
                            aria-invalid={p?.unitCost === undefined ? true : undefined}
                            onChange={(e) =>
                              setLines(
                                lines.map((x, j) =>
                                  j === i ? { ...x, unitCost: e.target.value } : x,
                                ),
                              )
                            }
                          />
                        </span>
                      ) : (
                        <span />
                      )}
                      <span className="text-right font-medium tabular-nums max-md:hidden">
                        {lineTotal === null ? '—' : priceOrDash(lineTotal, locale)}
                      </span>
                      <span className="flex justify-end max-md:hidden">
                        {editable && l.receivedQuantity === 0 && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 md:size-8"
                            aria-label={t('po.remove', { item: lineLabel(l, locale) })}
                            onClick={() => setLines(lines.filter((_, j) => j !== i))}
                          >
                            <X aria-hidden className="size-4" />
                          </Button>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {editable && (
            <VariantPicker
              anyStock
              onPick={(row) => {
                if (lines.some((l) => l.variantId === row.variantId)) return;
                setLines([
                  ...lines,
                  {
                    variantId: row.variantId,
                    title: row.titles,
                    optionLabels: row.optionLabels,
                    sku: row.sku,
                    quantity: '1',
                    unitCost: '',
                    receivedQuantity: 0,
                  },
                ]);
              }}
            />
          )}
        </section>

        {seesCost && (
          <section aria-labelledby="po-costs" className={cardPadded}>
            <div className="flex flex-col gap-1">
              <h2 id="po-costs" className={cardTitle}>
                {t('po.otherCosts')}
              </h2>
              <p className="text-[13px] text-muted-foreground">{t('po.otherCostsHint')}</p>
            </div>
            {costs.map((c, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_140px_32px] items-center gap-2">
                <Input
                  aria-label={t('po.costLabel')}
                  placeholder={t('po.costExample')}
                  value={c.label}
                  maxLength={100}
                  disabled={!editable}
                  onChange={(e) =>
                    setCosts(costs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                  }
                />
                <span className="relative block">
                  <span aria-hidden className={affix}>
                    ৳
                  </span>
                  <Input
                    inputMode="decimal"
                    aria-label={t('payment.amount')}
                    className="pl-6 text-right tabular-nums"
                    value={c.amount}
                    disabled={!editable}
                    onChange={(e) =>
                      setCosts(
                        costs.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)),
                      )
                    }
                  />
                </span>
                {editable ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 md:size-8"
                    aria-label={t('po.remove', { item: c.label || t('po.otherCosts') })}
                    onClick={() => setCosts(costs.filter((_, j) => j !== i))}
                  >
                    <X aria-hidden className="size-4" />
                  </Button>
                ) : (
                  <span />
                )}
              </div>
            ))}
            {editable && costs.length < 10 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  variant="secondary"
                  className="h-8 md:h-8"
                  onClick={() => setCosts([...costs, { label: '', amount: '' }])}
                >
                  <Plus aria-hidden />
                  {t('po.addCost')}
                </Button>
                {costs.length === 0 &&
                  (['po.cost.transport', 'po.cost.labour', 'po.cost.agent'] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      className={chipClass}
                      onClick={() => setCosts([{ label: t(k), amount: '' }])}
                    >
                      {t(k)}
                    </button>
                  ))}
              </div>
            )}
            <dl className="flex w-full flex-col gap-1.5 self-end md:w-[280px]">
              <div className="flex justify-between gap-3 tabular-nums">
                <dt className="text-muted-foreground">{t('po.subtotal')}</dt>
                <dd>{priceOrDash(totals.subtotal, locale)}</dd>
              </div>
              <div className="flex justify-between gap-3 tabular-nums">
                <dt className="text-muted-foreground">{t('po.otherCosts')}</dt>
                <dd>{priceOrDash(totals.otherCostTotal, locale)}</dd>
              </div>
              <div className="mt-1 flex justify-between gap-3 border-t border-border pt-2.5 font-semibold tabular-nums">
                <dt>{t('po.total')}</dt>
                <dd>{priceOrDash(totals.total, locale)}</dd>
              </div>
            </dl>
          </section>
        )}

        {order && order.receipts.length > 0 && (
          <section aria-labelledby="po-receipts" className={cn(cardPadded, 'gap-2 md:gap-2')}>
            <h2 id="po-receipts" className={cardTitle}>
              {t('po.receipts')}
            </h2>
            <ul className="flex flex-col">
              {order.receipts.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-col gap-0.5 border-b border-border py-2.5 last:border-b-0"
                >
                  <span className="font-mono font-medium">{r.reference}</span>
                  <span className="text-[13px] text-muted-foreground">
                    {dateOnly(locale, r.receivedOn)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {save.isError && <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>}
      </form>
      <SaveBar
        show={editable && (!order || dirty)}
        message={order ? t('po.unsaved') : undefined}
        discardLabel={t('action.cancel')}
        onDiscard={() => {
          if (!order) navigate({ to: '/inventory/purchase-orders' });
          else window.location.reload();
        }}
        saveLabel={order && order.status !== 'draft' ? t('action.save') : t('po.save')}
        busy={save.isPending}
        saveDisabled={!valid}
        form={formId}
      />

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={
          confirm === 'close'
            ? t('po.close')
            : confirm === 'cancel'
              ? t('po.cancel')
              : t('po.delete')
        }
        confirmLabel={
          confirm === 'close'
            ? t('po.close')
            : confirm === 'cancel'
              ? t('po.cancel')
              : t('action.delete')
        }
        busy={move.isPending || remove.isPending}
        error={
          move.isError
            ? saveErrorMessage(move.error, t)
            : remove.isError
              ? saveErrorMessage(remove.error, t)
              : undefined
        }
        onConfirm={() => {
          if (confirm === 'delete') remove.mutate();
          else if (confirm) move.mutate(confirm);
        }}
      >
        {confirm === 'close' && <p>{t('po.closeBody')}</p>}
        {confirm === 'cancel' && <p>{t('po.cancelBody')}</p>}
      </ConfirmDialog>
    </div>
  );
}
