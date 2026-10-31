// The promotion builder (phase-4-plan §3.13, §7): the action and conditions
// as a guided form, the plain-language summary as it is built, the test
// cart (which promotions a cart gets, and why the others don't, with this
// one tried as if live), and, for code promotions, batches of unique codes.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { X } from 'lucide-react';
import { type ReactNode, useEffect, useId, useState } from 'react';
import { Field } from '../components/field';
import { ItemSelection, useSelectionNames } from '../components/item-selection';
import { Notice } from '../components/notice';
import { BackLink } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { emptyPlace, type PlaceDraft, PlacePicker } from '../components/place-picker';
import { SaveBar } from '../components/save-bar';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { VariantPicker } from '../components/variant-picker';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/orders';
import '../i18n/promotions';
import { api, unwrap } from '../lib/api';
import { formatPrice } from '../lib/catalog';
import { errorMessage } from '../lib/errors';
import { lineLabel, orderErrorMessage, pickText, zonesQuery } from '../lib/orders';
import {
  ACTION_TYPES,
  type Draft,
  type DraftProblem,
  fromPromotion,
  newDraft,
  type Promotion,
  promotionQuery,
  summarize,
  toInput,
} from '../lib/promotions';
import { download, toCsv } from './export';
import { StateChip } from './promotions';

const section = 'flex flex-col gap-3 rounded-xl border border-border bg-background p-4 md:p-5';
const selectClass =
  'w-full min-h-10 rounded-lg border border-input bg-background px-3 text-base shadow-xs md:min-h-9 md:text-sm font-normal';

export function NewPromotionPage() {
  return <Editor promotion={undefined} />;
}

export function PromotionPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const { t } = useLocale();
  const promotion = useQuery(promotionQuery(id));
  if (promotion.isPending) return <p role="status">{t('loading')}</p>;
  if (promotion.isError) return <Notice tone="error">{errorMessage(promotion.error, t)}</Notice>;
  return <Editor key={promotion.data.updatedAt} promotion={promotion.data} />;
}

function Editor({ promotion }: { promotion: Promotion | undefined }) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canWrite = usePermission('promotions.write');
  const zones = useQuery(zonesQuery);
  const [d, setD] = useState<Draft>(() => (promotion ? fromPromotion(promotion) : newDraft()));
  // What was last saved, to tell whether anything changed since.
  const [saved, setSaved] = useState<Draft>(d);
  const changed = JSON.stringify(d) !== JSON.stringify(saved);
  const formId = useId();
  const [showProblems, setShowProblems] = useState(false);
  const set = (patch: Partial<Draft>) => setD((prev) => ({ ...prev, ...patch }));
  const built = toInput(d);
  const names = useSelectionNames([d.target, d.buyItems, d.getItems, d.items]);
  const zoneNames = (ids: string[]) =>
    ids.map((id) => pickText(zones.data?.find((z) => z.id === id)?.name, locale) || '…');
  const sentence = summarize(d, locale, t, { items: names, zones: zoneNames });

  const save = useMutation({
    mutationFn: async () => {
      if (!built.ok) throw new Error('invalid');
      return promotion
        ? unwrap(
            await api.PATCH('/v1/admin/promotions/{id}', {
              params: { path: { id: promotion.id } },
              body: built.input,
            }),
          )
        : unwrap(await api.POST('/v1/admin/promotions', { body: built.input as never }));
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['promotions'] });
      queryClient.setQueryData(['promotion', result.id], result);
      setSaved(d);
      toast(t('account.saved'));
      if (!promotion) navigate({ to: '/promotions/$id', params: { id: result.id } });
    },
  });
  const submit = () => {
    if (!built.ok) {
      setShowProblems(true);
      return;
    }
    save.mutate();
  };
  const problem = (p: DraftProblem) =>
    showProblems && !built.ok && built.problems.includes(p) ? t(`promo.problem.${p}`) : undefined;
  const percentAction = ['percent_off_order', 'percent_off_items', 'delivery_percent_off'];
  const amountAction = ['amount_off_order', 'amount_off_items', 'delivery_amount_off'];

  return (
    <div className="flex max-w-6xl flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <BackLink to="/promotions" label={t('nav.promotions')} />
        <h1 className="text-xl font-semibold tracking-tight">
          {promotion ? pickText(promotion.title, locale) || t('promo.untitled') : t('promo.new')}
        </h1>
        {promotion && <StateChip state={promotion.state} />}
      </div>
      {promotion && (
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {(
            [
              [t('promo.uses'), String(promotion.usageCount)],
              [t('promo.orders'), String(promotion.orders)],
              [t('promo.discountGiven'), formatPrice(promotion.discountTotal, locale)],
              [t('promo.sales'), formatPrice(promotion.sales, locale)],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="rounded-lg border border-border bg-background p-3">
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="text-lg font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="rounded-md bg-muted p-3 font-medium" aria-live="polite">
        {sentence}
      </p>
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <form
          id={formId}
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <fieldset disabled={!canWrite || save.isPending} className="flex flex-col gap-4">
            <section aria-labelledby="promo-basics" className={section}>
              <h2 id="promo-basics" className="font-semibold">
                {t('promo.basics')}
              </h2>
              <div className="grid gap-3 md:grid-cols-2">
                <Field
                  label={t('promo.titleBn')}
                  lang="bn"
                  value={d.titleBn}
                  maxLength={100}
                  onChange={(e) => set({ titleBn: e.target.value })}
                  error={problem('title')}
                />
                <Field
                  label={t('promo.titleEn')}
                  lang="en"
                  value={d.titleEn}
                  maxLength={100}
                  onChange={(e) => set({ titleEn: e.target.value })}
                />
              </div>
              <p className="text-sm text-muted-foreground">{t('promo.titleHint')}</p>
              <fieldset className="flex flex-col gap-1" disabled={Boolean(promotion)}>
                <legend className="mb-1 text-sm font-medium">{t('promo.kind')}</legend>
                {(['automatic', 'code'] as const).map((k) => (
                  <label key={k} className="flex min-h-11 items-center gap-3">
                    <input
                      type="radio"
                      name="promo-kind"
                      className="size-5"
                      checked={d.kind === k}
                      onChange={() => set({ kind: k })}
                    />
                    <span>
                      {t(`promo.kind.${k}`)}
                      <span className="block text-sm text-muted-foreground">
                        {t(`promo.kindHint.${k}`)}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
              {d.kind === 'code' && (
                <Field
                  label={t('promo.sharedCode')}
                  hint={t('promo.sharedCodeHint')}
                  value={d.code}
                  maxLength={32}
                  autoCapitalize="characters"
                  onChange={(e) => set({ code: e.target.value })}
                  error={problem('code')}
                />
              )}
            </section>

            <section aria-labelledby="promo-action" className={section}>
              <h2 id="promo-action" className="font-semibold">
                {t('promo.action')}
              </h2>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                {t('promo.actionType')}
                <select
                  className={selectClass}
                  value={d.actionType}
                  onChange={(e) => set({ actionType: e.target.value as Draft['actionType'] })}
                >
                  {ACTION_TYPES.map((a) => (
                    <option key={a} value={a}>
                      {t(`promo.actionType.${a}`)}
                    </option>
                  ))}
                </select>
              </label>
              {percentAction.includes(d.actionType) && (
                <Field
                  label={t('promo.percent')}
                  hint={d.actionType === 'delivery_percent_off' ? t('promo.freeHint') : undefined}
                  inputMode="decimal"
                  value={d.percent}
                  onChange={(e) => set({ percent: e.target.value })}
                  error={problem('percent')}
                />
              )}
              {amountAction.includes(d.actionType) && (
                <Field
                  label={t('promo.amount')}
                  inputMode="decimal"
                  value={d.amount}
                  onChange={(e) => set({ amount: e.target.value })}
                  error={problem('amount')}
                />
              )}
              {(d.actionType === 'percent_off_items' || d.actionType === 'amount_off_items') && (
                <>
                  <ItemSelection
                    legend={t('promo.target')}
                    value={d.target}
                    onChange={(target) => set({ target })}
                  />
                  {problem('target') && <p className="text-sm text-danger">{problem('target')}</p>}
                </>
              )}
              {d.actionType === 'buy_x_get_y' && (
                <>
                  <Field
                    label={t('promo.buyQuantity')}
                    inputMode="numeric"
                    value={d.buyQuantity}
                    onChange={(e) => set({ buyQuantity: e.target.value })}
                  />
                  <ItemSelection
                    legend={t('promo.buyItems')}
                    value={d.buyItems}
                    onChange={(buyItems) => set({ buyItems })}
                  />
                  {problem('buy') && <p className="text-sm text-danger">{problem('buy')}</p>}
                  <div className="grid gap-3 md:grid-cols-2">
                    <Field
                      label={t('promo.getQuantity')}
                      inputMode="numeric"
                      value={d.getQuantity}
                      onChange={(e) => set({ getQuantity: e.target.value })}
                    />
                    <Field
                      label={t('promo.getPercent')}
                      hint={t('promo.freeHint')}
                      inputMode="decimal"
                      value={d.percent}
                      onChange={(e) => set({ percent: e.target.value })}
                      error={problem('percent')}
                    />
                  </div>
                  <label className="flex min-h-11 items-center gap-3">
                    <input
                      type="checkbox"
                      className="size-5"
                      checked={d.getSame}
                      onChange={(e) => set({ getSame: e.target.checked })}
                    />
                    {t('promo.getSame')}
                  </label>
                  {!d.getSame && (
                    <ItemSelection
                      legend={t('promo.getItems')}
                      value={d.getItems}
                      onChange={(getItems) => set({ getItems })}
                    />
                  )}
                  {problem('get') && <p className="text-sm text-danger">{problem('get')}</p>}
                  <Field
                    label={t('promo.maxUses')}
                    hint={t('promo.maxUsesHint')}
                    inputMode="numeric"
                    value={d.maxUses}
                    onChange={(e) => set({ maxUses: e.target.value })}
                  />
                </>
              )}
            </section>

            <section aria-labelledby="promo-conditions" className={section}>
              <h2 id="promo-conditions" className="font-semibold">
                {t('promo.conditions')}
              </h2>
              <p className="text-sm text-muted-foreground">{t('promo.conditionsHint')}</p>
              <div className="grid gap-3 md:grid-cols-2">
                <Field
                  label={t('promo.minSubtotal')}
                  inputMode="decimal"
                  value={d.minSubtotal}
                  onChange={(e) => set({ minSubtotal: e.target.value })}
                />
                <Field
                  label={t('promo.minQuantity')}
                  inputMode="numeric"
                  value={d.minQuantity}
                  onChange={(e) => set({ minQuantity: e.target.value })}
                />
              </div>
              <ItemSelection
                legend={t('promo.itemsCondition')}
                value={d.items}
                onChange={(items) => set({ items })}
              />
              {zones.data && zones.data.length > 0 && (
                <fieldset className="flex flex-col gap-1">
                  <legend className="mb-1 text-sm font-medium">{t('promo.zones')}</legend>
                  {zones.data.map((z) => (
                    <label key={z.id} className="flex min-h-11 items-center gap-3">
                      <input
                        type="checkbox"
                        className="size-5"
                        checked={d.zoneIds.includes(z.id)}
                        onChange={(e) =>
                          set({
                            zoneIds: e.target.checked
                              ? [...d.zoneIds, z.id]
                              : d.zoneIds.filter((x) => x !== z.id),
                          })
                        }
                      />
                      {pickText(z.name, locale)}
                    </label>
                  ))}
                </fieldset>
              )}
              <label className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  className="size-5"
                  checked={d.firstOrder}
                  onChange={(e) => set({ firstOrder: e.target.checked })}
                />
                {t('promo.firstOrder')}
              </label>
              <Field
                label={t('promo.customerTags')}
                hint={t('order.tagsHint')}
                value={d.customerTags}
                onChange={(e) => set({ customerTags: e.target.value })}
              />
              <div className="flex flex-col gap-1.5">
                <label htmlFor="promo-phones" className="text-sm font-medium">
                  {t('promo.customerPhones')}
                </label>
                <textarea
                  id="promo-phones"
                  rows={2}
                  value={d.customerPhones}
                  onChange={(e) => set({ customerPhones: e.target.value })}
                  aria-describedby="promo-phones-hint"
                  className="rounded-lg border border-border bg-background p-3 text-base"
                />
                <p id="promo-phones-hint" className="text-sm text-muted-foreground">
                  {t('promo.customerPhonesHint')}
                </p>
              </div>
              <fieldset className="flex flex-col gap-1">
                <legend className="mb-1 text-sm font-medium">{t('promo.paymentMethods')}</legend>
                {(['cod', 'manual', 'online'] as const).map((m) => (
                  <label key={m} className="flex min-h-11 items-center gap-3">
                    <input
                      type="checkbox"
                      className="size-5"
                      checked={d.paymentMethods.includes(m)}
                      onChange={(e) =>
                        set({
                          paymentMethods: e.target.checked
                            ? [...d.paymentMethods, m]
                            : d.paymentMethods.filter((x) => x !== m),
                        })
                      }
                    />
                    {t(`promo.payment.${m}`)}
                  </label>
                ))}
              </fieldset>
            </section>

            <section aria-labelledby="promo-limits" className={section}>
              <h2 id="promo-limits" className="font-semibold">
                {t('promo.scheduleLimits')}
              </h2>
              <div className="grid gap-3 md:grid-cols-2">
                <Field
                  label={t('promo.startsAt')}
                  type="datetime-local"
                  value={d.startsAt}
                  onChange={(e) => set({ startsAt: e.target.value })}
                />
                <Field
                  label={t('promo.endsAt')}
                  type="datetime-local"
                  value={d.endsAt}
                  onChange={(e) => set({ endsAt: e.target.value })}
                  error={problem('dates')}
                />
                <Field
                  label={t('promo.usageLimit')}
                  hint={t('promo.noLimitHint')}
                  inputMode="numeric"
                  value={d.usageLimit}
                  onChange={(e) => set({ usageLimit: e.target.value })}
                />
                <Field
                  label={t('promo.perCustomerLimit')}
                  hint={t('promo.noLimitHint')}
                  inputMode="numeric"
                  value={d.perCustomerLimit}
                  onChange={(e) => set({ perCustomerLimit: e.target.value })}
                />
                <Field
                  label={t('promo.maxDiscount')}
                  hint={t('promo.noLimitHint')}
                  inputMode="decimal"
                  value={d.maxDiscount}
                  onChange={(e) => set({ maxDiscount: e.target.value })}
                />
                <Field
                  label={t('promo.priority')}
                  hint={t('promo.priorityHint')}
                  inputMode="numeric"
                  value={d.priority}
                  onChange={(e) => set({ priority: e.target.value })}
                />
              </div>
              {problem('number') && <p className="text-sm text-danger">{problem('number')}</p>}
              <label className="flex min-h-11 items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-3 size-5"
                  checked={d.exclusive}
                  onChange={(e) => set({ exclusive: e.target.checked })}
                />
                <span className="flex min-h-11 flex-col justify-center">
                  {t('promo.exclusive')}
                  <span className="text-sm text-muted-foreground">{t('promo.exclusiveHint')}</span>
                </span>
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                {t('promo.status')}
                <select
                  className={selectClass}
                  value={d.status}
                  onChange={(e) => set({ status: e.target.value as Draft['status'] })}
                >
                  {(['draft', 'active', 'paused', 'ended'] as const).map((s) => (
                    <option key={s} value={s}>
                      {t(`promo.status.${s}`)}
                    </option>
                  ))}
                </select>
              </label>
            </section>
            {showProblems && !built.ok && <Notice tone="error">{t('newOrder.incomplete')}</Notice>}
            {save.error && !(save.error instanceof Error && save.error.message === 'invalid') && (
              <Notice tone="error">{orderErrorMessage(save.error, t)}</Notice>
            )}
          </fieldset>
        </form>
        <aside className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
          <TestCart draft={built.ok ? built.input : undefined} promotion={promotion} />
          {promotion?.kind === 'code' && <Codes promotion={promotion} />}
        </aside>
      </div>
      <SaveBar
        show={canWrite && (!promotion || changed)}
        message={promotion ? t('promo.unsaved') : undefined}
        discardLabel={promotion ? t('promo.discard') : t('action.cancel')}
        onDiscard={() => {
          if (!promotion) {
            navigate({ to: '/promotions' });
            return;
          }
          setD(saved);
          setShowProblems(false);
        }}
        saveLabel={promotion ? t('action.save') : t('promo.create')}
        busy={save.isPending}
        form={formId}
      />
    </div>
  );
}

interface CartLine {
  variantId: string;
  label: string;
  quantity: string;
}

/** Prices a cart against the live promotions, with this one tried as if live. */
function TestCart({
  draft,
  promotion,
}: {
  draft: Record<string, unknown> | undefined;
  promotion: Promotion | undefined;
}) {
  const { t, locale } = useLocale();
  const [lines, setLines] = useState<CartLine[]>([]);
  const [place, setPlace] = useState<PlaceDraft>(emptyPlace);
  const [payment, setPayment] = useState<'cod' | 'manual' | 'online'>('cod');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const parsed = lines.map((l) => ({ variantId: l.variantId, quantity: Number(l.quantity) }));
  const valid =
    parsed.length > 0 && parsed.every((l) => Number.isInteger(l.quantity) && l.quantity > 0);
  const body = {
    lines: parsed,
    areaId: place.areaId,
    paymentMethod: payment,
    ...(phone.trim() ? { phone: phone.trim() } : {}),
    ...(code.trim() ? { code: code.trim() } : {}),
    ...(draft ? { draft } : promotion ? { promotionId: promotion.id } : {}),
  };
  const [debounced, setDebounced] = useState(body);
  const key = JSON.stringify(body);
  // Re-tried 400 ms after the last change, keyed on the serialized body.
  useEffect(() => {
    const id = setTimeout(() => setDebounced(body), 400);
    return () => clearTimeout(id);
  }, [key]);
  const result = useQuery({
    queryKey: ['promotion-test', debounced] as const,
    queryFn: async () =>
      unwrap(await api.POST('/v1/admin/promotions/test', { body: debounced as never })),
    enabled: valid && debounced.lines.length > 0,
    retry: false,
    placeholderData: (prev) => prev,
  });
  const money = (n: number) => formatPrice(n, locale);
  const draftId = '00000000-0000-4000-8000-000000000000';
  return (
    <section aria-labelledby="test-cart" className={section}>
      <h2 id="test-cart" className="font-semibold">
        {t('promo.testCart')}
      </h2>
      <p className="text-sm text-muted-foreground">{t('promo.testCartHint')}</p>
      {lines.length > 0 && (
        <ul className="flex flex-col gap-2">
          {lines.map((l, i) => (
            <li key={l.variantId} className="flex items-center gap-2">
              <span className="flex-1 text-sm">{l.label}</span>
              <Input
                className="w-20"
                inputMode="numeric"
                aria-label={t('order.quantityOf', { item: l.label })}
                value={l.quantity}
                onChange={(e) =>
                  setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))
                }
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('order.removeLine', { item: l.label })}
                onClick={() => setLines(lines.filter((_, j) => j !== i))}
              >
                <X aria-hidden className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <VariantPicker
        onPick={(row) =>
          setLines((prev) =>
            prev.some((l) => l.variantId === row.variantId)
              ? prev
              : [
                  ...prev,
                  {
                    variantId: row.variantId,
                    label: lineLabel({ title: row.titles, optionLabels: row.optionLabels }, locale),
                    quantity: '1',
                  },
                ],
          )
        }
      />
      <PlacePicker value={place} onChange={setPlace} withLine={false} />
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        {t('order.payment')}
        <select
          className={selectClass}
          value={payment}
          onChange={(e) => setPayment(e.target.value as 'cod' | 'manual' | 'online')}
        >
          <option value="cod">{t('promo.payment.cod')}</option>
          <option value="manual">{t('promo.payment.manual')}</option>
          <option value="online">{t('promo.payment.online')}</option>
        </select>
      </label>
      <div className="grid gap-3 md:grid-cols-2">
        <Field
          label={t('promo.testPhone')}
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <Field label={t('newOrder.code')} value={code} onChange={(e) => setCode(e.target.value)} />
      </div>
      <div aria-live="polite" className="flex flex-col gap-2 text-sm">
        {!valid ? (
          <p className="text-muted-foreground">{t('promo.testEmpty')}</p>
        ) : result.isError ? (
          <Notice tone="error">{orderErrorMessage(result.error, t)}</Notice>
        ) : result.data ? (
          <>
            <ul className="flex flex-col gap-1">
              {result.data.results.map((r) => (
                <li key={r.promotionId} className="flex justify-between gap-3">
                  <span>
                    {r.promotionId === draftId || r.promotionId === promotion?.id ? (
                      <strong>{pickText(r.title, locale) || t('promo.thisOne')}</strong>
                    ) : (
                      pickText(r.title, locale)
                    )}
                    {!r.applied && r.reason && (
                      <span className="block text-xs text-muted-foreground">
                        {t(`promoReason.${r.reason}` as AdminKey)}
                      </span>
                    )}
                  </span>
                  <span
                    className={r.applied ? 'font-medium text-success' : 'text-muted-foreground'}
                  >
                    {r.applied ? `−${money(r.amount)}` : t('promo.notApplied')}
                  </span>
                </li>
              ))}
              {result.data.results.length === 0 && (
                <li className="text-muted-foreground">{t('promo.noneLive')}</li>
              )}
            </ul>
            <Total label={t('order.subtotal')}>{money(result.data.quote.totals.subtotal)}</Total>
            <Total label={t('order.delivery')}>
              {money(
                result.data.quote.totals.deliveryFee - result.data.quote.totals.deliveryDiscount,
              )}
            </Total>
            <Total label={t('order.total')} strong>
              {money(result.data.quote.totals.total)}
            </Total>
          </>
        ) : (
          <p role="status">{t('loading')}</p>
        )}
      </div>
    </section>
  );
}

function Total({
  label,
  children,
  strong,
}: {
  label: string;
  children: ReactNode;
  strong?: boolean;
}) {
  return (
    <div
      className={`flex justify-between ${strong ? 'border-t border-border pt-1 font-semibold' : ''}`}
    >
      <span>{label}</span>
      <span>{children}</span>
    </div>
  );
}

/** A code promotion's codes: generate a batch, export them all with their uses. */
function Codes({ promotion }: { promotion: Promotion }) {
  const { t } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canWrite = usePermission('promotions.write');
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState('100');
  const [prefix, setPrefix] = useState('');
  const [uses, setUses] = useState('1');
  const [exporting, setExporting] = useState(false);
  const generate = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST('/v1/admin/promotions/{id}/codes', {
          params: { path: { id: promotion.id } },
          body: { count: Number(count), prefix: prefix.trim(), usageLimit: Number(uses) },
        }),
      ),
    onSuccess: async (r) => {
      await queryClient.invalidateQueries({ queryKey: ['promotion', promotion.id] });
      download(
        `codes-${new Date().toISOString().slice(0, 10)}.csv`,
        new Blob(
          [
            toCsv(
              ['code'],
              r.codes.map((c) => [c]),
            ),
          ],
          { type: 'text/csv;charset=utf-8' },
        ),
      );
      toast(t('promo.codesMade', { count: r.created }));
      setOpen(false);
    },
  });
  async function exportAll() {
    setExporting(true);
    try {
      const rows: string[][] = [];
      let after: string | undefined;
      do {
        const page = unwrap(
          await api.GET('/v1/admin/promotions/{id}/codes', {
            params: {
              path: { id: promotion.id },
              query: { limit: 1000, ...(after ? { after } : {}) },
            },
          }),
        );
        rows.push(
          ...page.items.map((c) => [
            c.code,
            String(c.usageCount),
            c.usageLimit === null ? '' : String(c.usageLimit),
          ]),
        );
        after = page.nextCursor ?? undefined;
      } while (after);
      download(
        `codes-${promotion.id.slice(0, 8)}.csv`,
        new Blob([toCsv(['code', 'uses', 'limit'], rows)], { type: 'text/csv;charset=utf-8' }),
      );
    } catch (e) {
      toast(errorMessage(e, t));
    } finally {
      setExporting(false);
    }
  }
  const valid =
    Number.isInteger(Number(count)) &&
    Number(count) >= 1 &&
    Number(count) <= 5000 &&
    /^[A-Za-z0-9]{0,10}$/.test(prefix.trim()) &&
    Number.isInteger(Number(uses)) &&
    Number(uses) >= 1;
  return (
    <section aria-labelledby="promo-codes" className={section}>
      <h2 id="promo-codes" className="font-semibold">
        {t('promo.codes')}
      </h2>
      <p className="text-sm">{t('promo.codesCount', { count: promotion.codeCount })}</p>
      <div className="flex flex-wrap gap-2">
        {canWrite && (
          <Button variant="secondary" onClick={() => setOpen(true)}>
            {t('promo.generate')}
          </Button>
        )}
        {promotion.codeCount > 0 && (
          <Button variant="secondary" disabled={exporting} onClick={exportAll}>
            {t('promo.exportCodes')}
          </Button>
        )}
      </div>
      <Dialog open={open} onOpenChange={setOpen} title={t('promo.generate')}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) generate.mutate();
          }}
        >
          <Field
            label={t('promo.batchCount')}
            hint={t('promo.batchCountHint')}
            inputMode="numeric"
            value={count}
            onChange={(e) => setCount(e.target.value)}
          />
          <Field
            label={t('promo.batchPrefix')}
            hint={t('promo.batchPrefixHint')}
            value={prefix}
            maxLength={10}
            onChange={(e) => setPrefix(e.target.value)}
          />
          <Field
            label={t('promo.batchUses')}
            inputMode="numeric"
            value={uses}
            onChange={(e) => setUses(e.target.value)}
          />
          {!valid && <Notice tone="error">{t('form.invalid')}</Notice>}
          {generate.error && <Notice tone="error">{orderErrorMessage(generate.error, t)}</Notice>}
          <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t('action.cancel')}
            </Button>
            <Button type="submit" disabled={!valid || generate.isPending}>
              {t('promo.generate')}
            </Button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}
