// Manual orders (phase-4-plan §3.12): Facebook, phone and walk-in orders,
// placed with the same placeOrder as the storefront. One column on phones.
// The totals come from the API's quote as the order is typed, so they are
// exactly what saving will charge; a blocked phone is warned about first.

import { MANUAL_METHODS, MANUAL_ORDER_SOURCES } from '@managemind/shared/orders';
import { formatPhone, normalizePhone } from '@managemind/shared/phone';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { X } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { Field } from '../components/field';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { emptyPlace, type PlaceDraft, PlacePicker, placeReady } from '../components/place-picker';
import { type PhoneRisk, RiskReasons, ScoreBadge, useRiskCounts } from '../components/risk';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { VariantPicker } from '../components/variant-picker';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/orders';
import { api, unwrap } from '../lib/api';
import { formatPrice, readPrice } from '../lib/catalog';
import {
  type CustomerAddress,
  customerQuery,
  dateTime,
  fetchCustomers,
  geoQuery,
  idempotencyKey,
  lineLabel,
  type ManualOrderBody,
  orderErrorMessage,
  pickText,
  withKey,
  zonesQuery,
} from '../lib/orders';
import { cn } from '../lib/utils';

interface LineDraft {
  variantId: string;
  label: string;
  available: number | null;
  quantity: string;
}

type Source = (typeof MANUAL_ORDER_SOURCES)[number];
type Method = (typeof MANUAL_METHODS)[number];

const selectClass =
  'min-h-11 w-full rounded-lg border border-input bg-background px-3 text-base font-normal';
const section = 'flex flex-col gap-3 rounded-xl border border-border bg-background p-4 md:p-5';

const toLatin = (s: string) => s.replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d)));

export function NewOrderPage() {
  const { t, locale } = useLocale();
  const toast = useToast();
  const navigate = useNavigate();
  const canCustomers = usePermission('customers.read');
  const [key, setKey] = useState(idempotencyKey);
  const [source, setSource] = useState<Source>('facebook');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [delivery, setDelivery] = useState(true);
  const [place, setPlace] = useState<PlaceDraft>(emptyPlace);
  const [zone, setZone] = useState<string>('');
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [code, setCode] = useState('');
  const [discountKind, setDiscountKind] = useState<'none' | 'amount' | 'percent'>('none');
  const [discount, setDiscount] = useState('');
  const [discountReason, setDiscountReason] = useState('');
  const [paid, setPaid] = useState(false);
  const [method, setMethod] = useState<Method>('bkash');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [allowBlocked, setAllowBlocked] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  // Started from an incomplete checkout (phase-6-plan §3.2): its customer,
  // the lines still orderable, the address typed so far and the cart's code.
  const { incomplete: incompleteId } = useSearch({ strict: false }) as { incomplete?: string };
  const incomplete = useQuery({
    queryKey: ['incomplete-order', incompleteId] as const,
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/admin/incomplete-orders/{id}', {
          params: { path: { id: incompleteId as string } },
        }),
      ),
    enabled: Boolean(incompleteId),
  });
  const [prefilled, setPrefilled] = useState(false);
  useEffect(() => {
    const d = incomplete.data;
    if (!d || prefilled) return;
    setPrefilled(true);
    setPhone(formatPhone(d.phone));
    setName(d.name ?? '');
    setEmail(d.email ?? '');
    setPlace({
      divisionId: d.address.divisionId ?? null,
      districtId: d.address.districtId ?? null,
      areaId: d.address.areaId ?? null,
      line: d.address.line ?? '',
    });
    setLines(
      d.lines
        .filter((l) => l.orderable)
        .map((l) => ({
          variantId: l.variantId,
          label: lineLabel(l, locale),
          available: l.available,
          quantity: String(l.quantity),
        })),
    );
    if (d.cartCode) setCode(d.cartCode);
  }, [incomplete.data, prefilled, locale]);

  const normalized = normalizePhone(phone);
  const zones = useQuery(zonesQuery);

  // The body as it stands; the quote takes it without the contact's name.
  const parsedLines = lines.map((l) => ({
    variantId: l.variantId,
    quantity: Number(toLatin(l.quantity)),
  }));
  const linesValid =
    parsedLines.length > 0 &&
    parsedLines.every((l) => Number.isInteger(l.quantity) && l.quantity >= 1);
  const discountValue =
    discountKind === 'amount'
      ? readPrice(discount)
      : discountKind === 'percent'
        ? Math.round(Number(toLatin(discount)) * 100)
        : null;
  const discountValid =
    discountKind === 'none' ||
    (discountValue !== null &&
      discountValue !== undefined &&
      Number.isFinite(discountValue) &&
      discountValue > 0 &&
      (discountKind === 'amount' || discountValue <= 10_000) &&
      discountReason.trim() !== '');
  const paidAmount = paid ? readPrice(amount) : null;
  const address =
    delivery && placeReady(place)
      ? {
          divisionId: place.divisionId as number,
          districtId: place.districtId as number,
          areaId: place.areaId as number,
          line: place.line.trim(),
        }
      : null;
  const shared = {
    source,
    lines: parsedLines,
    address,
    ...(delivery ? (zone ? { zoneId: zone } : {}) : { zoneId: 'none' as const }),
    ...(code.trim() ? { code: code.trim() } : {}),
    ...(discountKind !== 'none' && discountValid
      ? {
          manualDiscount: {
            ...(discountKind === 'amount'
              ? { amount: discountValue as number }
              : { percentBp: discountValue as number }),
            reason: discountReason.trim(),
          },
        }
      : {}),
    ...(paid && paidAmount
      ? {
          payment: {
            method,
            amount: paidAmount,
            ...(reference.trim() ? { reference: reference.trim() } : {}),
          },
        }
      : {}),
    locale,
  };
  const [debounced, setDebounced] = useState(shared);
  const sharedKey = JSON.stringify(shared);
  // Re-quoted 300 ms after the last change, keyed on the serialized body.
  useEffect(() => {
    const id = setTimeout(() => setDebounced(shared), 300);
    return () => clearTimeout(id);
  }, [sharedKey]);
  const quote = useQuery({
    queryKey: ['manual-quote', debounced, normalized] as const,
    queryFn: async () =>
      unwrap(
        await api.POST('/v1/admin/orders/quote', {
          body: {
            ...debounced,
            ...(normalized ? { contact: { phone: normalized } } : {}),
          } as never,
        }),
      ),
    // Both the form and its debounced copy: the copy lags the first item by 300 ms.
    enabled:
      linesValid && debounced.lines.length > 0 && (!delivery || address !== null || zone !== ''),
    retry: false,
    placeholderData: (prev) => prev,
  });

  // The phone's delivery score as soon as it's typed (phase-6-plan §3.8), before any item.
  const risk = useQuery({
    queryKey: ['phone-risk', normalized] as const,
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/admin/phones/{phone}/risk', {
          params: { path: { phone: normalized as string } },
        }),
      ),
    enabled: normalized !== null,
    staleTime: 30_000,
  });

  const contactValid = normalized !== null && name.trim() !== '';
  const ready =
    contactValid &&
    linesValid &&
    discountValid &&
    (!paid || Boolean(paidAmount)) &&
    (!delivery || address !== null) &&
    (!quote.data?.blocked || allowBlocked);

  const place_ = useMutation({
    mutationFn: async (opts: { confirm: boolean; completeNow: boolean }) => {
      const body: ManualOrderBody = {
        ...shared,
        contact: {
          name: name.trim(),
          phone: normalized as string,
          ...(email.trim() ? { email: email.trim() } : {}),
        },
        ...(note.trim() ? { note: note.trim() } : {}),
        confirm: opts.confirm,
        completeNow: opts.completeNow,
        allowBlocked,
        ...(incompleteId && incomplete.data ? { incompleteOrderId: incompleteId } : {}),
      } as ManualOrderBody;
      return unwrap(await api.POST('/v1/admin/orders', { ...withKey(key), body }));
    },
    onSuccess: (placed) => {
      setKey(idempotencyKey());
      toast(t('newOrder.placed', { number: placed.displayNumber }));
      navigate({ to: '/orders/$id', params: { id: placed.id } });
    },
  });
  const submit = (opts: { confirm: boolean; completeNow: boolean }) => {
    if (!ready) {
      setShowErrors(true);
      return;
    }
    place_.mutate(opts);
  };

  const q = quote.data?.quote;
  const money = (n: number) => formatPrice(n, locale);
  // Shown in the summary on desktops and pinned at the bottom on phones.
  const primary = !delivery ? (
    <Button
      disabled={place_.isPending}
      onClick={() => submit({ confirm: true, completeNow: true })}
    >
      {t('newOrder.completeSale')}
    </Button>
  ) : (
    <Button
      disabled={place_.isPending}
      onClick={() => submit({ confirm: true, completeNow: false })}
    >
      {t('newOrder.saveConfirm')}
    </Button>
  );

  return (
    <div className="flex flex-col gap-5 pb-24 lg:pb-0">
      <PageHeader
        className="mb-0"
        parent={{ to: '/orders', label: t('nav.orders') }}
        title={t('newOrder.title')}
        description={t('newOrder.intro')}
      />
      {incomplete.data && (
        <Notice>
          {t('incomplete.startedFrom', { date: dateTime(locale, incomplete.data.updatedAt) })}
        </Notice>
      )}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <section aria-labelledby="customer-h" className={section}>
            <h2 id="customer-h" className="font-semibold">
              {t('order.customer')}
            </h2>
            {canCustomers && (
              <CustomerSearch
                onPick={(c) => {
                  setCustomerId(c.id);
                  setPhone(c.phone);
                  setName(c.name);
                  setEmail(c.email ?? '');
                }}
              />
            )}
            <div className="grid gap-3 md:grid-cols-2">
              <Field
                label={t('newOrder.phone')}
                type="tel"
                inputMode="tel"
                placeholder="01712-345678"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  setCustomerId(null);
                }}
                error={showErrors && !normalized ? t('form.invalidPhone') : undefined}
              />
              <Field
                label={t('newOrder.name')}
                value={name}
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
                error={showErrors && !name.trim() ? t('form.required') : undefined}
              />
              <Field
                label={t('newOrder.email')}
                type="email"
                value={email}
                maxLength={254}
                onChange={(e) => setEmail(e.target.value)}
              />
              {/* A website order when it comes from an incomplete checkout. */}
              {!incompleteId && (
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  {t('order.source')}
                  <select
                    className={selectClass}
                    value={source}
                    onChange={(e) => {
                      const next = e.target.value as Source;
                      setSource(next);
                      if (next === 'walk_in') setDelivery(false);
                    }}
                  >
                    {MANUAL_ORDER_SOURCES.map((s) => (
                      <option key={s} value={s}>
                        {t(`source.${s}`)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            {quote.data?.blocked && (
              <div className="flex flex-col gap-2 rounded-md bg-danger-soft p-3 text-sm text-danger">
                <p role="alert">{t('newOrder.blocked')}</p>
                <label className="flex min-h-11 items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={allowBlocked}
                    onChange={(e) => setAllowBlocked(e.target.checked)}
                  />
                  {t('newOrder.allowBlocked')}
                </label>
              </div>
            )}
            {normalized && quote.data && !quote.data.blocked && quote.data.firstOrder && (
              <p className="text-sm text-muted-foreground">{t('newOrder.firstOrder')}</p>
            )}
            {normalized && quote.data?.duplicate && (
              <p role="alert" className="rounded-md bg-warning p-3 text-sm text-warning-foreground">
                {t('duplicate.newOrder')}{' '}
                <Link
                  to="/orders/$id"
                  params={{ id: quote.data.duplicate.id }}
                  target="_blank"
                  className="font-medium underline"
                >
                  {quote.data.duplicate.displayNumber}
                </Link>{' '}
                ({dateTime(locale, quote.data.duplicate.placedAt)})
              </p>
            )}
            {normalized && risk.data && risk.data.decided + risk.data.history.open > 0 && (
              <PhoneRecord risk={risk.data} />
            )}
          </section>

          <section aria-labelledby="items-h" className={section}>
            <h2 id="items-h" className="font-semibold">
              {t('order.items')}
            </h2>
            {lines.length > 0 && (
              <ul className="flex flex-col gap-2">
                {lines.map((l, i) => {
                  const ql = q?.lines.find((x) => x.variantId === l.variantId);
                  return (
                    <li key={l.variantId} className="flex flex-wrap items-center gap-2">
                      <span className="flex flex-1 flex-col text-sm">
                        <span>{l.label}</span>
                        <span className="text-xs text-muted-foreground">
                          {[
                            ql ? money(ql.unitPrice) : null,
                            l.available !== null
                              ? t('order.available', { count: l.available })
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                        {ql?.problem && (
                          <span className="text-xs text-danger">
                            {t(`lineProblem.${ql.problem}` as AdminKey)}
                          </span>
                        )}
                      </span>
                      <Input
                        className="w-20"
                        inputMode="numeric"
                        aria-label={t('order.quantityOf', { item: l.label })}
                        value={l.quantity}
                        onChange={(e) =>
                          setLines(
                            lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)),
                          )
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
                  );
                })}
              </ul>
            )}
            {showErrors && !linesValid && (
              <p role="alert" className="text-sm text-danger">
                {t('newOrder.noLines')}
              </p>
            )}
            <VariantPicker
              onPick={(row) =>
                setLines((prev) =>
                  prev.some((l) => l.variantId === row.variantId)
                    ? prev.map((l) =>
                        l.variantId === row.variantId
                          ? { ...l, quantity: String(Number(toLatin(l.quantity)) + 1) }
                          : l,
                      )
                    : [
                        ...prev,
                        {
                          variantId: row.variantId,
                          label: lineLabel(
                            { title: row.titles, optionLabels: row.optionLabels },
                            locale,
                          ),
                          available: row.trackInventory ? row.available : null,
                          quantity: '1',
                        },
                      ],
                )
              }
            />
          </section>

          <section aria-labelledby="delivery-h" className={section}>
            <h2 id="delivery-h" className="font-semibold">
              {t('order.delivery')}
            </h2>
            <label className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                className="size-5"
                checked={!delivery}
                onChange={(e) => setDelivery(!e.target.checked)}
              />
              {t('newOrder.noDelivery')}
            </label>
            {delivery && (
              <>
                {customerId && (
                  <SavedAddresses
                    key={customerId}
                    customerId={customerId}
                    onPick={(a) => {
                      setPlace({
                        divisionId: a.divisionId,
                        districtId: a.districtId,
                        areaId: a.areaId,
                        line: a.line,
                      });
                    }}
                  />
                )}
                <PlacePicker value={place} onChange={setPlace} />
                {showErrors && !address && (
                  <p role="alert" className="text-sm text-danger">
                    {t('newOrder.noAddress')}
                  </p>
                )}
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  {t('order.zone')}
                  <select
                    className={selectClass}
                    value={zone}
                    onChange={(e) => setZone(e.target.value)}
                  >
                    <option value="">{t('newOrder.zoneAuto')}</option>
                    {zones.data
                      ?.filter((z) => z.active)
                      .map((z) => (
                        <option key={z.id} value={z.id}>
                          {pickText(z.name, locale)} — {money(z.fee)}
                        </option>
                      ))}
                  </select>
                </label>
              </>
            )}
          </section>

          <section aria-labelledby="discount-h" className={section}>
            <h2 id="discount-h" className="font-semibold">
              {t('newOrder.discounts')}
            </h2>
            <Field
              label={t('newOrder.code')}
              value={code}
              maxLength={32}
              autoCapitalize="characters"
              onChange={(e) => setCode(e.target.value)}
              hint={
                q?.code && q.code.status !== 'applied'
                  ? t(`codeStatus.${q.code.status}` as AdminKey)
                  : undefined
              }
            />
            <fieldset className="flex flex-col gap-1">
              <legend className="mb-1 text-sm font-medium">{t('newOrder.manualDiscount')}</legend>
              <div className="flex flex-wrap gap-4">
                {(['none', 'amount', 'percent'] as const).map((k) => (
                  <label key={k} className="flex min-h-11 items-center gap-2">
                    <input
                      type="radio"
                      name="discount-kind"
                      className="size-5"
                      checked={discountKind === k}
                      onChange={() => setDiscountKind(k)}
                    />
                    {t(`newOrder.discount.${k}`)}
                  </label>
                ))}
              </div>
            </fieldset>
            {discountKind !== 'none' && (
              <div className="grid gap-3 md:grid-cols-2">
                <Field
                  label={t(
                    discountKind === 'amount'
                      ? 'newOrder.discountAmount'
                      : 'newOrder.discountPercent',
                  )}
                  inputMode="decimal"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  error={showErrors && !discountValid ? t('form.invalid') : undefined}
                />
                <Field
                  label={t('newOrder.discountReason')}
                  value={discountReason}
                  maxLength={200}
                  onChange={(e) => setDiscountReason(e.target.value)}
                />
              </div>
            )}
          </section>

          <section aria-labelledby="payment-h" className={section}>
            <h2 id="payment-h" className="font-semibold">
              {t('order.payment')}
            </h2>
            {[false, true].map((p) => (
              <label key={String(p)} className="flex min-h-11 items-center gap-3">
                <input
                  type="radio"
                  name="paid"
                  className="size-5"
                  checked={paid === p}
                  onChange={() => {
                    setPaid(p);
                    if (p && !amount && q) setAmount(String(q.totals.total / 100));
                  }}
                />
                {t(p ? 'newOrder.paidAlready' : 'newOrder.cod')}
              </label>
            ))}
            {paid && (
              <div className="grid gap-3 md:grid-cols-3">
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  {t('order.method')}
                  <select
                    className={selectClass}
                    value={method}
                    onChange={(e) => setMethod(e.target.value as Method)}
                  >
                    {MANUAL_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {t(`method.${m}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <Field
                  label={t('order.amount')}
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  error={showErrors && !paidAmount ? t('form.invalid') : undefined}
                />
                <Field
                  label={t('order.reference')}
                  value={reference}
                  maxLength={100}
                  onChange={(e) => setReference(e.target.value)}
                />
              </div>
            )}
          </section>

          <section aria-labelledby="note-h" className={section}>
            <label id="note-h" htmlFor="order-note" className="font-semibold">
              {t('newOrder.note')}
            </label>
            <textarea
              id="order-note"
              rows={2}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="rounded-lg border border-border bg-background p-3 text-base"
            />
          </section>
        </div>

        <aside
          aria-labelledby="summary-h"
          className="flex flex-col gap-3 lg:sticky lg:top-20 lg:self-start"
        >
          <section className={section}>
            <h2 id="summary-h" className="font-semibold">
              {t('newOrder.summary')}
            </h2>
            <div aria-live="polite" className="flex flex-col gap-1 text-sm">
              {!q ? (
                <p className="text-muted-foreground">
                  {quote.isFetching ? t('loading') : t('newOrder.summaryEmpty')}
                </p>
              ) : (
                <>
                  <Row label={t('order.subtotal')}>{money(q.totals.subtotal)}</Row>
                  {q.promotions.map((p) => (
                    <Row key={p.promotionId} label={pickText(p.title, locale)}>
                      −{money(p.amount)}
                    </Row>
                  ))}
                  {q.manualDiscount && (
                    <Row label={t('newOrder.manualDiscount')}>
                      −{money(q.manualDiscount.amount)}
                    </Row>
                  )}
                  <Row
                    label={
                      q.zone
                        ? t('order.deliveryTo', { zone: pickText(q.zone.name, locale) })
                        : t('order.delivery')
                    }
                  >
                    {money(q.totals.deliveryFee - q.totals.deliveryDiscount)}
                  </Row>
                  {q.totals.vatTotal > 0 && (
                    <Row label={t(q.totals.vatIncluded ? 'order.vatIncluded' : 'order.vat')}>
                      {money(q.totals.vatTotal)}
                    </Row>
                  )}
                  <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
                    <span>{t('order.total')}</span>
                    <span>{money(q.totals.total)}</span>
                  </div>
                  {paid && paidAmount ? (
                    <Row label={t('order.codDue')}>
                      {money(Math.max(0, q.totals.total - paidAmount))}
                    </Row>
                  ) : null}
                </>
              )}
              {quote.isError && <Notice tone="error">{orderErrorMessage(quote.error, t)}</Notice>}
            </div>
          </section>
          {place_.error && <Notice tone="error">{orderErrorMessage(place_.error, t)}</Notice>}
          {showErrors && !ready && <Notice tone="error">{t('newOrder.incomplete')}</Notice>}
          <div className="flex flex-col gap-2">
            <div className="hidden lg:contents">{primary}</div>
            <Button
              variant="secondary"
              disabled={place_.isPending}
              onClick={() => submit({ confirm: false, completeNow: false })}
            >
              {t('newOrder.save')}
            </Button>
          </div>
        </aside>
      </div>
      {/* Phones: the total and the main action stay within thumb reach above the tab bar. */}
      <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 flex items-center gap-3 border-t border-border bg-background px-4 py-3 lg:hidden">
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground">{t('order.total')}</span>
          <span className="text-lg font-semibold tabular-nums">
            {q ? money(q.totals.total) : '—'}
          </span>
        </div>
        <div className="flex flex-1 [&>button]:min-h-12 [&>button]:w-full [&>button]:text-base">
          {primary}
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span>{children}</span>
    </div>
  );
}

/** Finds an existing customer by phone or name. */
function CustomerSearch({
  onPick,
}: {
  onPick: (c: { id: string; phone: string; name: string; email: string | null }) => void;
}) {
  const { t } = useLocale();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(id);
  }, [text]);
  const results = useQuery({
    queryKey: ['customer-search', q] as const,
    queryFn: async () => (await fetchCustomers({ q }, undefined, 8)).items,
    enabled: q.length >= 2,
  });
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="customer-search" className="text-sm font-medium">
        {t('newOrder.findCustomer')}
      </label>
      <Input
        id="customer-search"
        type="search"
        autoComplete="off"
        placeholder={t('customers.search')}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {results.data && results.data.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {results.data.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted"
                onClick={() => {
                  onPick(c);
                  setText('');
                  setQ('');
                }}
              >
                <span>{c.name}</span>
                <span className="text-sm text-muted-foreground">{c.phone}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The chosen customer's saved addresses, one tap to use. */
function SavedAddresses({
  customerId,
  onPick,
}: {
  customerId: string;
  onPick: (a: CustomerAddress) => void;
}) {
  const { t, locale } = useLocale();
  const customer = useQuery(customerQuery(customerId));
  const geo = useQuery(geoQuery);
  const addresses = customer.data?.addresses ?? [];
  // Use the default address straight away, once.
  const [used, setUsed] = useState(false);
  useEffect(() => {
    const first = addresses.find((a) => a.isDefault) ?? addresses[0];
    if (!used && first) {
      onPick(first);
      setUsed(true);
    }
  }, [addresses, used, onPick]);
  if (!addresses.length) return null;
  const areaName = (id: number) => geo.data?.geoIndex().area(id)?.[locale] ?? '';
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium">{t('newOrder.savedAddresses')}</span>
      <div className="flex flex-wrap gap-2">
        {addresses.map((a) => (
          <Button key={a.id} variant="secondary" onClick={() => onPick(a)}>
            {[a.label, a.line, areaName(a.areaId)].filter(Boolean).join(', ')}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** The phone's record in one line, and why it's risky, beside the customer's details. */
function PhoneRecord({ risk }: { risk: PhoneRisk }) {
  const { t } = useLocale();
  const counts = useRiskCounts();
  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 rounded-md p-3 text-sm',
        risk.risky ? 'bg-danger-soft' : 'bg-muted',
      )}
    >
      <p className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{t('risk.title')}</span>
        <ScoreBadge risk={risk} />
        <span>{counts(risk)}</span>
      </p>
      <RiskReasons risk={risk} />
    </div>
  );
}
