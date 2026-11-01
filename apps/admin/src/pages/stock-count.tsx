// A stock count (phase-8-plan §3.5, §3.12, Q6, Q7). While counting: scan or
// type a barcode or SKU (a hardware scanner types into the box; scanning an
// item again adds one), or the phone's camera where the browser offers
// BarcodeDetector, or type each number. Counters never see what is expected.
// In review: expected, counted and the difference, largest value first, a
// recount, then Apply.
import type { Locale } from '@managemind/shared/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ConfirmDialog } from '../components/confirm-dialog';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { useLocale } from '../i18n';
import '../i18n/orders';
import '../i18n/purchasing';
import { api, unwrap } from '../lib/api';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import { dateOnly, lineLabel } from '../lib/orders';
import {
  PURCHASING_KEYS,
  priceOrDash,
  readCount,
  type StockCount,
  type StockCountLine,
  stockCountQuery,
} from '../lib/purchasing';

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
  const [onlyLeft, setOnlyLeft] = useState(false);
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

  const lines = useMemo(
    () => (onlyLeft ? count.lines.filter((l) => l.counted === null) : count.lines),
    [count.lines, onlyLeft],
  );
  const d = count.differences;
  const overThreshold =
    count.approvalThreshold !== undefined &&
    count.lines.reduce((a, l) => a + Math.abs(l.value ?? 0), 0) > count.approvalThreshold;

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader
        className="mb-0"
        parent={{ to: '/inventory/counts', label: t('counts.title') }}
        title={count.reference}
        description={`${t(`counts.status.${count.status}`)} · ${t('counts.progress', {
          counted: count.countedLines,
          total: count.lineCount,
        })} · ${dateOnly(locale, count.createdAt)}`}
        actions={
          canWrite && (
            <>
              {count.status === 'counting' && (
                <Button disabled={move.isPending} onClick={() => move.mutate('submit')}>
                  {t('counts.submit')}
                </Button>
              )}
              {count.status === 'review' && (
                <>
                  <Button disabled={move.isPending} onClick={() => setConfirm('apply')}>
                    {t('counts.apply')}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={move.isPending}
                    onClick={() => move.mutate('reopen')}
                  >
                    {t('counts.reopen')}
                  </Button>
                </>
              )}
              {(count.status === 'counting' || count.status === 'review') && (
                <Button variant="quiet" onClick={() => setConfirm('cancel')}>
                  {t('counts.cancel')}
                </Button>
              )}
            </>
          )
        }
      />
      {count.note && <p className="whitespace-pre-line">{count.note}</p>}
      {count.status === 'applying' && <Notice tone="info">{t('counts.applyingNote')}</Notice>}
      {count.applyError && count.status === 'review' && (
        <Notice tone="error">{t('counts.applyError', { error: count.applyError })}</Notice>
      )}
      {move.isError && !confirm && <Notice tone="error">{saveErrorMessage(move.error, t)}</Notice>}
      {save.isError && <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>}
      {review && d && (
        <p className="font-medium">
          {d.lines === 0
            ? t('counts.noDifferences')
            : t('counts.differences', { lines: d.lines, units: signed(d.units) })}
          {d.value !== undefined && d.lines > 0 && ` · ${value(d.value, locale)}`}
        </p>
      )}

      {count.status === 'counting' && canWrite && <Scanner onCode={scanned} />}

      <section className="flex flex-col gap-3">
        <label className="flex min-h-10 items-center gap-2 text-sm md:min-h-9">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={onlyLeft}
            onChange={(e) => setOnlyLeft(e.target.checked)}
          />
          {t('counts.onlyLeft')}
        </label>
        <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-background">
          {lines.map((l) => {
            const label = lineLabel(l, locale);
            return (
              <li key={l.variantId} className="flex flex-wrap items-center gap-3 p-3">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium">{label}</span>
                  <span className="text-sm text-muted-foreground">
                    {[l.sku, l.barcode].filter(Boolean).join(' · ')}
                  </span>
                </div>
                {review && l.expected !== undefined && (
                  <dl className="grid grid-cols-3 gap-x-4 text-right text-sm tabular-nums">
                    <dt className="text-muted-foreground">{t('counts.expected')}</dt>
                    <dt className="text-muted-foreground">{t('counts.difference')}</dt>
                    <dt className="text-muted-foreground">
                      {l.value !== undefined ? t('counts.value') : ''}
                    </dt>
                    <dd>{l.expected}</dd>
                    <dd className={l.difference ? 'font-semibold text-danger' : undefined}>
                      {l.counted === null ? '—' : signed(l.difference ?? 0)}
                    </dd>
                    <dd>{l.difference ? value(l.value, locale) : ''}</dd>
                  </dl>
                )}
                {editable && !l.applied ? (
                  <Input
                    className="w-24"
                    inputMode="numeric"
                    aria-label={`${t('counts.counted')}: ${label}`}
                    placeholder="—"
                    value={drafts[l.variantId] ?? (l.counted === null ? '' : String(l.counted))}
                    onChange={(e) => setDrafts({ ...drafts, [l.variantId]: e.target.value })}
                    onBlur={() => commit(l)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commit(l);
                    }}
                  />
                ) : (
                  <span className="w-24 text-right tabular-nums">
                    {l.counted === null ? t('counts.notCounted') : l.counted}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </section>

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
    <section className="flex flex-col gap-2 rounded-xl border border-border bg-background p-4">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onCode(code);
          setCode('');
        }}
      >
        <Input
          aria-label={t('counts.scan')}
          placeholder={t('counts.scan')}
          value={code}
          autoComplete="off"
          autoFocus
          onChange={(e) => setCode(e.target.value)}
        />
        {Detector && (
          <Button variant="secondary" onClick={() => setCamera(!camera)}>
            {camera ? t('counts.cameraStop') : t('counts.camera')}
          </Button>
        )}
      </form>
      <p className="text-sm text-muted-foreground">{t('counts.scanHint')}</p>
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
