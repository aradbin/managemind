// A stock count (phase-8-plan §3.5, §3.12, Q6, Q7). While counting: scan or
// type a barcode or SKU (a hardware scanner types into the box; scanning an
// item again adds one), or the phone's camera where the browser offers
// BarcodeDetector, or type each number. Counters never see what is expected.
// In review: expected, counted and the difference, largest value first, a
// recount, then Apply.
import type { Locale } from '@managemind/shared/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { Check, CircleX, Minus, Plus, Printer, ScanBarcode } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ConfirmDialog } from '../components/confirm-dialog';
import { RowMenu, RowMenuItem, RowMenuSeparator } from '../components/list-tools';
import { Notice } from '../components/notice';
import { BackLink } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { PhoneRecordHeader } from '../components/record-header';
import { useToast } from '../components/toast';
import { StatusBadge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { cardPadded } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { useLocale } from '../i18n';
import '../i18n/orders';
import '../i18n/purchasing';
import { api, unwrap } from '../lib/api';
import { useRecordPage } from '../lib/crumb';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import { dateOnly, lineLabel, pickText } from '../lib/orders';
import {
  PURCHASING_KEYS,
  priceOrDash,
  readCount,
  type StockCount,
  type StockCountLine,
  stockCountQuery,
} from '../lib/purchasing';
import { cn } from '../lib/utils';

interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
type DetectorClass = new (options?: { formats?: string[] }) => Detector;

export function StockCountPage() {
  const { t } = useLocale();
  const { id } = useParams({ strict: false }) as { id: string };
  const count = useQuery({
    ...stockCountQuery(id),
    // While the queue applies a large count, look again every few seconds.
    refetchInterval: (q) => (q.state.data?.status === 'applying' ? 3000 : false),
  });
  useRecordPage(count.data?.reference);
  if (count.isPending) return <p role="status">{t('loading')}</p>;
  if (count.isError) return <Notice tone="error">{errorMessage(count.error, t)}</Notice>;
  return <CountView count={count.data} />;
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
const value = (amount: number | undefined, locale: Locale) =>
  amount === undefined
    ? ''
    : amount < 0
      ? `−${priceOrDash(-amount, locale)}`
      : priceOrDash(amount, locale);

function CountView({ count }: { count: StockCount }) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canWrite = usePermission('inventory.write');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<'apply' | 'cancel' | null>(null);
  const editable = canWrite && (count.status === 'counting' || count.status === 'review');
  const review = count.status !== 'counting';

  const refresh = async () => {
    for (const key of PURCHASING_KEYS) await queryClient.invalidateQueries({ queryKey: key });
  };
  const save = useMutation({
    mutationFn: async ({ variantId, counted }: { variantId: string; counted: number | null }) =>
      unwrap(
        await api.PUT('/v1/admin/stock-counts/{id}/lines/{variantId}', {
          params: { path: { id: count.id, variantId } },
          body: { counted },
        }),
      ),
    onSuccess: async (line) => {
      setDrafts(({ [line.variantId]: _done, ...rest }) => rest);
      if (review) {
        await queryClient.invalidateQueries({ queryKey: ['stock-count', count.id] });
        return;
      }
      // While counting, only this line changed: no refetch of the whole count.
      queryClient.setQueryData<StockCount>(['stock-count', count.id], (old) =>
        old
          ? {
              ...old,
              countedLines: old.lines.filter((l) =>
                l.variantId === line.variantId ? line.counted !== null : l.counted !== null,
              ).length,
              lines: old.lines.map((l) =>
                l.variantId === line.variantId
                  ? { ...l, counted: line.counted, countedAt: line.countedAt }
                  : l,
              ),
            }
          : old,
      );
    },
  });
  const move = useMutation({
    mutationFn: async (event: 'submit' | 'reopen' | 'cancel' | 'apply') => {
      const path = {
        submit: '/v1/admin/stock-counts/{id}/submit',
        reopen: '/v1/admin/stock-counts/{id}/reopen',
        cancel: '/v1/admin/stock-counts/{id}/cancel',
        apply: '/v1/admin/stock-counts/{id}/apply',
      } as const;
      return unwrap(await api.POST(path[event], { params: { path: { id: count.id } } }));
    },
    onSuccess: async (after, event) => {
      queryClient.setQueryData(['stock-count', count.id], after);
      await refresh();
      setConfirm(null);
      if (event === 'apply' && after.status === 'applied') toast(t('counts.applied'));
      if (event === 'cancel') toast(t('counts.cancelled'));
    },
  });

  const commit = (line: StockCountLine) => {
    const text = drafts[line.variantId];
    if (text === undefined) return;
    const n = text.trim() === '' ? null : readCount(text);
    if (n !== null && Number.isNaN(n)) return;
    latest.current.delete(line.variantId);
    if (n === line.counted) {
      setDrafts(({ [line.variantId]: _same, ...rest }) => rest);
      return;
    }
    save.mutate({ variantId: line.variantId, counted: n });
  };

  // Scans ahead of the server's answers: two quick scans of one item are two.
  const latest = useRef(new Map<string, number>());
  /** A scanned or typed code: one more of the item it names. */
  const scanned = (code: string) => {
    const wanted = code.trim().toLowerCase();
    if (!wanted) return;
    const line = count.lines.find(
      (l) => l.barcode?.toLowerCase() === wanted || l.sku?.toLowerCase() === wanted,
    );
    if (!line) {
      toast(t('counts.notFound', { code: code.trim() }));
      return;
    }
    const next = (latest.current.get(line.variantId) ?? line.counted ?? 0) + 1;
    latest.current.set(line.variantId, next);
    save.mutate({ variantId: line.variantId, counted: next });
    toast(t('counts.added', { item: lineLabel(line, locale), n: next }));
  };

  const [tab, setTab] = useState<'all' | 'left' | 'counted' | 'different'>(
    review ? 'different' : 'all',
  );
  const lines = useMemo(
    () =>
      count.lines.filter((l) =>
        tab === 'left'
          ? l.counted === null
          : tab === 'counted'
            ? l.counted !== null
            : tab === 'different'
              ? Boolean(l.difference)
              : true,
      ),
    [count.lines, tab],
  );
  const d = count.differences;
  const overThreshold =
    count.approvalThreshold !== undefined &&
    count.lines.reduce((a, l) => a + Math.abs(l.value ?? 0), 0) > count.approvalThreshold;
  const left = count.lineCount - count.countedLines;
  const pct = count.lineCount ? Math.round((count.countedLines / count.lineCount) * 100) : 0;
  const tabs = review
    ? ([
        ['different', t('counts.tabDifferent'), count.lines.filter((l) => l.difference).length],
        ['all', t('counts.all'), count.lines.length],
      ] as const)
    : ([
        ['all', t('counts.all'), count.lines.length],
        ['left', t('counts.tabLeft'), left],
        ['counted', t('counts.tabCounted'), count.countedLines],
      ] as const);
  const open = count.status === 'counting' || count.status === 'review';
  const setCounted = (l: StockCountLine, next: number | null) => {
    latest.current.delete(l.variantId);
    setDrafts(({ [l.variantId]: _x, ...rest }) => rest);
    save.mutate({ variantId: l.variantId, counted: next });
  };
  const menu = (trigger: 'outline' | 'ghost') =>
    canWrite &&
    open && (
      <RowMenu label={t('list.moreActions')} trigger={trigger} page>
        <RowMenuItem onSelect={() => window.print()}>
          <Printer aria-hidden />
          {t('counts.print')}
        </RowMenuItem>
        <RowMenuSeparator />
        <RowMenuItem danger onSelect={() => setConfirm('cancel')}>
          <CircleX aria-hidden />
          {t('counts.cancel')}
        </RowMenuItem>
      </RowMenu>
    );
  const field = (l: StockCountLine, label: string) => (
    <Input
      inputMode="numeric"
      aria-label={`${t('counts.counted')}: ${label}`}
      placeholder="—"
      className="h-full w-[52px] rounded-none border-0 border-x border-input text-center font-medium tabular-nums shadow-none md:h-full"
      value={drafts[l.variantId] ?? (l.counted === null ? '' : String(l.counted))}
      onChange={(e) => setDrafts({ ...drafts, [l.variantId]: e.target.value })}
      onBlur={() => commit(l)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit(l);
      }}
    />
  );

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-3 md:gap-4">
      <PhoneRecordHeader
        to="/inventory/counts"
        backLabel={t('counts.back')}
        title={count.reference}
      >
        {menu('ghost')}
      </PhoneRecordHeader>
      <div className="flex flex-wrap items-center gap-3">
        <span className="max-md:hidden">
          <BackLink to="/inventory/counts" label={t('counts.back')} />
        </span>
        <h1 className="truncate font-mono text-xl leading-7 font-semibold tracking-[-0.01em] max-md:hidden">
          {count.reference}
        </h1>
        <StatusBadge tone={countTone(count.status)}>
          {t(`counts.status.${count.status}`)}
        </StatusBadge>
        <span className="flex-1" />
        {canWrite && count.status === 'counting' && (
          <Button disabled={move.isPending} onClick={() => move.mutate('submit')}>
            <Check aria-hidden />
            {t('counts.submit')}
          </Button>
        )}
        {canWrite && count.status === 'review' && (
          <>
            <Button
              variant="secondary"
              disabled={move.isPending}
              onClick={() => move.mutate('reopen')}
            >
              {t('counts.reopen')}
            </Button>
            <Button disabled={move.isPending} onClick={() => setConfirm('apply')}>
              {t('counts.apply')}
            </Button>
          </>
        )}
        <span className="max-md:hidden">{menu('outline')}</span>
      </div>
      <p className="-mt-2 text-muted-foreground">
        {[
          t('counts.progress', { counted: count.countedLines, total: count.lineCount }),
          t('counts.startedOn', { date: dateOnly(locale, count.createdAt) }),
        ].join(' · ')}
      </p>
      {count.note && <Notice>{count.note}</Notice>}
      {count.status === 'applying' && <Notice>{t('counts.applyingNote')}</Notice>}
      {count.status === 'applied' && <Notice>{t('counts.appliedNote')}</Notice>}
      {count.status === 'cancelled' && <Notice>{t('counts.cancelledNote')}</Notice>}
      {count.applyError && count.status === 'review' && (
        <Notice tone="error">{t('counts.applyError', { error: count.applyError })}</Notice>
      )}
      {move.isError && !confirm && <Notice tone="error">{saveErrorMessage(move.error, t)}</Notice>}
      {save.isError && <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>}

      {count.status === 'counting' && (
        <section
          aria-label={t('counts.progressLabel')}
          className={cn(cardPadded, 'gap-2.5 md:gap-2.5')}
        >
          <div className="flex justify-between gap-2">
            <span className="font-semibold">
              {t('counts.progress', { counted: count.countedLines, total: count.lineCount })}
            </span>
            <span className="text-muted-foreground">{t('counts.leftCount', { count: left })}</span>
          </div>
          <span aria-hidden className="block h-2 overflow-hidden rounded-full bg-muted">
            <span
              className={cn('block h-full rounded-full', left ? 'bg-primary' : 'bg-success')}
              style={{ width: `${pct}%` }}
            />
          </span>
        </section>
      )}
      {count.status === 'counting' && canWrite && <Scanner onCode={scanned} />}

      {review && d && (
        <p
          role="status"
          className="flex items-start gap-2.5 rounded-[10px] border border-border bg-muted px-3.5 py-3 font-medium shadow-xs"
        >
          {d.lines === 0
            ? t('counts.noDifferences')
            : t('counts.differences', { lines: d.lines, units: signed(d.units) })}
          {d.value !== undefined && d.lines > 0 && ` · ${value(d.value, locale)}`}
        </p>
      )}

      <div
        role="tablist"
        aria-label={t('counts.show')}
        className="inline-flex h-9 items-center self-start rounded-[10px] bg-muted p-[3px]"
      >
        {tabs.map(([key, label, n]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className="inline-flex h-[30px] items-center gap-1.5 rounded-lg border border-transparent px-2.5 text-[13px] font-medium text-muted-foreground aria-selected:bg-background aria-selected:text-foreground aria-selected:shadow-sm dark:aria-selected:border-input dark:aria-selected:bg-input"
          >
            {label}
            <span className="text-xs tabular-nums text-muted-foreground">{n}</span>
          </button>
        ))}
      </div>

      {lines.length === 0 ? (
        <p className="rounded-[10px] border border-dashed border-border p-4 text-muted-foreground">
          {t('counts.nothingHere')}
        </p>
      ) : !review ? (
        <ul
          aria-label={t('po.lines')}
          className="overflow-hidden rounded-[10px] border border-b-0 border-border"
        >
          {lines.map((l) => {
            const label = lineLabel(l, locale);
            const options = l.optionLabels
              .map((o) => pickText(o, locale))
              .filter(Boolean)
              .join(' / ');
            const n = l.counted ?? 0;
            return (
              <li
                key={l.variantId}
                className={cn(
                  'flex min-h-14 items-center gap-3 border-b border-border py-2 pr-3 pl-4',
                  l.counted !== null && 'bg-muted/40',
                )}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">
                    <span className="font-medium">{pickText(l.title, locale)}</span>
                    {options && <span className="text-muted-foreground"> · {options}</span>}
                  </span>
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {[l.sku, l.barcode].filter(Boolean).join(' · ')}
                  </span>
                </span>
                {editable && !l.applied ? (
                  <span className="inline-flex h-10 shrink-0 items-center overflow-hidden rounded-lg border border-input bg-background md:h-8">
                    <button
                      type="button"
                      aria-label={t('order.oneLess')}
                      disabled={!l.counted}
                      onClick={() => setCounted(l, Math.max(0, n - 1))}
                      className="inline-flex h-full w-10 items-center justify-center hover:bg-accent disabled:opacity-40 md:w-8"
                    >
                      <Minus aria-hidden className="size-4" />
                    </button>
                    {field(l, label)}
                    <button
                      type="button"
                      aria-label={t('order.oneMore')}
                      onClick={() => setCounted(l, n + 1)}
                      className="inline-flex h-full w-10 items-center justify-center hover:bg-accent md:w-8"
                    >
                      <Plus aria-hidden className="size-4" />
                    </button>
                  </span>
                ) : (
                  <span className="w-24 text-right tabular-nums">
                    {l.counted === null ? t('counts.notCounted') : l.counted}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="overflow-hidden rounded-[10px] border border-border">
          <div
            aria-hidden
            className="grid h-9 grid-cols-[minmax(0,1fr)_72px_88px_80px] items-center gap-x-3 bg-muted px-4 text-[13px] font-medium md:grid-cols-[minmax(0,1fr)_80px_96px_88px_96px]"
          >
            <span>{t('po.item')}</span>
            <span className="text-right">{t('counts.expected')}</span>
            <span className="text-center">{t('counts.counted')}</span>
            <span className="text-right">{t('counts.difference')}</span>
            <span className="text-right max-md:hidden">{t('counts.value')}</span>
          </div>
          <ul aria-label={t('po.lines')}>
            {lines.map((l) => {
              const label = lineLabel(l, locale);
              const options = l.optionLabels
                .map((o) => pickText(o, locale))
                .filter(Boolean)
                .join(' / ');
              return (
                <li
                  key={l.variantId}
                  className="grid min-h-[52px] grid-cols-[minmax(0,1fr)_72px_88px_80px] items-center gap-x-3 border-t border-border px-4 py-1.5 md:grid-cols-[minmax(0,1fr)_80px_96px_88px_96px]"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">{pickText(l.title, locale)}</span>
                    {options && (
                      <span className="truncate text-[13px] text-muted-foreground">{options}</span>
                    )}
                  </span>
                  <span className="text-right text-muted-foreground tabular-nums">
                    {l.expected ?? '—'}
                  </span>
                  <span className="flex justify-center">
                    {editable && !l.applied ? (
                      <Input
                        inputMode="numeric"
                        aria-label={`${t('counts.counted')}: ${label}`}
                        placeholder="—"
                        className="h-8 w-[72px] text-center tabular-nums md:h-8"
                        value={drafts[l.variantId] ?? (l.counted === null ? '' : String(l.counted))}
                        onChange={(e) => setDrafts({ ...drafts, [l.variantId]: e.target.value })}
                        onBlur={() => commit(l)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commit(l);
                        }}
                      />
                    ) : (
                      <span className="tabular-nums">{l.counted === null ? '—' : l.counted}</span>
                    )}
                  </span>
                  <span
                    className={cn(
                      'text-right tabular-nums',
                      l.difference ? 'font-semibold text-danger' : 'text-muted-foreground',
                    )}
                  >
                    {l.counted === null ? '—' : signed(l.difference ?? 0)}
                  </span>
                  <span className="text-right tabular-nums max-md:hidden">
                    {l.difference ? value(l.value, locale) : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm === 'apply' ? t('counts.apply') : t('counts.cancel')}
        confirmLabel={confirm === 'apply' ? t('counts.apply') : t('counts.cancel')}
        destructive={confirm === 'cancel'}
        busy={move.isPending}
        error={move.isError ? saveErrorMessage(move.error, t) : undefined}
        onConfirm={() => confirm && move.mutate(confirm)}
      >
        {confirm === 'apply' && d && (
          <div className="flex flex-col gap-2">
            <p>{t('counts.applyBody', { lines: d.lines, units: signed(d.units) })}</p>
            {d.value !== undefined && (
              <p>{t('counts.applyValue', { value: value(d.value, locale) })}</p>
            )}
            {overThreshold && count.approvalThreshold !== undefined && (
              <p className="text-sm text-muted-foreground">
                {t('counts.applyApproval', {
                  threshold: priceOrDash(count.approvalThreshold, locale),
                })}
              </p>
            )}
          </div>
        )}
        {confirm === 'cancel' && <p>{t('counts.cancelBody')}</p>}
      </ConfirmDialog>
    </div>
  );
}

const countTone = (status: StockCount['status']) =>
  status === 'applied'
    ? ('good' as const)
    : status === 'cancelled'
      ? ('outline' as const)
      : status === 'review'
        ? ('waiting' as const)
        : ('progress' as const);

/** The scan box, and the camera where the browser can read barcodes. */
function Scanner({ onCode }: { onCode: (code: string) => void }) {
  const { t } = useLocale();
  const [code, setCode] = useState('');
  const [camera, setCamera] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  // The camera keeps running across renders; it calls the latest handler.
  const handler = useRef(onCode);
  handler.current = onCode;
  const Detector = (globalThis as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
  useEffect(() => {
    if (!camera || !Detector) return;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    let last = '';
    const detector = new Detector();
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then(async (s) => {
        stream = s;
        if (!video.current) return;
        video.current.srcObject = s;
        await video.current.play();
        timer = setInterval(async () => {
          if (!video.current) return;
          const [found] = await detector.detect(video.current).catch(() => []);
          // The same code held in front of the camera counts once until another is seen.
          if (found && found.rawValue !== last) {
            last = found.rawValue;
            handler.current(found.rawValue);
          } else if (!found) last = '';
        }, 400);
      })
      .catch(() => setCamera(false));
    return () => {
      if (timer) clearInterval(timer);
      for (const track of stream?.getTracks() ?? []) track.stop();
    };
  }, [camera, Detector]);
  return (
    <section aria-label={t('counts.scanLabel')} className={cn(cardPadded, 'gap-3 md:gap-3')}>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onCode(code);
          setCode('');
        }}
      >
        <span className="relative block min-w-0 flex-1">
          <ScanBarcode
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label={t('counts.scan')}
            placeholder={t('counts.scan')}
            className="pl-9"
            value={code}
            autoComplete="off"
            autoFocus
            onChange={(e) => setCode(e.target.value)}
          />
        </span>
        <Button type="submit" variant="secondary">
          {t('counts.addScan')}
        </Button>
        {Detector && (
          <Button variant="secondary" aria-pressed={camera} onClick={() => setCamera(!camera)}>
            {camera ? t('counts.cameraStop') : t('counts.camera')}
          </Button>
        )}
      </form>
      <p className="text-[13px] text-muted-foreground">{t('counts.scanHint')}</p>
      {camera && (
        <video
          ref={video}
          className="max-h-64 w-full rounded-lg bg-black object-cover"
          muted
          playsInline
        />
      )}
    </section>
  );
}
