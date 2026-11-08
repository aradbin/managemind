// The promotion builder (phase-4-plan §3.13, §7): the action and conditions
// as a guided form, the plain-language summary as it is built, the test
// cart (which promotions a cart gets, and why the others don't, with this
// one tried as if live), and, for code promotions, batches of unique codes.

import { formatNumber } from '@managemind/shared/i18n';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { Check, ChevronDown, ChevronRight, CircleStop, Copy, Sparkles, X } from 'lucide-react';
import { type ReactNode, useEffect, useId, useState } from 'react';
import { LanguageSwitch } from '../components/catalog/language-tabs';
import { Field } from '../components/field';
import { fieldHint, fieldLabel } from '../components/field-styles';
import { ItemSelection, useSelectionNames } from '../components/item-selection';
import { RowMenu, RowMenuItem, RowMenuSeparator } from '../components/list-tools';
import { Notice } from '../components/notice';
import { BackLink } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { emptyPlace, type PlaceDraft, PlacePicker } from '../components/place-picker';
import { PhoneRecordHeader } from '../components/record-header';
import { SaveBar } from '../components/save-bar';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { cardPadded, cardTitle } from '../components/ui/card';
import { RadioCard } from '../components/ui/choice';
import { Combobox } from '../components/ui/combobox';
import { Dialog } from '../components/ui/dialog';
import { Input, Textarea } from '../components/ui/input';
import { menuContent, menuItem } from '../components/ui/menu';
import { chipClass } from '../components/ui/segmented';
import { StatRow } from '../components/ui/stat-row';
import { Switch } from '../components/ui/switch';
import { VariantPicker } from '../components/variant-picker';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/orders';
import '../i18n/promotions';
import { DateField } from '../components/date-field';
import { api, unwrap } from '../lib/api';
import { formatPrice } from '../lib/catalog';
import { useRecordPage } from '../lib/crumb';
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
import { cn } from '../lib/utils';
import { download, toCsv } from './export';

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

  const [lang, setLang] = useState<'bn' | 'en'>('bn');
  const [codesOpen, setCodesOpen] = useState(false);
  const title = promotion
    ? pickText(promotion.title, locale) || t('promo.untitled')
    : t('promo.new');
  useRecordPage(title);
  // "End now": the status is saved at once, with what else changed.
  const end = useMutation({
    mutationFn: async () => {
      if (!promotion) throw new Error('invalid');
      return unwrap(
        await api.PATCH('/v1/admin/promotions/{id}', {
          params: { path: { id: promotion.id } },
          body: { status: 'ended' },
        }),
      );
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['promotions'] });
      queryClient.setQueryData(['promotion', result.id], result);
      toast(t('promo.endedNow'));
    },
  });
  const sharedCode = promotion?.code ?? (d.code.trim() || null);
  const menu = (trigger: 'outline' | 'ghost') =>
    promotion && (
      <RowMenu label={t('list.moreActions')} trigger={trigger} page>
        {d.kind === 'code' && sharedCode && (
          <RowMenuItem
            onSelect={() =>
              navigator.clipboard
                ?.writeText(sharedCode)
                .then(() => toast(t('promo.codeCopied', { code: sharedCode })))
            }
          >
            <Copy aria-hidden />
            {t('promo.copyCode')}
          </RowMenuItem>
        )}
        {canWrite && (promotion.status === 'active' || promotion.status === 'paused') && (
          <>
            <RowMenuSeparator />
            <RowMenuItem danger disabled={end.isPending} onSelect={() => end.mutate()}>
              <CircleStop aria-hidden />
              {t('promo.endNow')}
            </RowMenuItem>
          </>
        )}
      </RowMenu>
    );
  const status = canWrite && (
    <PromoStatusMenu status={d.status} onChange={(s) => set({ status: s })} />
  );
  const affixL =
    'pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground';
  const affixR =
    'pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground';
  const chips = <T extends string>(
    labelId: string,
    options: readonly { value: T; label: string }[],
    value: readonly T[],
    onChange: (next: T[]) => void,
  ) => (
    <fieldset aria-labelledby={labelId} className="m-0 flex min-w-0 flex-wrap gap-1.5 border-0 p-0">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value.includes(o.value)}
          className={chipClass}
          onClick={() =>
            onChange(
              value.includes(o.value) ? value.filter((x) => x !== o.value) : [...value, o.value],
            )
          }
        >
          {o.label}
        </button>
      ))}
    </fieldset>
  );

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-3 pb-28 md:gap-4 md:pb-8">
      <PhoneRecordHeader to="/promotions" backLabel={t('promo.back')} title={title}>
        {status}
        {menu('ghost')}
      </PhoneRecordHeader>
      <div className="flex items-center gap-3 max-md:hidden">
        <BackLink to="/promotions" label={t('promo.back')} />
        <h1 className="min-w-0 flex-1 truncate text-xl leading-7 font-semibold tracking-[-0.01em]">
          {title}
        </h1>
        {status}
        {menu('outline')}
      </div>
      {promotion && (
        <StatRow
          stats={[
            { label: t('promo.uses'), value: formatNumber(locale, promotion.usageCount) },
            { label: t('promo.orders'), value: formatNumber(locale, promotion.orders) },
            {
              label: t('promo.discountGiven'),
              value: formatPrice(promotion.discountTotal, locale),
            },
            { label: t('promo.sales'), value: formatPrice(promotion.sales, locale) },
          ]}
        />
      )}
      <p
        aria-live="polite"
        className="sticky -top-3 z-[15] flex items-start gap-2.5 rounded-[10px] border border-border bg-muted px-3.5 py-3 font-medium shadow-xs md:-top-5"
      >
        <Sparkles aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        {sentence}
      </p>
      {showProblems && !built.ok && <Notice tone="error">{t('newOrder.incomplete')}</Notice>}
      {save.error && !(save.error instanceof Error && save.error.message === 'invalid') && (
        <Notice tone="error">{orderErrorMessage(save.error, t)}</Notice>
      )}
      <form
        id={formId}
        className="contents"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <fieldset
          disabled={!canWrite || save.isPending}
          className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0 md:gap-4"
        >
          <section aria-labelledby="promo-basics" className={cardPadded}>
            <h2 id="promo-basics" className={cardTitle}>
              {t('promo.basics')}
            </h2>
            <div className="flex flex-col">
              <div className="mb-2 flex min-h-8 items-center justify-between gap-2">
                <label htmlFor="promo-title" className={cn(fieldLabel, 'mb-0')}>
                  {t('product.titleLabel')}
                </label>
                {d.titleEn || lang === 'en' ? (
                  <LanguageSwitch defaultLang="bn" active={lang} onChange={setLang} />
                ) : (
                  <Button
                    variant="ghost"
                    className="-mr-2 h-7 px-2 text-muted-foreground md:h-7"
                    onClick={() => setLang('en')}
                  >
                    {t('product.addLang', { language: 'English' })}
                  </Button>
                )}
              </div>
              <Input
                id="promo-title"
                lang={lang}
                aria-label={t(lang === 'bn' ? 'promo.titleBn' : 'promo.titleEn')}
                maxLength={100}
                aria-invalid={lang === 'bn' && problem('title') ? true : undefined}
                value={lang === 'bn' ? d.titleBn : d.titleEn}
                onChange={(e) =>
                  set(lang === 'bn' ? { titleBn: e.target.value } : { titleEn: e.target.value })
                }
              />
              {problem('title') && (
                <p role="alert" className={cn(fieldHint, 'text-danger')}>
                  {problem('title')}
                </p>
              )}
              <p className={fieldHint}>{t('promo.titleHint')}</p>
            </div>
            <div className="flex flex-col">
              <span id="promo-kind-l" className={fieldLabel}>
                {t('promo.kind')}
              </span>
              <div
                role="radiogroup"
                aria-labelledby="promo-kind-l"
                className="grid gap-2.5 md:grid-cols-2"
              >
                {(['automatic', 'code'] as const).map((k) => (
                  <RadioCard
                    key={k}
                    name="promo-kind"
                    className="items-start p-3 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
                    checked={d.kind === k}
                    onChange={() => !promotion && set({ kind: k })}
                    label={t(`promo.kind.${k}`)}
                    hint={t(`promo.kindHint.${k}`)}
                  />
                ))}
              </div>
              {promotion && <p className={fieldHint}>{t('promo.kindLocked')}</p>}
            </div>
            {d.kind === 'code' && (
              <div className="flex flex-col">
                <label htmlFor="promo-code" className={fieldLabel}>
                  {t('promo.sharedCode')}{' '}
                  <span className="font-normal text-muted-foreground">({t('form.optional')})</span>
                </label>
                <div className="flex gap-2">
                  <Input
                    id="promo-code"
                    className="max-w-[260px] font-mono uppercase"
                    maxLength={32}
                    autoCapitalize="characters"
                    placeholder="EID500"
                    aria-describedby="promo-code-hint"
                    aria-invalid={problem('code') ? true : undefined}
                    value={d.code}
                    onChange={(e) => set({ code: e.target.value })}
                  />
                  <Button variant="secondary" onClick={() => set({ code: suggestCode(d) })}>
                    {t('promo.suggestCode')}
                  </Button>
                </div>
                {problem('code') && (
                  <p role="alert" className={cn(fieldHint, 'text-danger')}>
                    {problem('code')}
                  </p>
                )}
                <p id="promo-code-hint" className={fieldHint}>
                  {t('promo.sharedCodeHint')}
                </p>
              </div>
            )}
          </section>

          <section aria-labelledby="promo-action" className={cardPadded}>
            <h2 id="promo-action" className={cardTitle}>
              {t('promo.action')}
            </h2>
            <div className="flex flex-col">
              <label htmlFor="promo-action-type" className={fieldLabel}>
                {t('promo.actionType')}
              </label>
              <Combobox
                id="promo-action-type"
                searchLabel={t('promo.findAction')}
                value={d.actionType}
                options={ACTION_TYPES.map((a) => ({
                  value: a,
                  label: t(`promo.actionType.${a}`),
                }))}
                onChange={(v) => set({ actionType: v as Draft['actionType'] })}
              />
            </div>
            {percentAction.includes(d.actionType) && (
              <div className="flex flex-col">
                <label htmlFor="promo-percent" className={fieldLabel}>
                  {t('promo.percent')}
                </label>
                <div className="flex items-center gap-2">
                  <span className="relative block w-40">
                    <Input
                      id="promo-percent"
                      inputMode="decimal"
                      className="pr-7 tabular-nums"
                      aria-invalid={problem('percent') ? true : undefined}
                      value={d.percent}
                      onChange={(e) => set({ percent: e.target.value })}
                    />
                    <span aria-hidden className={affixR}>
                      %
                    </span>
                  </span>
                  {d.actionType === 'delivery_percent_off' && (
                    <button
                      type="button"
                      aria-pressed={d.percent === '100'}
                      className={cn(chipClass, 'h-9 px-3 md:h-9')}
                      onClick={() => set({ percent: '100' })}
                    >
                      {t('promo.freeDelivery')}
                    </button>
                  )}
                </div>
                {problem('percent') && (
                  <p role="alert" className={cn(fieldHint, 'text-danger')}>
                    {problem('percent')}
                  </p>
                )}
              </div>
            )}
            {amountAction.includes(d.actionType) && (
              <div className="flex flex-col">
                <label htmlFor="promo-amount" className={fieldLabel}>
                  {t('promo.amount')}
                </label>
                <span className="relative block w-[200px]">
                  <span aria-hidden className={affixL}>
                    ৳
                  </span>
                  <Input
                    id="promo-amount"
                    inputMode="decimal"
                    className="pl-7 tabular-nums"
                    aria-invalid={problem('amount') ? true : undefined}
                    value={d.amount}
                    onChange={(e) => set({ amount: e.target.value })}
                  />
                </span>
                {problem('amount') && (
                  <p role="alert" className={cn(fieldHint, 'text-danger')}>
                    {problem('amount')}
                  </p>
                )}
              </div>
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
                <div className="flex min-h-10 items-center justify-between gap-4">
                  <label htmlFor="promo-same" className="cursor-pointer">
                    {t('promo.getSame')}
                  </label>
                  <Switch
                    id="promo-same"
                    checked={d.getSame}
                    onCheckedChange={(getSame) => set({ getSame })}
                  />
                </div>
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
                  optional
                  hint={t('promo.maxUsesHint')}
                  inputMode="numeric"
                  value={d.maxUses}
                  onChange={(e) => set({ maxUses: e.target.value })}
                />
              </>
            )}
          </section>

          <section aria-labelledby="promo-conditions" className={cardPadded}>
            <div className="flex flex-col gap-1">
              <h2 id="promo-conditions" className={cardTitle}>
                {t('promo.conditions')}
              </h2>
              <p className="text-muted-foreground">{t('promo.conditionsHint')}</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="flex flex-col">
                <label htmlFor="promo-min-subtotal" className={fieldLabel}>
                  {t('promo.minSubtotal')}
                </label>
                <span className="relative block">
                  <span aria-hidden className={affixL}>
                    ৳
                  </span>
                  <Input
                    id="promo-min-subtotal"
                    inputMode="decimal"
                    className="pl-7 tabular-nums"
                    value={d.minSubtotal}
                    onChange={(e) => set({ minSubtotal: e.target.value })}
                  />
                </span>
              </div>
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
              <div className="flex flex-col">
                <span id="promo-zones-l" className={fieldLabel}>
                  {t('promo.zones')}
                </span>
                {chips(
                  'promo-zones-l',
                  zones.data.map((z) => ({ value: z.id, label: pickText(z.name, locale) })),
                  d.zoneIds,
                  (zoneIds) => set({ zoneIds }),
                )}
              </div>
            )}
            <div className="flex flex-col">
              <span id="promo-pay-l" className={fieldLabel}>
                {t('promo.paymentMethods')}
              </span>
              {chips(
                'promo-pay-l',
                (['cod', 'manual', 'online'] as const).map((m) => ({
                  value: m,
                  label: t(`promo.payment.${m}`),
                })),
                d.paymentMethods,
                (paymentMethods) => set({ paymentMethods }),
              )}
            </div>
            <div className="flex min-h-10 items-center justify-between gap-4">
              <label htmlFor="promo-first" className="flex cursor-pointer flex-col">
                {t('promo.firstOrder')}
                <span className="text-[13px] text-muted-foreground">
                  {t('promo.firstOrderHint')}
                </span>
              </label>
              <Switch
                id="promo-first"
                checked={d.firstOrder}
                onCheckedChange={(firstOrder) => set({ firstOrder })}
              />
            </div>
            <Field
              label={t('promo.customerTags')}
              optional
              hint={t('order.tagsHint')}
              value={d.customerTags}
              onChange={(e) => set({ customerTags: e.target.value })}
            />
            <div className="flex flex-col">
              <label htmlFor="promo-phones" className={fieldLabel}>
                {t('promo.customerPhones')}{' '}
                <span className="font-normal text-muted-foreground">({t('form.optional')})</span>
              </label>
              <Textarea
                id="promo-phones"
                value={d.customerPhones}
                onChange={(e) => set({ customerPhones: e.target.value })}
                aria-describedby="promo-phones-hint"
              />
              <p id="promo-phones-hint" className={fieldHint}>
                {t('promo.customerPhonesHint')}
              </p>
            </div>
          </section>

          <section aria-labelledby="promo-limits" className={cardPadded}>
            <h2 id="promo-limits" className={cardTitle}>
              {t('promo.scheduleLimits')}
            </h2>
            <div className="grid gap-3 md:grid-cols-2">
              <DateField
                time
                label={t('promo.startsAt')}
                hint={t('promo.startsHint')}
                value={d.startsAt}
                onChange={(startsAt) => set({ startsAt })}
              />
              <DateField
                time
                label={t('promo.endsAt')}
                hint={t('promo.endsHint')}
                value={d.endsAt}
                onChange={(endsAt) => set({ endsAt })}
                error={problem('dates')}
              />
              <Field
                label={t('promo.usageLimit')}
                optional
                inputMode="numeric"
                value={d.usageLimit}
                onChange={(e) => set({ usageLimit: e.target.value })}
              />
              <Field
                label={t('promo.perCustomerLimit')}
                optional
                inputMode="numeric"
                value={d.perCustomerLimit}
                onChange={(e) => set({ perCustomerLimit: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-4 border-t border-dashed border-border pt-4">
              <p className="font-medium">{t('promo.capPriority')}</p>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="flex flex-col">
                  <label htmlFor="promo-max" className={fieldLabel}>
                    {t('promo.maxDiscount')}{' '}
                    <span className="font-normal text-muted-foreground">
                      ({t('form.optional')})
                    </span>
                  </label>
                  <span className="relative block">
                    <span aria-hidden className={affixL}>
                      ৳
                    </span>
                    <Input
                      id="promo-max"
                      inputMode="decimal"
                      className="pl-7 tabular-nums"
                      value={d.maxDiscount}
                      onChange={(e) => set({ maxDiscount: e.target.value })}
                    />
                  </span>
                </div>
                <Field
                  label={t('promo.priority')}
                  hint={t('promo.priorityHint')}
                  inputMode="numeric"
                  value={d.priority}
                  onChange={(e) => set({ priority: e.target.value })}
                />
              </div>
              {problem('number') && <p className="text-sm text-danger">{problem('number')}</p>}
              <div className="flex min-h-10 items-center justify-between gap-4">
                <label htmlFor="promo-exclusive" className="flex cursor-pointer flex-col">
                  {t('promo.exclusive')}
                  <span className="text-[13px] text-muted-foreground">
                    {t('promo.exclusiveHint')}
                  </span>
                </label>
                <Switch
                  id="promo-exclusive"
                  checked={d.exclusive}
                  onCheckedChange={(exclusive) => set({ exclusive })}
                />
              </div>
            </div>
          </section>
        </fieldset>
      </form>
      {d.kind === 'code' &&
        (promotion ? (
          <Codes promotion={promotion} />
        ) : (
          <section aria-labelledby="promo-codes" className={cardPadded}>
            <h2 id="promo-codes" className={cardTitle}>
              {t('promo.codes')}
            </h2>
            <p className="text-muted-foreground">{t('promo.codesAfter')}</p>
          </section>
        ))}
      <section aria-labelledby="test-cart" className={cardPadded}>
        <h2 id="test-cart" className={cardTitle}>
          <button
            type="button"
            aria-expanded={codesOpen}
            onClick={() => setCodesOpen(!codesOpen)}
            className="flex w-full items-center gap-2 text-left [&[aria-expanded=true]>svg]:rotate-90"
          >
            <ChevronRight aria-hidden className="size-4 transition-transform duration-200" />
            {t('promo.testCart')}
          </button>
        </h2>
        <p className="-mt-2 text-muted-foreground">{t('promo.testCartHint')}</p>
        {codesOpen && <TestCart draft={built.ok ? built.input : undefined} promotion={promotion} />}
      </section>
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

/** A code from the title's first letters and a number ("EID500"). */
function suggestCode(d: Draft): string {
  const letters = (d.titleEn || '')
    .replace(/[^A-Za-z ]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.slice(0, 3))
    .join('')
    .slice(0, 6)
    .toUpperCase();
  const number = d.amount.trim() || d.percent.trim() || String(Math.floor(Math.random() * 90) + 10);
  return `${letters || 'SAVE'}${number.replace(/\D/g, '').slice(0, 4)}`;
}

/** Draft, Active, Paused or Ended, as the board's dropdown with its hints. */
function PromoStatusMenu({
  status,
  onChange,
}: {
  status: Draft['status'];
  onChange: (status: Draft['status']) => void;
}) {
  const { t } = useLocale();
  const dot: Record<Draft['status'], string> = {
    draft: 'border-[1.5px] border-dashed border-muted-foreground',
    active: 'bg-success',
    paused: 'bg-[var(--tone-warn)]',
    ended: 'bg-muted-foreground',
  };
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button
          variant="secondary"
          className="gap-2 pr-2 pl-2.5"
          aria-label={t('product.statusIs', { status: t(`promo.status.${status}`) })}
        >
          <span aria-hidden className={cn('size-2 shrink-0 rounded-full', dot[status])} />
          {t(`promo.status.${status}`)}
          <ChevronDown aria-hidden className="size-4 opacity-50" />
        </Button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={4} className={cn(menuContent, 'w-[260px]')}>
          <Menu.RadioGroup value={status} onValueChange={(v) => onChange(v as Draft['status'])}>
            {(['draft', 'active', 'paused', 'ended'] as const).map((s) => (
              <Menu.RadioItem key={s} value={s} className={cn(menuItem, 'items-start py-1.5')}>
                <span className="flex flex-1 flex-col">
                  <span className="font-medium">{t(`promo.status.${s}`)}</span>
                  <span className="text-[13px] text-muted-foreground">
                    {t(`promo.statusHint.${s}`)}
                  </span>
                </span>
                <Menu.ItemIndicator>
                  <Check aria-hidden className="mt-0.5 size-4" />
                </Menu.ItemIndicator>
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
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
    <div className="flex flex-col gap-4">
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
      <div className="flex flex-col">
        <span id="test-pay-l" className={fieldLabel}>
          {t('order.payment')}
        </span>
        <fieldset aria-labelledby="test-pay-l" className="m-0 flex flex-wrap gap-1.5 border-0 p-0">
          {(['cod', 'manual', 'online'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={payment === m}
              className={chipClass}
              onClick={() => setPayment(m)}
            >
              {t(`promo.payment.${m}`)}
            </button>
          ))}
        </fieldset>
      </div>
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
                    className={
                      r.applied ? 'font-medium text-success-foreground' : 'text-muted-foreground'
                    }
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
    </div>
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
    <section aria-labelledby="promo-codes" className={cardPadded}>
      <h2 id="promo-codes" className={cardTitle}>
        {t('promo.codes')}
      </h2>
      <p className="-mt-2 text-muted-foreground">
        {t('promo.codesIntro')} {t('promo.codesCount', { count: promotion.codeCount })}
      </p>
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
