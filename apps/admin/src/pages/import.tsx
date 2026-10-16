// The import wizard (phase-2-plan §3.7, §7, PR 14): choose a file, map its
// columns, see the dry run's errors per row before anything is sent, start
// the job, follow its progress, then run the image step (images fetched by
// URL, resized and uploaded here, a few at a time). The job ID is in the URL,
// so a closed tab picks up where it stopped.
import {
  type ColumnRef,
  chunkProducts,
  columnId,
  type DryRunResult,
  dryRunImport,
  exportHeader,
  IMPORT_FIELDS,
  type ImportField,
  isLocalizedField,
  type MappedRow,
  matchHeader,
} from '@managemind/shared/catalog/import';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { FileUp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { CatalogNav } from '../components/catalog-nav';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { Button } from '../components/ui/button';
import { useLocale } from '../i18n';
import { ApiError, api, unwrap } from '../lib/api';
import { attributesQuery, type ImportJob, storeSettingsQuery } from '../lib/catalog';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import { prepareImage, uploadImage } from '../lib/images';
import { download, toCsv } from './export';

const CHUNK = 10;
const IMAGE_CONCURRENCY = 3;

interface Parsed {
  fileName: string;
  header: string[];
  rows: string[][];
}

/** The file's first sheet (xlsx) or the CSV, as text cells; each parser loads only when needed. */
async function parseFile(file: File): Promise<Parsed> {
  let table: string[][];
  if (/\.xlsx$/i.test(file.name)) {
    const { readXlsx } = await import('../lib/xlsx');
    table = await readXlsx(file);
  } else {
    const Papa = (await import('papaparse')).default;
    const text = (await file.text()).replace(/^﻿/, '');
    table = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' }).data;
  }
  const [header = [], ...rows] = table;
  return { fileName: file.name, header: header.map((h) => String(h ?? '').trim()), rows };
}

export function ImportPage() {
  const { t } = useLocale();
  const search = useSearch({ strict: false }) as { job?: string };
  const navigate = useNavigate();
  const canWrite = usePermission('catalog.write');
  const [parsed, setParsed] = useState<Parsed | null>(null);
  if (!canWrite) return <Notice>{t('import.notAllowed')}</Notice>;
  return (
    <div className="flex max-w-5xl flex-col">
      <PageHeader title={t('catalog.import')} description={t('import.intro')} />
      <CatalogNav />
      {search.job ? (
        <JobProgress
          jobId={search.job}
          onNew={() => {
            setParsed(null);
            navigate({ to: '/catalog/import', search: {} });
          }}
        />
      ) : parsed ? (
        <Mapping
          parsed={parsed}
          onCancel={() => setParsed(null)}
          onStarted={(job) => navigate({ to: '/catalog/import', search: { job } })}
        />
      ) : (
        <ChooseFile onParsed={setParsed} />
      )}
    </div>
  );
}

function ChooseFile({ onParsed }: { onParsed: (p: Parsed) => void }) {
  const { t } = useLocale();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const jobs = useQuery({
    queryKey: ['imports'],
    queryFn: async () => unwrap(await api.GET('/v1/admin/imports')),
  });
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-start gap-3 rounded-md border border-dashed border-border p-6">
        <p>{t('import.choose')}</p>
        <p className="text-sm text-muted-foreground">{t('import.formatHint')}</p>
        <input
          ref={input}
          type="file"
          accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          // The button below opens it; screen readers meet only the button.
          tabIndex={-1}
          aria-hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setBusy(true);
            setError(undefined);
            try {
              const result = await parseFile(file);
              if (!result.rows.length) throw new Error('empty');
              onParsed(result);
            } catch {
              setError(t('import.unreadable'));
            } finally {
              setBusy(false);
              if (input.current) input.current.value = '';
            }
          }}
        />
        <Button disabled={busy} onClick={() => input.current?.click()}>
          <FileUp aria-hidden className="size-4" />
          {busy ? t('loading') : t('import.chooseFile')}
        </Button>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
      {(jobs.data?.length ?? 0) > 0 && (
        <section aria-labelledby="recent-imports" className="flex flex-col gap-2">
          <h2 id="recent-imports" className="font-semibold">
            {t('import.recent')}
          </h2>
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {jobs.data?.map((job) => (
              <li
                key={job.id}
                className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
              >
                <span>
                  <span className="font-medium">{job.fileName}</span> ·{' '}
                  {t(`import.status.${job.status}`)} ·{' '}
                  {t('import.counts', {
                    created: job.created,
                    updated: job.updated,
                    failed: job.failed,
                  })}
                </span>
                <Link to="/catalog/import" search={{ job: job.id }} className="underline">
                  {t('import.open')}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ---- Mapping and the dry run --------------------------------------------------------

/** A mapping choice for one column: a known column, or ignored. */
type Choice = ColumnRef | null;

const refValue = (ref: Choice) => (ref ? columnId(ref) : '');
function refFrom(value: string): Choice {
  if (!value) return null;
  const [field, a, b] = value.split(':') as [ImportField, string?, string?];
  if (field === 'attribute')
    return b
      ? { field, attributeKey: a as string, locale: b as 'bn' | 'en' }
      : { field, attributeKey: a as string };
  return a ? { field, locale: a as 'bn' | 'en' } : { field };
}

function Mapping({
  parsed,
  onCancel,
  onStarted,
}: {
  parsed: Parsed;
  onCancel: () => void;
  onStarted: (job: string) => void;
}) {
  const { t, locale } = useLocale();
  const queryClient = useQueryClient();
  const store = useQuery(storeSettingsQuery);
  const attributes = useQuery(attributesQuery);
  const canStock = usePermission('inventory.write');
  const [choices, setChoices] = useState<Choice[]>(() => parsed.header.map((h) => matchHeader(h)));
  const [dry, setDry] = useState<DryRunResult | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const defaultLang = store.data?.defaultLocale ?? 'bn';
  const known = new Set((attributes.data ?? []).map((a) => a.key));
  const unknownAttributes = [
    ...new Set(
      choices
        .filter((c) => c?.field === 'attribute' && !known.has(c.attributeKey ?? ''))
        .map((c) => c?.attributeKey as string),
    ),
  ];
  const hasStock = choices.some((c) => c?.field === 'stock');

  // Every column the file could map to, for the choosers.
  const targets: ColumnRef[] = [
    ...IMPORT_FIELDS.filter((f) => f !== 'attribute').flatMap((field): ColumnRef[] =>
      isLocalizedField(field)
        ? [
            { field, locale: 'bn' },
            { field, locale: 'en' },
          ]
        : [{ field }],
    ),
    ...(attributes.data ?? []).flatMap((a): ColumnRef[] =>
      a.key === 'brand'
        ? []
        : a.type === 'text'
          ? [
              { field: 'attribute', attributeKey: a.key, locale: 'bn' },
              { field: 'attribute', attributeKey: a.key, locale: 'en' },
            ]
          : [{ field: 'attribute', attributeKey: a.key }],
    ),
  ];

  const mappedRows = (): MappedRow[] =>
    parsed.rows.map((row) => {
      const out: Record<string, string> = {};
      choices.forEach((choice, i) => {
        if (choice) out[columnId(choice)] = String(row[i] ?? '');
      });
      return out;
    });

  const createAttribute = useMutation({
    mutationFn: async ({ key, type }: { key: string; type: string }) =>
      unwrap(
        await api.POST('/v1/admin/attributes', {
          body: {
            key,
            type: type as never,
            translations: { [defaultLang]: { name: key } } as never,
          },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: attributesQuery.queryKey }),
  });

  const start = useMutation({
    mutationFn: async () => {
      if (!dry) throw new Error('no dry run');
      const chunks = chunkProducts(dry.products, CHUNK);
      setProgress(t('import.staging', { done: 0, total: chunks.length }));
      const job = unwrap(
        await api.POST('/v1/admin/imports', {
          headers: { 'idempotency-key': crypto.randomUUID() },
          body: {
            fileName: parsed.fileName,
            chunkCount: chunks.length,
            total: dry.products.length,
            stock: hasStock && canStock,
          },
        }),
      );
      for (const [n, chunk] of chunks.entries()) {
        // Without inventory.write, stock columns are left out rather than refused.
        const body =
          hasStock && !canStock
            ? chunk.map((p) => ({ ...p, variants: p.variants.map((v) => ({ ...v, stock: null })) }))
            : chunk;
        unwrap(
          await api.PUT('/v1/admin/imports/{id}/chunks/{n}', {
            params: { path: { id: job.id, n } },
            body: body as never,
          }),
        );
        setProgress(t('import.staging', { done: n + 1, total: chunks.length }));
      }
      unwrap(await api.POST('/v1/admin/imports/{id}/start', { params: { path: { id: job.id } } }));
      return job.id;
    },
    onSuccess: (id) => onStarted(id),
    onSettled: () => setProgress(null),
  });

  if (store.isPending || attributes.isPending) return <p role="status">{t('loading')}</p>;
  const missingTitle = !choices.some((c) => c?.field === 'title' && c.locale === defaultLang);
  const missingPrice = !choices.some((c) => c?.field === 'price');

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="mapping-heading" className="flex flex-col gap-3">
        <h2 id="mapping-heading" className="text-lg font-semibold">
          {t('import.mapping', { file: parsed.fileName, rows: parsed.rows.length })}
        </h2>
        <p className="text-sm text-muted-foreground">{t('import.mappingIntro')}</p>
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {parsed.header.map((header, i) => (
            <li
              key={`${header}-${i}`}
              className="grid gap-2 p-3 md:grid-cols-[1fr_1fr] md:items-center"
            >
              <span className="text-sm">
                <span className="font-medium">{header || t('import.unnamed', { n: i + 1 })}</span>
                <span className="block truncate text-muted-foreground">
                  {parsed.rows[0]?.[i] ?? ''}
                </span>
              </span>
              <select
                aria-label={t('import.mapTo', { column: header || String(i + 1) })}
                className="min-h-11 rounded-md border border-border bg-background px-3 text-base md:text-sm"
                value={refValue(choices[i] ?? null)}
                onChange={(e) => {
                  setChoices(choices.map((c, j) => (j === i ? refFrom(e.target.value) : c)));
                  setDry(null);
                }}
              >
                <option value="">{t('import.ignore')}</option>
                {/* A recognized attribute column the store doesn't have yet keeps its choice. */}
                {choices[i]?.field === 'attribute' &&
                  !known.has(choices[i]?.attributeKey ?? '') && (
                    <option value={refValue(choices[i] ?? null)}>
                      {exportHeader(choices[i] as ColumnRef, locale)}
                    </option>
                  )}
                {targets.map((ref) => (
                  <option key={columnId(ref)} value={columnId(ref)}>
                    {exportHeader(ref, locale)}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
        {unknownAttributes.map((key) => (
          <Notice key={key}>
            <span className="flex flex-wrap items-center gap-2">
              {t('import.unknownAttribute', { key })}
              {(['choice', 'multi_choice', 'number', 'text', 'boolean'] as const).map((type) => (
                <Button
                  key={type}
                  variant="secondary"
                  disabled={createAttribute.isPending}
                  onClick={() => createAttribute.mutate({ key, type })}
                >
                  {t('import.createAs', { type: t(`attributes.type.${type}`) })}
                </Button>
              ))}
            </span>
          </Notice>
        ))}
        {createAttribute.isError && (
          <Notice tone="error">{saveErrorMessage(createAttribute.error, t)}</Notice>
        )}
        {hasStock && !canStock && <Notice>{t('import.noStockPermission')}</Notice>}
        {(missingTitle || missingPrice) && <Notice tone="error">{t('import.needColumns')}</Notice>}
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={onCancel}>
            {t('action.cancel')}
          </Button>
          <Button
            disabled={missingTitle || missingPrice || unknownAttributes.length > 0}
            onClick={() =>
              setDry(dryRunImport(mappedRows(), { defaultLocale: defaultLang, firstRow: 2 }))
            }
          >
            {t('import.check')}
          </Button>
        </div>
      </section>

      {dry && (
        <section aria-labelledby="dry-heading" aria-live="polite" className="flex flex-col gap-3">
          <h2 id="dry-heading" className="text-lg font-semibold">
            {t('import.dryRun')}
          </h2>
          <p>
            {t('import.ready', {
              products: dry.products.length,
              variants: dry.products.reduce((n, p) => n + p.variants.length, 0),
            })}
          </p>
          {dry.errors.length > 0 && (
            <>
              <Notice tone="error">
                {t('import.rowErrors', { count: dry.errors.length, rows: dry.skippedRows })}
              </Notice>
              <ErrorTable errors={dry.errors.slice(0, 100)} />
              <div>
                <Button
                  variant="secondary"
                  onClick={() => downloadErrors(parsed.fileName, dry.errors, t)}
                >
                  {t('import.downloadErrors')}
                </Button>
              </div>
            </>
          )}
          {start.isError && <Notice tone="error">{saveErrorMessage(start.error, t)}</Notice>}
          {progress && <p role="status">{progress}</p>}
          <div>
            <Button
              disabled={!dry.products.length || start.isPending}
              onClick={() => start.mutate()}
            >
              {dry.errors.length
                ? t('import.startValid', { count: dry.products.length })
                : t('import.start', { count: dry.products.length })}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

type RowError = { row: number; column?: string; field?: string; code: string; message: string };

function ErrorTable({ errors }: { errors: RowError[] }) {
  const { t } = useLocale();
  return (
    <div className="max-h-96 overflow-auto rounded-md border border-border">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{t('import.errors')}</caption>
        <thead className="sticky top-0 bg-background text-muted-foreground">
          <tr>
            <th scope="col" className="p-2">
              {t('import.row')}
            </th>
            <th scope="col" className="p-2">
              {t('import.column')}
            </th>
            <th scope="col" className="p-2">
              {t('import.problem')}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {errors.map((e, i) => (
            <tr key={i}>
              <td className="p-2">{e.row}</td>
              <td className="p-2">{e.column ?? e.field}</td>
              <td className="p-2">{e.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function downloadErrors(
  fileName: string,
  errors: RowError[],
  t: ReturnType<typeof useLocale>['t'],
) {
  const csv = toCsv(
    [t('import.row'), t('import.column'), t('import.code'), t('import.problem')],
    errors.map((e) => [String(e.row), e.column ?? e.field ?? '', e.code, e.message]),
  );
  download(
    `${fileName.replace(/\.[^.]+$/, '')}-errors.csv`,
    new Blob([csv], { type: 'text/csv;charset=utf-8' }),
  );
}

// ---- Progress and the image step ----------------------------------------------------

function JobProgress({ jobId, onNew }: { jobId: string; onNew: () => void }) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const job = useQuery({
    queryKey: ['import', jobId],
    queryFn: async () =>
      unwrap(await api.GET('/v1/admin/imports/{id}', { params: { path: { id: jobId } } })),
    refetchInterval: (q) =>
      q.state.data && ['running', 'staging'].includes(q.state.data.status) ? 2000 : false,
  });
  const cancel = useMutation({
    mutationFn: async () =>
      unwrap(await api.POST('/v1/admin/imports/{id}/cancel', { params: { path: { id: jobId } } })),
    onSuccess: (data) => queryClient.setQueryData(['import', jobId], data),
  });
  const errors = useQuery({
    queryKey: ['import-errors', jobId, job.data?.errorCount],
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/admin/imports/{id}/errors', {
          params: { path: { id: jobId }, query: { limit: 1000 } },
        }),
      ),
    enabled: Boolean(
      job.data && job.data.errorCount > 0 && !['running', 'staging'].includes(job.data.status),
    ),
  });
  useEffect(() => {
    if (job.data?.status === 'done') {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      queryClient.invalidateQueries({ queryKey: ['attributes'] });
    }
  }, [job.data?.status, queryClient]);

  if (job.isPending) return <p role="status">{t('loading')}</p>;
  if (job.isError) {
    return (
      <Notice tone="error">
        {job.error instanceof ApiError && job.error.status === 404
          ? t('import.notFound')
          : errorMessage(job.error, t)}
      </Notice>
    );
  }
  const j = job.data;
  const percent = j.total ? Math.round((j.processed / j.total) * 100) : 0;
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">
        {j.fileName} · {t(`import.status.${j.status}`)}
      </h2>
      <div className="flex flex-col gap-1">
        <progress
          className="h-3 w-full"
          max={100}
          value={j.status === 'images' || j.status === 'done' ? 100 : percent}
          aria-label={t('import.progress')}
        />
        <p role="status">{t('import.processed', { processed: j.processed, total: j.total })}</p>
      </div>
      <p>{t('import.counts', { created: j.created, updated: j.updated, failed: j.failed })}</p>
      {j.status === 'failed' && (
        <Notice tone="error">{t('import.failed', { error: j.lastError ?? '' })}</Notice>
      )}
      {j.status === 'images' && <ImageStep job={j} />}
      {j.status === 'done' && j.images.done + j.images.failed > 0 && (
        <p>{t('import.imagesDone', { done: j.images.done, failed: j.images.failed })}</p>
      )}
      {errors.data && errors.data.total > 0 && (
        <>
          <Notice tone="error">{t('import.jobErrors', { count: errors.data.total })}</Notice>
          <ErrorTable errors={errors.data.items.slice(0, 100)} />
          <div>
            <Button
              variant="secondary"
              onClick={() => downloadErrors(j.fileName, errors.data.items, t)}
            >
              {t('import.downloadErrors')}
            </Button>
          </div>
        </>
      )}
      <div className="flex flex-wrap gap-2">
        {['staging', 'running', 'images'].includes(j.status) && (
          <Button variant="ghost" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
            {t('import.cancel')}
          </Button>
        )}
        {['done', 'failed', 'cancelled'].includes(j.status) && (
          <>
            <Button asChild variant="secondary">
              <Link to="/products">{t('import.seeProducts')}</Link>
            </Button>
            <Button onClick={onNew}>{t('import.another')}</Button>
          </>
        )}
      </div>
    </div>
  );
}

/** Fetches, resizes and uploads each pending image, a few at a time, and reports it to the job. */
function ImageStep({ job }: { job: ImportJob }) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const stop = useRef(false);
  const total = job.images.pending + job.images.done + job.images.failed;

  async function processOne(image: { id: string; url: string }) {
    let body: { status: 'done'; mediaId: string } | { status: 'failed'; error: string };
    try {
      const res = await fetch('/api/admin/media/fetch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: image.url }),
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const problem = (await res.json().catch(() => null)) as {
          errors?: { message: string }[];
          title?: string;
        } | null;
        throw new Error(problem?.errors?.[0]?.message ?? problem?.title ?? `HTTP ${res.status}`);
      }
      const media = await uploadImage(await prepareImage(await res.blob()));
      body = { status: 'done', mediaId: media.id };
    } catch (e) {
      body = {
        status: 'failed',
        error: (e instanceof Error ? e.message : String(e)).slice(0, 400) || 'failed',
      };
    }
    unwrap(
      await api.PATCH('/v1/admin/imports/{id}/images/{imageId}', {
        params: { path: { id: job.id, imageId: image.id } },
        body,
      }),
    );
    setDone((n) => n + 1);
  }

  async function run() {
    setRunning(true);
    stop.current = false;
    try {
      for (;;) {
        const pending = unwrap(
          await api.GET('/v1/admin/imports/{id}/images', {
            params: { path: { id: job.id }, query: { status: 'pending', limit: 30 } },
          }),
        );
        if (!pending.length || stop.current) break;
        for (let i = 0; i < pending.length && !stop.current; i += IMAGE_CONCURRENCY) {
          await Promise.all(pending.slice(i, i + IMAGE_CONCURRENCY).map(processOne));
        }
      }
    } finally {
      setRunning(false);
      await queryClient.invalidateQueries({ queryKey: ['import', job.id] });
    }
  }

  // Starts on its own, and again after a reload, until nothing is pending.
  useEffect(() => {
    run();
    return () => {
      stop.current = true;
    };
  }, [job.id]);

  return (
    <section aria-labelledby="images-step" className="flex flex-col gap-2">
      <h3 id="images-step" className="font-semibold">
        {t('import.imageStep')}
      </h3>
      <p role="status">
        {t('import.imageProgress', { done: job.images.done + job.images.failed + done, total })}
      </p>
      <p className="text-sm text-muted-foreground">{t('import.imageHint')}</p>
      {!running && job.images.pending > 0 && (
        <div>
          <Button onClick={run}>{t('import.resumeImages')}</Button>
        </div>
      )}
    </section>
  );
}
