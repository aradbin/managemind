// Promotions for the admin (phase-4-plan §3.13, §7): the API's types and
// queries, the builder's form state and its conversion to the API's input,
// and the plain-language summary ("15% off orders over ৳2,000 inside Dhaka,
// until 30 Oct").
import type { paths } from '@managemind/sdk';
import { formatDateTime, type Locale, type Params } from '@managemind/shared/i18n';
import type { PromotionAction, PromotionConditions } from '@managemind/shared/orders';
import { dhakaToUtc, utcToDhaka } from '@managemind/shared/storefront';
import type { AdminKey } from '../i18n';
import { api, unwrap } from './api';
import { compact, formatPrice, priceInput, readPrice } from './catalog';

export type Promotion =
  paths['/v1/admin/promotions/{id}']['get']['responses'][200]['content']['application/json'];
export type TestCartResult =
  paths['/v1/admin/promotions/test']['post']['responses'][200]['content']['application/json'];
export type PromotionState = Promotion['state'];

export interface PromotionFilters {
  state?: PromotionState | undefined;
  kind?: 'automatic' | 'code' | undefined;
  q?: string | undefined;
}

export const promotionsQuery = (filters: PromotionFilters) => ({
  queryKey: ['promotions', filters] as const,
  queryFn: async () =>
    unwrap(await api.GET('/v1/admin/promotions', { params: { query: compact(filters) } })),
});

export const promotionQuery = (id: string) => ({
  queryKey: ['promotion', id] as const,
  queryFn: async () =>
    unwrap(await api.GET('/v1/admin/promotions/{id}', { params: { path: { id } } })),
});

// ---- The builder's form ----------------------------------------------------------------

export const ACTION_TYPES = [
  'percent_off_order',
  'amount_off_order',
  'percent_off_items',
  'amount_off_items',
  'buy_x_get_y',
  'delivery_percent_off',
  'delivery_amount_off',
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export interface Selection {
  productIds: string[];
  categoryIds: string[];
  collectionIds: string[];
  /** Kept as set through the API; the builder picks products, not variants. */
  variantIds: string[];
}
export const emptySelection = (): Selection => ({
  productIds: [],
  categoryIds: [],
  collectionIds: [],
  variantIds: [],
});
const hasItems = (s: Selection) =>
  s.productIds.length + s.categoryIds.length + s.collectionIds.length + s.variantIds.length > 0;
const selection = (s: Selection) =>
  Object.fromEntries(Object.entries(s).filter(([, v]) => v.length)) as Partial<Selection>;
const toSelection = (
  s: { [K in keyof Selection]?: string[] | undefined } | undefined,
): Selection => ({
  productIds: s?.productIds ?? [],
  categoryIds: s?.categoryIds ?? [],
  collectionIds: s?.collectionIds ?? [],
  variantIds: s?.variantIds ?? [],
});

/** Everything as typed: text for numbers, so a half-typed value isn't lost. */
export interface Draft {
  titleBn: string;
  titleEn: string;
  kind: 'automatic' | 'code';
  code: string;
  status: 'draft' | 'active' | 'paused' | 'ended';
  startsAt: string;
  endsAt: string;
  priority: string;
  exclusive: boolean;
  maxDiscount: string;
  usageLimit: string;
  perCustomerLimit: string;
  actionType: ActionType;
  percent: string;
  amount: string;
  target: Selection;
  buyQuantity: string;
  buyItems: Selection;
  getQuantity: string;
  getSame: boolean;
  getItems: Selection;
  maxUses: string;
  minSubtotal: string;
  minQuantity: string;
  items: Selection;
  zoneIds: string[];
  firstOrder: boolean;
  customerTags: string;
  customerPhones: string;
  paymentMethods: ('cod' | 'manual' | 'online')[];
}

export const newDraft = (): Draft => ({
  titleBn: '',
  titleEn: '',
  kind: 'automatic',
  code: '',
  status: 'draft',
  startsAt: '',
  endsAt: '',
  priority: '0',
  exclusive: false,
  maxDiscount: '',
  usageLimit: '',
  perCustomerLimit: '',
  actionType: 'percent_off_order',
  percent: '10',
  amount: '',
  target: emptySelection(),
  buyQuantity: '2',
  buyItems: emptySelection(),
  getQuantity: '1',
  getSame: true,
  getItems: emptySelection(),
  maxUses: '',
  minSubtotal: '',
  minQuantity: '',
  items: emptySelection(),
  zoneIds: [],
  firstOrder: false,
  customerTags: '',
  customerPhones: '',
  paymentMethods: [],
});

const latin = (s: string) => s.replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d))).trim();
const int = (s: string) => (latin(s) === '' ? null : Number(latin(s)));
const bp = (s: string) => Math.round(Number(latin(s)) * 100);
const list = (s: string) =>
  s
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);

export function fromPromotion(p: Promotion): Draft {
  const d = newDraft();
  const c = p.conditions as PromotionConditions;
  const a = p.action as unknown as PromotionAction;
  Object.assign(d, {
    titleBn: p.title.bn ?? '',
    titleEn: p.title.en ?? '',
    kind: p.kind,
    code: p.code ?? '',
    status: p.status,
    startsAt: p.startsAt ? utcToDhaka(p.startsAt) : '',
    endsAt: p.endsAt ? utcToDhaka(p.endsAt) : '',
    priority: String(p.priority),
    exclusive: p.exclusive,
    maxDiscount: priceInput(p.maxDiscount),
    usageLimit: p.usageLimit === null ? '' : String(p.usageLimit),
    perCustomerLimit: p.perCustomerLimit === null ? '' : String(p.perCustomerLimit),
    actionType: a.type,
    minSubtotal: priceInput(c.minSubtotal),
    minQuantity: c.minQuantity === undefined ? '' : String(c.minQuantity),
    items: toSelection(c.items),
    zoneIds: c.zoneIds ?? [],
    firstOrder: c.firstOrder === true,
    customerTags: (c.customerTags ?? []).join(', '),
    customerPhones: (c.customerPhones ?? []).join('\n'),
    paymentMethods: c.paymentMethods ?? [],
  });
  if ('percentBp' in a) d.percent = String(a.percentBp / 100);
  if ('amount' in a) d.amount = priceInput(a.amount);
  if ('target' in a) d.target = toSelection(a.target);
  if (a.type === 'buy_x_get_y') {
    d.buyQuantity = String(a.buy.quantity);
    d.buyItems = toSelection(a.buy.items);
    d.getQuantity = String(a.get.quantity);
    d.getSame = !a.get.items;
    d.getItems = toSelection(a.get.items);
    d.percent = String(a.get.percentBp / 100);
    d.maxUses = a.maxUses === undefined ? '' : String(a.maxUses);
  }
  return d;
}

export type DraftProblem =
  | 'title'
  | 'code'
  | 'percent'
  | 'amount'
  | 'target'
  | 'buy'
  | 'get'
  | 'dates'
  | 'number';

/** The API's promotionInput, or what is wrong with the form. */
export function toInput(
  d: Draft,
): { ok: true; input: Record<string, unknown> } | { ok: false; problems: DraftProblem[] } {
  const problems = new Set<DraftProblem>();
  if (!d.titleBn.trim() && !d.titleEn.trim()) problems.add('title');
  if (d.kind === 'code' && d.code.trim() && !/^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$/.test(d.code.trim()))
    problems.add('code');
  const percent = bp(d.percent);
  const amount = readPrice(d.amount);
  const needsPercent = [
    'percent_off_order',
    'percent_off_items',
    'buy_x_get_y',
    'delivery_percent_off',
  ];
  if (needsPercent.includes(d.actionType) && !(percent >= 1 && percent <= 10_000))
    problems.add('percent');
  const needsAmount = ['amount_off_order', 'amount_off_items', 'delivery_amount_off'];
  if (needsAmount.includes(d.actionType) && !(typeof amount === 'number' && amount > 0))
    problems.add('amount');
  if (
    (d.actionType === 'percent_off_items' || d.actionType === 'amount_off_items') &&
    !hasItems(d.target)
  )
    problems.add('target');
  const buyQ = int(d.buyQuantity);
  const getQ = int(d.getQuantity);
  if (d.actionType === 'buy_x_get_y') {
    if (!buyQ || buyQ < 1 || !hasItems(d.buyItems)) problems.add('buy');
    if (!getQ || getQ < 1 || (!d.getSame && !hasItems(d.getItems))) problems.add('get');
  }
  if (d.startsAt && d.endsAt && d.endsAt <= d.startsAt) problems.add('dates');
  const numbers = [d.priority, d.usageLimit, d.perCustomerLimit, d.minQuantity, d.maxUses];
  if (numbers.some((n) => latin(n) !== '' && !Number.isInteger(Number(latin(n)))))
    problems.add('number');
  for (const m of [d.maxDiscount, d.minSubtotal])
    if (readPrice(m) === undefined) problems.add('number');
  if (problems.size) return { ok: false, problems: [...problems] };

  const action: Record<string, unknown> = { type: d.actionType };
  if (needsPercent.includes(d.actionType) && d.actionType !== 'buy_x_get_y')
    action.percentBp = percent;
  if (needsAmount.includes(d.actionType)) action.amount = amount;
  if (d.actionType === 'percent_off_items' || d.actionType === 'amount_off_items')
    action.target = selection(d.target);
  if (d.actionType === 'buy_x_get_y') {
    action.buy = { quantity: buyQ, items: selection(d.buyItems) };
    action.get = {
      quantity: getQ,
      percentBp: percent,
      ...(d.getSame ? {} : { items: selection(d.getItems) }),
    };
    if (int(d.maxUses)) action.maxUses = int(d.maxUses);
  }
  const conditions: Record<string, unknown> = {};
  const minSubtotal = readPrice(d.minSubtotal);
  if (minSubtotal) conditions.minSubtotal = minSubtotal;
  if (int(d.minQuantity)) conditions.minQuantity = int(d.minQuantity);
  if (hasItems(d.items)) conditions.items = selection(d.items);
  if (d.zoneIds.length) conditions.zoneIds = d.zoneIds;
  if (d.firstOrder) conditions.firstOrder = true;
  if (list(d.customerTags).length) conditions.customerTags = list(d.customerTags);
  if (list(d.customerPhones).length) conditions.customerPhones = list(d.customerPhones);
  if (d.paymentMethods.length) conditions.paymentMethods = d.paymentMethods;

  return {
    ok: true,
    input: {
      title: {
        ...(d.titleBn.trim() ? { bn: d.titleBn.trim() } : {}),
        ...(d.titleEn.trim() ? { en: d.titleEn.trim() } : {}),
      },
      kind: d.kind,
      status: d.status,
      startsAt: d.startsAt ? dhakaToUtc(d.startsAt) : null,
      endsAt: d.endsAt ? dhakaToUtc(d.endsAt) : null,
      priority: int(d.priority) ?? 0,
      exclusive: d.exclusive,
      maxDiscount: readPrice(d.maxDiscount) ?? null,
      usageLimit: int(d.usageLimit),
      perCustomerLimit: int(d.perCustomerLimit),
      conditions,
      action,
      ...(d.kind === 'code' && d.code.trim() ? { code: d.code.trim().toUpperCase() } : {}),
    },
  };
}

// ---- The summary sentence --------------------------------------------------------------

type T = (key: AdminKey, params?: Params) => string;

/** "the chosen items", or the one name when only one is chosen. */
function itemsText(s: Selection, t: T, names: (s: Selection) => string[]): string {
  const n = names(s);
  return n.length === 1 ? (n[0] as string) : t('promo.sum.items', { count: n.length || 0 });
}

/** One sentence that says what the promotion does, for the builder and the list. */
export function summarize(
  d: Draft,
  locale: Locale,
  t: T,
  names: { items: (s: Selection) => string[]; zones: (ids: string[]) => string[] },
): string {
  const money = (s: string) => {
    const v = readPrice(s);
    // Whole taka read better in a sentence: "৳2,000", not "৳2,000.00".
    return typeof v === 'number' ? formatPrice(v, locale).replace(/[.,][0০]{2}$/, '') : '…';
  };
  const pct = latin(d.percent) || '…';
  const items = (s: Selection) => itemsText(s, t, names.items);
  let action: string;
  switch (d.actionType) {
    case 'percent_off_order':
      action = t('promo.sum.percentOrder', { percent: pct });
      break;
    case 'percent_off_items':
      action = t('promo.sum.percentItems', { percent: pct, items: items(d.target) });
      break;
    case 'amount_off_order':
      action = t('promo.sum.amountOrder', { amount: money(d.amount) });
      break;
    case 'amount_off_items':
      action = t('promo.sum.amountItems', { amount: money(d.amount), items: items(d.target) });
      break;
    case 'buy_x_get_y': {
      const get = d.getSame ? t('promo.sum.more') : items(d.getItems);
      action =
        bp(d.percent) >= 10_000
          ? t('promo.sum.bxgyFree', {
              buy: latin(d.buyQuantity) || '…',
              buyItems: items(d.buyItems),
              get: latin(d.getQuantity) || '…',
              getItems: get,
            })
          : t('promo.sum.bxgy', {
              buy: latin(d.buyQuantity) || '…',
              buyItems: items(d.buyItems),
              get: latin(d.getQuantity) || '…',
              getItems: get,
              percent: pct,
            });
      break;
    }
    case 'delivery_percent_off':
      action =
        bp(d.percent) >= 10_000
          ? t('promo.sum.freeDelivery')
          : t('promo.sum.percentDelivery', { percent: pct });
      break;
    case 'delivery_amount_off':
      action = t('promo.sum.amountDelivery', { amount: money(d.amount) });
      break;
  }
  const parts = [action];
  if (readPrice(d.minSubtotal)) parts.push(t('promo.sum.over', { amount: money(d.minSubtotal) }));
  if (int(d.minQuantity))
    parts.push(t('promo.sum.minQuantity', { count: int(d.minQuantity) ?? 0 }));
  if (hasItems(d.items)) parts.push(t('promo.sum.with', { items: items(d.items) }));
  if (d.zoneIds.length)
    parts.push(t('promo.sum.zones', { zones: names.zones(d.zoneIds).join(', ') }));
  if (d.firstOrder) parts.push(t('promo.sum.firstOrder'));
  if (list(d.customerTags).length)
    parts.push(t('promo.sum.tags', { tags: list(d.customerTags).join(', ') }));
  if (list(d.customerPhones).length)
    parts.push(t('promo.sum.phones', { count: list(d.customerPhones).length }));
  if (d.paymentMethods.length === 1)
    parts.push(t(d.paymentMethods[0] === 'cod' ? 'promo.sum.cod' : 'promo.sum.prepaid'));
  if (d.kind === 'code')
    parts.push(t('promo.sum.code', { code: d.code.trim().toUpperCase() || '…' }));
  const date = (local: string) =>
    formatDateTime(locale, new Date(dhakaToUtc(local)), { day: 'numeric', month: 'short' });
  if (d.startsAt) parts.push(t('promo.sum.from', { date: date(d.startsAt) }));
  if (d.endsAt) parts.push(t('promo.sum.until', { date: date(d.endsAt) }));
  return parts.join(', ');
}
