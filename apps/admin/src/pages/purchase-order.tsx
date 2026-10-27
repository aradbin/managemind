// A purchase order (phase-8-plan §3.2, §3.12): the editor for a new or open
// PO, with the variant picker, quantities, costs, other costs and totals,
// then Mark as ordered, Receive, Close, Cancel and the print view. The
// totals shown are a preview; the server computes the ones it keeps.
import { purchaseTotals } from '@managemind/shared/back-office';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ConfirmDialog } from '../components/confirm-dialog';
import { Field } from '../components/field';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { VariantPicker } from '../components/variant-picker';
import { useLocale } from '../i18n';
import '../i18n/orders';
import '../i18n/purchasing';
import { api, unwrap } from '../lib/api';
import { priceInput, readPrice } from '../lib/catalog';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import { dateOnly, type Localized, lineLabel } from '../lib/orders';
import {
  PURCHASING_KEYS,
  type PurchaseOrder,
  priceOrDash,
  purchaseOrderQuery,
  readCount,
  suppliersQuery,
} from '../lib/purchasing';

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
  const supplierName =
    order?.supplier.name ?? suppliers.data?.find((s) => s.id === supplierId)?.name ?? '';
  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader
        className="mb-0"
        parent={{ to: '/inventory/purchase-orders', label: t('po.title') }}
        title={title}
        description={
          order
            ? `${t(`po.status.${order.status}`)} · ${order.supplier.name} · ${t('po.created', { when: dateOnly(locale, order.createdAt) })}`
            : undefined
        }
        actions={
          order && (
            <>
              {canReceive &&
                (order.status === 'ordered' || order.status === 'partially_received') && (
                  <Button asChild>
                    <Link to="/inventory/receive" search={{ purchaseOrderId: order.id }}>
                      {t('po.receive')}
                    </Link>
                  </Button>
                )}
              {canWrite && order.actions.includes('place') && (
                <Button disabled={move.isPending} onClick={() => move.mutate('place')}>
                  {t('po.place')}
                </Button>
              )}
              <Button variant="secondary" asChild>
                <a href={`/print/purchase-order?id=${order.id}`} target="_blank" rel="noopener">
                  {t('po.print')}
                </a>
              </Button>
              {canWrite && order.actions.includes('close') && (
                <Button variant="secondary" onClick={() => setConfirm('close')}>
                  {t('po.close')}
                </Button>
              )}
              {canWrite && order.actions.includes('cancel') && order.status !== 'draft' && (
                <Button variant="quiet" onClick={() => setConfirm('cancel')}>
                  {t('po.cancel')}
                </Button>
              )}
              {canWrite && order.status === 'draft' && (
                <Button variant="quiet" onClick={() => setConfirm('delete')}>
                  {t('po.delete')}
                </Button>
              )}
            </>
          )
        }
      />
      {move.isError && <Notice tone="error">{saveErrorMessage(move.error, t)}</Notice>}

      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && editable) save.mutate();
        }}
      >
        <section className="grid gap-4 rounded-xl border border-border bg-background p-4 md:grid-cols-2">
          {editable && (!order || order.status === 'draft') ? (
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              {t('po.supplier')}
              <select
                className="min-h-11 rounded-md border border-input bg-background px-3"
                value={supplierId}
                required
                onChange={(e) => setSupplierId(e.target.value)}
              >
                <option value="">{t('po.chooseSupplier')}</option>
                {suppliers.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">{t('po.supplier')}</span>
              {order ? (
                <Link
                  to="/inventory/suppliers/$id"
                  params={{ id: order.supplier.id }}
                  className="text-primary hover:underline"
                >
                  {supplierName}
                </Link>
              ) : (
                supplierName
              )}
            </div>
          )}
          <Field
            label={`${t('po.expectedOn')} (${t('form.optional')})`}
            type="date"
            value={expectedOn}
            disabled={!editable}
            onChange={(e) => setExpectedOn(e.target.value)}
          />
          <Field
            label={`${t('po.supplierRef')} (${t('form.optional')})`}
            value={supplierRef}
            maxLength={100}
            disabled={!editable}
            onChange={(e) => setSupplierRef(e.target.value)}
          />
          <Field
            label={`${t('po.note')} (${t('form.optional')})`}
            value={note}
            maxLength={1000}
            disabled={!editable}
            onChange={(e) => setNote(e.target.value)}
          />
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">{t('po.lines')}</h2>
            {editable && supplierId && (
              <Button
                variant="secondary"
                disabled={addReorder.isPending}
                onClick={() => addReorder.mutate()}
              >
                {t('po.reorder')}
              </Button>
            )}
          </div>
          {addReorder.isError && <Notice tone="error">{errorMessage(addReorder.error, t)}</Notice>}
          {lines.length === 0 && <p className="text-muted-foreground">{t('po.noLines')}</p>}
          {lines.length > 0 && (
            <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-background">
              {lines.map((l, i) => {
                const label = lineLabel(l, locale);
                const p = parsed[i];
                return (
                  <li
                    key={l.variantId}
                    className="flex flex-col gap-3 p-4 md:flex-row md:items-end"
                  >
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="font-medium">{label}</span>
                      <span className="text-sm text-muted-foreground">
                        {[
                          l.sku,
                          order &&
                            t('po.progress', { received: l.receivedQuantity, ordered: l.quantity }),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </div>
                    <div className="flex items-end gap-2">
                      <div className="w-24">
                        <Field
                          label={t('po.ordered')}
                          inputMode="numeric"
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
                              lines.map((x, j) =>
                                j === i ? { ...x, quantity: e.target.value } : x,
                              ),
                            )
                          }
                        />
                      </div>
                      {seesCost && (
                        <div className="w-32">
                          <Field
                            label={t('po.unitCost')}
                            inputMode="decimal"
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
                        </div>
                      )}
                      {editable && l.receivedQuantity === 0 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t('po.remove', { item: label })}
                          onClick={() => setLines(lines.filter((_, j) => j !== i))}
                        >
                          <Trash2 aria-hidden className="size-5" />
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
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
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">{t('po.otherCosts')}</h2>
            <p className="text-sm text-muted-foreground">{t('po.otherCostsHint')}</p>
            {costs.map((c, i) => (
              <div key={i} className="flex items-end gap-2">
                <div className="flex-1">
                  <Field
                    label={t('po.costLabel')}
                    value={c.label}
                    maxLength={100}
                    disabled={!editable}
                    onChange={(e) =>
                      setCosts(costs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                    }
                  />
                </div>
                <div className="w-32">
                  <Field
                    label={t('payment.amount')}
                    inputMode="decimal"
                    value={c.amount}
                    disabled={!editable}
                    onChange={(e) =>
                      setCosts(
                        costs.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)),
                      )
                    }
                  />
                </div>
                {editable && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('po.remove', { item: c.label || t('po.otherCosts') })}
                    onClick={() => setCosts(costs.filter((_, j) => j !== i))}
                  >
                    <Trash2 aria-hidden className="size-5" />
                  </Button>
                )}
              </div>
            ))}
            {editable && costs.length < 10 && (
              <Button
                variant="secondary"
                className="self-start"
                onClick={() => setCosts([...costs, { label: '', amount: '' }])}
              >
                {t('po.addCost')}
              </Button>
            )}
            <dl className="ml-auto grid w-full max-w-xs grid-cols-2 gap-1 text-sm">
              <dt>{t('po.subtotal')}</dt>
              <dd className="text-right tabular-nums">{priceOrDash(totals.subtotal, locale)}</dd>
              <dt>{t('po.otherCosts')}</dt>
              <dd className="text-right tabular-nums">
                {priceOrDash(totals.otherCostTotal, locale)}
              </dd>
              <dt className="font-semibold">{t('po.total')}</dt>
              <dd className="text-right font-semibold tabular-nums">
                {priceOrDash(totals.total, locale)}
              </dd>
            </dl>
          </section>
        )}

        {order && order.receipts.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">{t('po.receipts')}</h2>
            <ul className="text-sm">
              {order.receipts.map((r) => (
                <li key={r.id}>
                  {r.reference} · {dateOnly(locale, r.receivedOn)}
                </li>
              ))}
            </ul>
          </section>
        )}

        {save.isError && <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>}
        {editable && (
          <div className="flex justify-end">
            <Button type="submit" disabled={!valid || save.isPending}>
              {order && order.status !== 'draft' ? t('action.save') : t('po.save')}
            </Button>
          </div>
        )}
      </form>

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
