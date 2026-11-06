// Manual orders (phase-4-plan §3.12): Facebook, phone and walk-in orders,
// placed with the same placeOrder as the storefront. One column on phones.
// The totals come from the API's quote as the order is typed, so they are
// exactly what saving will charge; a blocked phone is warned about first.

import { MANUAL_METHODS, MANUAL_ORDER_SOURCES } from '@managemind/shared/orders';
import { formatPhone, normalizePhone } from '@managemind/shared/phone';
import * as Popover from '@radix-ui/react-popover';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { ChevronsUpDown, Minus, Plus, Search, X } from 'lucide-react';
import { type ReactNode, useEffect, useId, useState } from 'react';
import { ChatPaste, type ParsedChat } from '../components/chat-paste';
import { Field } from '../components/field';
import { fieldHint, fieldLabel } from '../components/field-styles';
import { Notice } from '../components/notice';
import { BackLink } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { emptyPlace, type PlaceDraft, PlacePicker, placeReady } from '../components/place-picker';
import { PhoneRecordHeader } from '../components/record-header';
import { type PhoneRisk, RiskReasons, ScoreBadge, useRiskCounts } from '../components/risk';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { cardPadded, cardTitle } from '../components/ui/card';
import { ButtonChoices, MoneyInput, RadioCard } from '../components/ui/choice';
import { Input, Textarea } from '../components/ui/input';
import { chipClass } from '../components/ui/segmented';
import { VariantPicker } from '../components/variant-picker';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/orders';
import { api, unwrap } from '../lib/api';
import { formatPrice, readPrice } from '../lib/catalog';
import { useRecordPage } from '../lib/crumb';
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

const toLatin = (s: string) => s.replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d)));

export function NewOrderPage() {
  const { t, locale } = useLocale();
  const toast = useToast();
  const navigate = useNavigate();
  const canCustomers = usePermission('customers.read');
  const [key, setKey] = useState(idempotencyKey);
  // ?source=, ?phone=, ?name= start an order from a chat; ?text=, ?title= and
  // ?url= are what Android's share sheet sends (phase-9-plan §3.1.2).
  const search = useSearch({ strict: false }) as {
    incomplete?: string;
    source?: Source;
    phone?: string;
    name?: string;
    text?: string;
    title?: string;
    url?: string;
  };
  const sharedText = [search.title, search.text, search.url].filter(Boolean).join('\n');
  const [source, setSource] = useState<Source>(
    search.source ?? (sharedText ? 'whatsapp' : 'facebook'),
  );
  const [phone, setPhone] = useState(() => {
    const given = search.phone ? normalizePhone(search.phone) : null;
    return given ? formatPhone(given) : '';
  });
  const [name, setName] = useState(search.name ?? '');
  const [email, setEmail] = useState('');
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [delivery, setDelivery] = useState(true);
  const [place, setPlace] = useState<PlaceDraft>(emptyPlace);
  const [zone, setZone] = useState<string>('');
  const [lines, setLines] = useState<LineDraft[]>([]);
  // The code in the box, and the one applied (on Apply or Enter).
  const [codeDraft, setCodeDraft] = useState('');
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
  const incompleteId = search.incomplete;
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
    if (d.cartCode) {
      setCode(d.cartCode);
      setCodeDraft(d.cartCode);
    }
  }, [incomplete.data, prefilled, locale]);

  // What a pasted chat found: the phone when none is typed yet, its customer,
  // and its products, added to the lines (phase-9-plan §3.1.2).
  const readChat = (parsed: ParsedChat): number => {
    if (parsed.phone && !normalizePhone(phone)) {
      setPhone(formatPhone(parsed.phone));
      setCustomerId(parsed.customer?.id ?? null);
      if (parsed.customer && !name.trim()) setName(parsed.customer.name);
    }
    const found = parsed.lines.filter((l) => l.variantId);
    setLines((current) => {
      const next = current.map((x) => ({ ...x }));
      for (const l of found) {
        const same = next.find((x) => x.variantId === l.variantId);
        if (same) same.quantity = String(Number(toLatin(same.quantity)) + l.quantity);
        else
          next.push({
            variantId: l.variantId as string,
            label: lineLabel(l, locale),
            available: l.available,
            quantity: String(l.quantity),
          });
      }
      return next;
    });
    return found.length;
  };

  const normalized = normalizePhone(phone);
  const zones = useQuery(zonesQuery);
  const geo = useQuery(geoQuery);
  const [pasting, setPasting] = useState(Boolean(sharedText));
  useRecordPage(t('newOrder.title'));

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
  const walkIn = !delivery;
  const itemCount = parsedLines.reduce(
    (n, l) => n + (Number.isInteger(l.quantity) ? l.quantity : 0),
    0,
  );
  const collect = q ? Math.max(0, q.totals.total - (paid && paidAmount ? paidAmount : 0)) : 0;
  const district = place.districtId
    ? geo.data?.geoIndex().district(place.districtId)?.[locale]
    : undefined;
  const autoZone = q?.zone?.id ?? null;
  const chosenZone = zone || autoZone;
  const zoneName = (id: string | null) => {
    const z = zones.data?.find((x) => x.id === id);
    return z ? pickText(z.name, locale) : '';
  };
  const setQuantity = (i: number, next: string) =>
    setLines(lines.map((x, j) => (j === i ? { ...x, quantity: next } : x)));
  const primary = walkIn ? (
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
    <div className="flex flex-col gap-3 md:gap-4">
      <PhoneRecordHeader
        to="/orders"
        backLabel={t('order.backToOrders')}
        title={t('newOrder.title')}
      />
      <div className="flex items-center gap-3 max-md:hidden">
        <BackLink to="/orders" label={t('order.backToOrders')} />
        <h1 className="text-xl leading-7 font-semibold tracking-[-0.01em]">
          {t('newOrder.title')}
        </h1>
      </div>
      {incomplete.data && (
        <Notice>
          {t('incomplete.startedFrom', { date: dateTime(locale, incomplete.data.updatedAt) })}
        </Notice>
      )}
      {showErrors && !ready && (
        <Notice tone="error" className="max-md:hidden">
          {t('newOrder.incomplete')}
        </Notice>
      )}
      <div className="grid items-start gap-3 md:gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3 md:gap-4">
          {!incompleteId && pasting && (
            <ChatPaste
              initialText={sharedText}
              onRead={readChat}
              onClose={() => setPasting(false)}
            />
          )}
          <section aria-labelledby="customer-h" className={cn(cardPadded, 'gap-3.5 md:gap-3.5')}>
            <div className="flex min-h-5 items-center justify-between gap-3">
              <h2 id="customer-h" className={cardTitle}>
                {t('order.customer')}
              </h2>
              {!incompleteId && !pasting && (
                <Button
                  variant="ghost"
                  className="-my-1 -mr-2 h-7 px-2 md:h-7"
                  onClick={() => setPasting(true)}
                >
                  {t('chat.paste')}
                </Button>
              )}
            </div>
            {canCustomers && (
              <CustomerSearch
                onPick={(c) => {
                  setCustomerId(c.id);
                  setPhone(formatPhone(c.phone));
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
                className="tabular-nums"
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
            </div>
            {normalized && quote.data && !quote.data.blocked && quote.data.firstOrder && (
              <p className="-mt-1.5 text-[13px] text-muted-foreground">
                {t('newOrder.firstOrder')}
              </p>
            )}
            {quote.data?.blocked && (
              <Notice tone="error" className="text-[13px]">
                <span role="alert">{t('newOrder.blocked')}</span>
                <label className="mt-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={allowBlocked}
                    onChange={(e) => setAllowBlocked(e.target.checked)}
                  />
                  {t('newOrder.allowBlocked')}
                </label>
              </Notice>
            )}
            {normalized && quote.data?.duplicate && (
              <Notice tone="warning" className="text-[13px]">
                {t('duplicate.newOrder')}{' '}
                <Link
                  to="/orders/$id"
                  params={{ id: quote.data.duplicate.id }}
                  target="_blank"
                  className="font-medium text-foreground underline underline-offset-2"
                >
                  {quote.data.duplicate.displayNumber}
                </Link>{' '}
                ({dateTime(locale, quote.data.duplicate.placedAt)})
              </Notice>
            )}
            {normalized && risk.data && risk.data.decided + risk.data.history.open > 0 && (
              <PhoneRecord risk={risk.data} />
            )}
            <div className="grid gap-3 md:grid-cols-2">
              <Field
                label={t('newOrder.emailLabel')}
                optional
                type="email"
                value={email}
                maxLength={254}
                onChange={(e) => setEmail(e.target.value)}
              />
              {/* A website order when it comes from an incomplete checkout. */}
              {!incompleteId && (
                <div className="flex flex-col">
                  <span id="source-l" className={fieldLabel}>
                    {t('order.source')}
                  </span>
                  <fieldset
                    aria-labelledby="source-l"
                    className="flex min-h-9 flex-wrap items-center gap-1.5 m-0 min-w-0 border-0 p-0"
                  >
                    {MANUAL_ORDER_SOURCES.map((s) => (
                      <button
                        key={s}
                        type="button"
                        aria-pressed={source === s}
                        className={chipClass}
                        onClick={() => {
                          setSource(s);
                          if (s === 'walk_in') setDelivery(false);
                        }}
                      >
                        {t(`source.${s}`)}
                      </button>
                    ))}
                  </fieldset>
                </div>
              )}
            </div>
          </section>

          <section aria-labelledby="items-h" className={cn(cardPadded, 'gap-3 md:gap-3')}>
            <h2 id="items-h" className={cardTitle}>
              {t('order.items')}
            </h2>
            {lines.length > 0 && (
              <ul aria-label={t('order.items')} className="flex flex-col">
                {lines.map((l, i) => {
                  const ql = q?.lines.find((x) => x.variantId === l.variantId);
                  const qty = Number(toLatin(l.quantity));
                  const low = l.available !== null && qty > l.available;
                  return (
                    <li
                      key={l.variantId}
                      className="grid grid-cols-[minmax(0,1fr)_auto_28px] items-center gap-x-2.5 gap-y-1 border-b border-border py-2.5 last:border-b-0 md:grid-cols-[minmax(0,1fr)_112px_100px_90px_28px]"
                    >
                      <span className="col-span-2 flex min-w-0 flex-col md:col-span-1">
                        <span className="truncate font-medium">{l.label}</span>
                        <span className="truncate text-xs">
                          {l.available !== null && (
                            <span className={low ? 'text-danger' : 'text-muted-foreground'}>
                              {t('order.available', { count: l.available })}
                            </span>
                          )}
                        </span>
                        {ql?.problem && (
                          <span className="text-xs text-danger">
                            {t(`lineProblem.${ql.problem}` as AdminKey)}
                          </span>
                        )}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 md:order-last md:size-7"
                        aria-label={t('order.removeLine', { item: l.label })}
                        onClick={() => setLines(lines.filter((_, j) => j !== i))}
                      >
                        <X aria-hidden className="size-4" />
                      </Button>
                      <span className="inline-flex h-10 w-fit items-center overflow-hidden rounded-lg border border-input bg-background md:h-8">
                        <button
                          type="button"
                          aria-label={t('order.oneLess')}
                          disabled={!(qty > 1)}
                          onClick={() => setQuantity(i, String(qty - 1))}
                          className="inline-flex h-full w-10 items-center justify-center hover:bg-accent disabled:opacity-40 md:w-8"
                        >
                          <Minus aria-hidden className="size-4" />
                        </button>
                        <input
                          inputMode="numeric"
                          aria-label={t('order.quantityOf', { item: l.label })}
                          value={l.quantity}
                          onChange={(e) => setQuantity(i, e.target.value)}
                          className="h-full w-[52px] border-x border-input bg-transparent text-center font-medium tabular-nums outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--color-ring)]"
                        />
                        <button
                          type="button"
                          aria-label={t('order.oneMore')}
                          onClick={() =>
                            setQuantity(i, String((Number.isInteger(qty) ? qty : 0) + 1))
                          }
                          className="inline-flex h-full w-10 items-center justify-center hover:bg-accent md:w-8"
                        >
                          <Plus aria-hidden className="size-4" />
                        </button>
                      </span>
                      <span className="text-[13px] text-muted-foreground tabular-nums max-md:text-right">
                        {ql ? t('order.each', { amount: money(ql.unitPrice) }) : ''}
                      </span>
                      <span className="text-right font-medium tabular-nums max-md:col-span-1">
                        {ql ? money(ql.total) : ''}
                      </span>
                    </li>
                  );
                })}
              </ul>
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
            {showErrors && !linesValid && (
              <p role="alert" className="-mt-1 text-[13px] text-danger">
                {t('newOrder.noLines')}
              </p>
            )}
          </section>

          <section aria-labelledby="delivery-h" className={cn(cardPadded, 'gap-3.5 md:gap-3.5')}>
            <h2 id="delivery-h" className={cardTitle}>
              {t('order.delivery')}
            </h2>
            <label className="flex cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
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
                    place={place}
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
                <PlacePicker value={place} onChange={setPlace} row />
                {showErrors && !address && (
                  <p role="alert" className="-mt-1.5 text-[13px] text-danger">
                    {t('newOrder.noAddress')}
                  </p>
                )}
                <div className="flex flex-col">
                  <span id="zone-l" className={fieldLabel}>
                    {t('order.zone')}
                  </span>
                  <fieldset
                    aria-labelledby="zone-l"
                    className="flex flex-wrap gap-1.5 m-0 min-w-0 border-0 p-0"
                  >
                    {zones.data
                      ?.filter((z) => z.active)
                      .map((z) => (
                        <button
                          key={z.id}
                          type="button"
                          aria-pressed={chosenZone === z.id}
                          className={chipClass}
                          // Pressing the zone you picked again goes back to the area's.
                          onClick={() => setZone(zone === z.id ? '' : z.id)}
                        >
                          {pickText(z.name, locale)} · {money(z.fee)}
                        </button>
                      ))}
                  </fieldset>
                  {(zone || district) && (
                    <p className={fieldHint}>
                      {zone
                        ? autoZone && autoZone !== zone
                          ? t('newOrder.zonePicked', { zone: zoneName(autoZone) })
                          : t('newOrder.zonePickedSame')
                        : t('newOrder.zoneByArea', { district: district ?? '' })}
                    </p>
                  )}
                </div>
              </>
            )}
          </section>

          <section aria-labelledby="discount-h" className={cn(cardPadded, 'gap-3.5 md:gap-3.5')}>
            <h2 id="discount-h" className={cardTitle}>
              {t('newOrder.discounts')}
            </h2>
            <div className="flex flex-col">
              <label htmlFor="offer-code" className={fieldLabel}>
                {t('newOrder.code')}{' '}
                <span className="font-normal text-muted-foreground">({t('form.optional')})</span>
              </label>
              {q?.code?.status === 'applied' && code.trim() ? (
                <div className="flex h-10 items-center gap-2 rounded-lg border border-input bg-muted pr-2.5 pl-3 md:h-9">
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-mono font-semibold">{code.trim().toUpperCase()}</span>
                    {q.promotions[0] && ` · ${pickText(q.promotions[0].title, locale)}`}
                  </span>
                  {q.promotions[0] && (
                    <span className="tabular-nums">−{money(q.promotions[0].amount)}</span>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="-mr-1 size-6 md:size-6"
                    aria-label={t('newOrder.removeCode')}
                    onClick={() => {
                      setCode('');
                      setCodeDraft('');
                    }}
                  >
                    <X aria-hidden className="size-4" />
                  </Button>
                </div>
              ) : (
                <>
                  <div className="flex gap-2">
                    <Input
                      id="offer-code"
                      placeholder="EID10"
                      maxLength={32}
                      autoCapitalize="characters"
                      className="min-w-0 flex-1 uppercase"
                      aria-invalid={q?.code && q.code.status !== 'applied' ? true : undefined}
                      value={codeDraft}
                      onChange={(e) => setCodeDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          setCode(codeDraft);
                        }
                      }}
                    />
                    <Button variant="secondary" onClick={() => setCode(codeDraft)}>
                      {t('newOrder.applyCode')}
                    </Button>
                  </div>
                  {q?.code && q.code.status !== 'applied' && (
                    <p className="mt-1.5 text-[13px] text-danger">
                      {t(`codeStatus.${q.code.status}` as AdminKey)}
                    </p>
                  )}
                </>
              )}
            </div>
            <div className="flex flex-col">
              <span id="manual-l" className={fieldLabel}>
                {t('newOrder.manualDiscount')}
              </span>
              <fieldset
                aria-labelledby="manual-l"
                className="flex flex-wrap gap-1.5 m-0 min-w-0 border-0 p-0"
              >
                {(['none', 'amount', 'percent'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={discountKind === k}
                    className={chipClass}
                    onClick={() => setDiscountKind(k)}
                  >
                    {t(`newOrder.discount.${k}`)}
                  </button>
                ))}
              </fieldset>
            </div>
            {discountKind !== 'none' && (
              <div className="grid gap-3 md:grid-cols-[160px_minmax(0,1fr)]">
                <div className="flex flex-col">
                  <label htmlFor="discount-v" className={fieldLabel}>
                    {t('newOrder.discountLabel')}
                  </label>
                  {discountKind === 'amount' ? (
                    <MoneyInput
                      id="discount-v"
                      value={discount}
                      aria-invalid={showErrors && !discountValid ? true : undefined}
                      onChange={(e) => setDiscount(e.target.value)}
                    />
                  ) : (
                    <span className="relative block">
                      <Input
                        id="discount-v"
                        inputMode="decimal"
                        className="pr-7 tabular-nums"
                        value={discount}
                        aria-invalid={showErrors && !discountValid ? true : undefined}
                        onChange={(e) => setDiscount(e.target.value)}
                      />
                      <span
                        aria-hidden
                        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground"
                      >
                        %
                      </span>
                    </span>
                  )}
                </div>
                <Field
                  label={t('newOrder.discountReason')}
                  placeholder={t('newOrder.discountReasonExample')}
                  value={discountReason}
                  maxLength={200}
                  onChange={(e) => setDiscountReason(e.target.value)}
                  error={
                    showErrors && !discountReason.trim() ? t('newOrder.discountWhy') : undefined
                  }
                />
              </div>
            )}
          </section>

          <section aria-labelledby="payment-h" className={cn(cardPadded, 'gap-3.5 md:gap-3.5')}>
            <h2 id="payment-h" className={cardTitle}>
              {t('order.payment')}
            </h2>
            {!walkIn && (
              <div role="radiogroup" aria-labelledby="payment-h" className="flex gap-1.5">
                {[false, true].map((p) => (
                  <RadioCard
                    key={String(p)}
                    name="paid"
                    className="flex-1"
                    checked={paid === p}
                    onChange={() => {
                      setPaid(p);
                      if (p && !amount && q) setAmount(String(q.totals.total / 100));
                    }}
                    label={t(p ? 'newOrder.paidAlreadyShort' : 'newOrder.cod')}
                    hint={t(p ? 'newOrder.paidAlreadyHint' : 'newOrder.codHint')}
                  />
                ))}
              </div>
            )}
            {(paid || walkIn) && (
              <>
                <div className="flex flex-col">
                  <span id="method-l" className={fieldLabel}>
                    {t('newOrder.paidBy')}
                  </span>
                  <ButtonChoices
                    name="method"
                    labelId="method-l"
                    value={method}
                    options={MANUAL_METHODS.map((m) => ({ value: m, label: t(`method.${m}`) }))}
                    onChange={(m) => {
                      setMethod(m);
                      if (walkIn) setPaid(true);
                    }}
                  />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="flex flex-col">
                    <label htmlFor="paid-amount" className={fieldLabel}>
                      {t('order.amount')}
                    </label>
                    <MoneyInput
                      id="paid-amount"
                      placeholder={q ? String(q.totals.total / 100) : undefined}
                      value={amount}
                      aria-invalid={showErrors && paid && !paidAmount ? true : undefined}
                      onChange={(e) => {
                        setAmount(e.target.value);
                        setPaid(true);
                      }}
                    />
                    {q && paidAmount ? (
                      <p className={fieldHint}>
                        {paidAmount < q.totals.total
                          ? t('newOrder.restOnDelivery', {
                              amount: money(q.totals.total - paidAmount),
                            })
                          : t('order.paidInFull')}
                      </p>
                    ) : null}
                  </div>
                  <Field
                    label={t('order.reference')}
                    optional
                    placeholder={t('order.transactionId')}
                    value={reference}
                    maxLength={100}
                    onChange={(e) => setReference(e.target.value)}
                  />
                </div>
              </>
            )}
          </section>

          <section aria-labelledby="note-h" className={cn(cardPadded, 'gap-2.5 md:gap-2.5')}>
            <h2 id="note-h" className={cardTitle}>
              {t('newOrder.note')}
            </h2>
            <Textarea
              aria-labelledby="note-h"
              maxLength={500}
              value={note}
              placeholder={t('newOrder.notePlaceholder')}
              onChange={(e) => setNote(e.target.value)}
            />
          </section>
        </div>

        <section
          aria-labelledby="summary-h"
          className={cn(cardPadded, 'gap-3 md:gap-3 lg:sticky lg:top-0')}
        >
          <div className="flex min-h-5 items-center gap-3">
            <h2 id="summary-h" className={cardTitle}>
              {t('newOrder.summary')}
            </h2>
            <span className="ms-auto text-[13px] text-muted-foreground">
              {itemCount === 0
                ? t('newOrder.noItems')
                : itemCount === 1
                  ? t('order.oneItem')
                  : t('order.itemCount', { count: itemCount })}
            </span>
          </div>
          <dl aria-live="polite" className="flex flex-col gap-1.5">
            {!q ? (
              // Nothing to quote yet: the rows at ৳0, as drawn.
              <>
                <Row label={t('order.subtotal')}>{money(0)}</Row>
                <Row label={t('order.delivery')}>{money(0)}</Row>
                <div className="mt-1 flex justify-between gap-3 border-t border-border pt-2.5 font-semibold tabular-nums">
                  <dt>{t('order.total')}</dt>
                  <dd>{money(0)}</dd>
                </div>
                <div className="flex justify-between gap-3 font-semibold tabular-nums">
                  <dt>{t(walkIn ? 'newOrder.paidInShop' : 'order.codDue')}</dt>
                  <dd>{money(0)}</dd>
                </div>
                <p className="sr-only">
                  {quote.isFetching ? t('loading') : t('newOrder.summaryEmpty')}
                </p>
              </>
            ) : (
              <>
                <Row label={t('order.subtotal')}>{money(q.totals.subtotal)}</Row>
                {q.promotions.map((p) => (
                  <Row key={p.promotionId} label={pickText(p.title, locale)}>
                    −{money(p.amount)}
                  </Row>
                ))}
                {q.manualDiscount && (
                  <Row label={t('newOrder.manualDiscount')}>−{money(q.manualDiscount.amount)}</Row>
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
                <div className="mt-1 flex justify-between gap-3 border-t border-border pt-2.5 font-semibold tabular-nums">
                  <dt>{t('order.total')}</dt>
                  <dd>{money(q.totals.total)}</dd>
                </div>
                {paid && paidAmount ? (
                  <Row label={t('order.paid')}>
                    <span className="text-success-foreground">−{money(paidAmount)}</span>
                  </Row>
                ) : null}
                <div className="flex justify-between gap-3 font-semibold tabular-nums">
                  <dt>{t(walkIn ? 'newOrder.paidInShop' : 'order.codDue')}</dt>
                  <dd>{money(collect)}</dd>
                </div>
              </>
            )}
            {quote.isError && <Notice tone="error">{orderErrorMessage(quote.error, t)}</Notice>}
          </dl>
          {place_.error && <Notice tone="error">{orderErrorMessage(place_.error, t)}</Notice>}
          {showErrors && !ready && (
            <Notice tone="error" className="md:hidden">
              {t('newOrder.incomplete')}
            </Notice>
          )}
          <div className="flex flex-col gap-2 [&>button]:w-full">
            <div className="contents max-md:hidden">{primary}</div>
            {!walkIn && (
              <Button
                variant="secondary"
                disabled={place_.isPending}
                onClick={() => submit({ confirm: false, completeNow: false })}
              >
                {t('newOrder.save')}
              </Button>
            )}
          </div>
        </section>
      </div>
      {/* Phones: what is left to collect and the main action, as drawn. */}
      <div className="sticky bottom-0 z-20 -mx-3 -mb-3 flex items-center gap-3 border-t border-border bg-background px-4 py-3 md:hidden">
        <span className="flex flex-1 flex-col">
          <span className="text-xs text-muted-foreground">
            {t(walkIn ? 'newOrder.paidInShop' : 'order.codDue')}
          </span>
          <span className="text-[17px] font-semibold tabular-nums">{money(collect)}</span>
        </span>
        {primary}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 tabular-nums">
      <dt className="truncate text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Finds an existing customer by phone or name (the canvas's combobox). */
function CustomerSearch({
  onPick,
}: {
  onPick: (c: { id: string; phone: string; name: string; email: string | null }) => void;
}) {
  const { t } = useLocale();
  const labelId = useId();
  const listId = useId();
  const [open, setOpen] = useState(false);
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
  const show = (next: boolean) => {
    setOpen(next);
    setText('');
    setQ('');
  };
  return (
    <div className="flex flex-col">
      <span id={labelId} className={fieldLabel}>
        {t('newOrder.findCustomer')}
      </span>
      <Popover.Root open={open} onOpenChange={show}>
        <Popover.Trigger asChild>
          <button
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-haspopup="listbox"
            aria-labelledby={labelId}
            className="flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-input bg-transparent pr-2.5 pl-3 text-left text-base shadow-xs hover:bg-accent md:h-9 md:text-sm dark:bg-white/[0.045]"
          >
            <span className="truncate text-muted-foreground">{t('newOrder.findPlaceholder')}</span>
            <ChevronsUpDown aria-hidden className="size-4 shrink-0 opacity-50" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={4}
            collisionPadding={8}
            className="z-50 flex w-[max(var(--radix-popover-trigger-width),15rem)] flex-col overflow-hidden rounded-lg border border-border bg-popover text-foreground shadow-md"
          >
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3 md:h-9">
              <Search aria-hidden className="size-4 shrink-0 opacity-50" />
              <input
                // biome-ignore lint/a11y/noAutofocus: the list opened to be searched.
                autoFocus
                type="search"
                aria-label={t('customers.search')}
                aria-controls={listId}
                placeholder={t('customers.search')}
                autoComplete="off"
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground focus-visible:shadow-none md:text-sm"
              />
            </div>
            <div
              id={listId}
              role="listbox"
              aria-label={t('newOrder.findCustomer')}
              className="max-h-[280px] overflow-y-auto p-1"
            >
              {q.length >= 2 && results.data?.length === 0 && (
                <p className="px-2 py-5 text-center text-sm text-muted-foreground">
                  {t('list.noOption')}
                </p>
              )}
              {results.data?.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  className="flex w-full flex-col rounded-md px-2 py-1.5 text-left text-sm leading-5 hover:bg-accent"
                  onClick={() => {
                    onPick(c);
                    show(false);
                  }}
                >
                  <span className="truncate">{c.name}</span>
                  <span className="truncate text-xs text-muted-foreground tabular-nums">
                    {formatPhone(c.phone)}
                  </span>
                </button>
              ))}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

/** The chosen customer's saved addresses, one tap to use (radio cards, as drawn). */
function SavedAddresses({
  customerId,
  place,
  onPick,
}: {
  customerId: string;
  place: PlaceDraft;
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
    <div className="flex flex-col">
      <span id="saved-l" className={fieldLabel}>
        {t('newOrder.savedAddresses')}
      </span>
      <div role="radiogroup" aria-labelledby="saved-l" className="flex flex-col gap-1.5">
        {addresses.map((a) => (
          <RadioCard
            key={a.id}
            name="saved-address"
            checked={place.areaId === a.areaId && place.line === a.line}
            onChange={() => onPick(a)}
            label={a.label || a.line}
            hint={[a.label ? a.line : '', areaName(a.areaId)].filter(Boolean).join(', ')}
          />
        ))}
      </div>
    </div>
  );
}

/** The phone's record in one line, and why it's risky, beside the customer's details. */
function PhoneRecord({ risk }: { risk: PhoneRisk }) {
  const counts = useRiskCounts();
  return (
    <div className="flex flex-col gap-1.5">
      <p className="flex flex-wrap items-center gap-2">
        <ScoreBadge risk={risk} />
        <span className="text-[13px] text-muted-foreground">{counts(risk)}</span>
      </p>
      {risk.risky && <RiskReasons risk={risk} />}
    </div>
  );
}
