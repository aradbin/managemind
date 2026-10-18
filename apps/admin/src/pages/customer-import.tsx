// Customer import (phase-4-plan §3.10): a CSV or Excel file, headers in
// English or Bangla (WooCommerce's customer export works as it is), checked
// row by row in the browser before anything is sent, then the same import
// job as products, 500 customers a chunk. Customers match by phone.
import {
  CUSTOMER_IMPORT_LIMITS,
  type ImportCustomer,
  mapCustomerHeaders,
  parseCustomerRow,
} from '@managemind/shared/orders/customer-import';
import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { ArrowLeft, FileUp } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { Button } from '../components/ui/button';
import { useLocale } from '../i18n';
import '../i18n/orders';
import { api, unwrap } from '../lib/api';
import { saveErrorMessage } from '../lib/errors';
import {
  downloadErrors,
  ErrorTable,
  JobProgress,
  type Parsed,
  parseFile,
  type RowError,
} from './import';

export function CustomerImportPage() {
  const { t } = useLocale();
  const search = useSearch({ strict: false }) as { job?: string };
  const navigate = useNavigate();
  const canWrite = usePermission('customers.write');
  const [parsed, setParsed] = useState<Parsed | null>(null);
  if (!canWrite) return <Notice>{t('customerImport.notAllowed')}</Notice>;
  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <div>
        <Link
          to="/customers"
          className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground"
        >
          <ArrowLeft aria-hidden className="size-4" />
          {t('nav.customers')}
        </Link>
      </div>
      <PageHeader title={t('customers.import')} description={t('customerImport.intro')} />
      {search.job ? (
        <JobProgress
          kind="customers"
          jobId={search.job}
          onNew={() => {
            setParsed(null);
            navigate({ to: '/customers/import', search: {} });
          }}
        />
      ) : parsed ? (
        <Review
          parsed={parsed}
          onCancel={() => setParsed(null)}
          onStarted={(job) => navigate({ to: '/customers/import', search: { job } })}
        />
      ) : (
        <Choose onParsed={setParsed} />
      )}
    </div>
  );
}

function Choose({ onParsed }: { onParsed: (p: Parsed) => void }) {
  const { t } = useLocale();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-col items-start gap-3 rounded-md border border-dashed border-border p-6">
      <p>{t('customerImport.choose')}</p>
      <p className="text-sm text-muted-foreground">{t('customerImport.columns')}</p>
      <input
        ref={input}
        type="file"
        accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="sr-only"
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
  );
}

function Review({
  parsed,
  onCancel,
  onStarted,
}: {
  parsed: Parsed;
  onCancel: () => void;
  onStarted: (jobId: string) => void;
}) {
  const { t } = useLocale();
  const [progress, setProgress] = useState<string | null>(null);
  const columns = useMemo(() => mapCustomerHeaders(parsed.header), [parsed.header]);
  const result = useMemo(() => {
    const customers: ImportCustomer[] = [];
    const errors: RowError[] = [];
    const warnings: RowError[] = [];
    const seen = new Set<string>();
    parsed.rows.slice(0, CUSTOMER_IMPORT_LIMITS.rows).forEach((cells, i) => {
      // Row 1 is the header, as the spreadsheet shows it.
      const r = parseCustomerRow(cells, columns, i + 2);
      errors.push(...r.errors.map((e) => ({ row: i + 2, ...e })));
      warnings.push(...r.warnings.map((e) => ({ row: i + 2, ...e })));
      if (!r.customer) return;
      if (seen.has(r.customer.phone)) {
        warnings.push({
          row: i + 2,
          field: 'phone',
          code: 'duplicate',
          message: 'the same phone appears earlier in the file; the later row wins',
        });
      }
      seen.add(r.customer.phone);
      customers.push(r.customer);
    });
    return { customers, errors, warnings };
  }, [parsed.rows, columns]);
  const missing =
    columns.phone === undefined || (columns.name === undefined && columns.firstName === undefined);
  const tooMany = parsed.rows.length > CUSTOMER_IMPORT_LIMITS.rows;

  const start = useMutation({
    mutationFn: async () => {
      const size = CUSTOMER_IMPORT_LIMITS.chunk;
      const chunks: ImportCustomer[][] = [];
      for (let i = 0; i < result.customers.length; i += size)
        chunks.push(result.customers.slice(i, i + size));
      setProgress(t('import.staging', { done: 0, total: chunks.length }));
      const job = unwrap(
        await api.POST('/v1/admin/imports', {
          headers: { 'idempotency-key': crypto.randomUUID() },
          body: {
            kind: 'customers',
            fileName: parsed.fileName,
            chunkCount: chunks.length,
            total: result.customers.length,
          },
        }),
      );
      for (const [n, chunk] of chunks.entries()) {
        unwrap(
          await api.PUT('/v1/admin/imports/{id}/chunks/{n}', {
            params: { path: { id: job.id, n } },
            body: chunk,
          }),
        );
        setProgress(t('import.staging', { done: n + 1, total: chunks.length }));
      }
      unwrap(await api.POST('/v1/admin/imports/{id}/start', { params: { path: { id: job.id } } }));
      return job.id;
    },
    onSuccess: onStarted,
    onSettled: () => setProgress(null),
  });

  const found = Object.keys(columns);
  return (
    <div className="flex flex-col gap-4">
      <p>
        {parsed.fileName} · {t('customerImport.rows', { count: parsed.rows.length })}
      </p>
      <p className="text-sm text-muted-foreground">
        {t('customerImport.found', { columns: found.join(', ') || '—' })}
      </p>
      {missing && <Notice tone="error">{t('customerImport.missing')}</Notice>}
      {tooMany && (
        <Notice tone="error">
          {t('customerImport.tooMany', { count: CUSTOMER_IMPORT_LIMITS.rows })}
        </Notice>
      )}
      {!missing && (
        <>
          <p role="status">
            {t('customerImport.summary', {
              valid: result.customers.length,
              errors: result.errors.length,
              warnings: result.warnings.length,
            })}
          </p>
          {result.errors.length + result.warnings.length > 0 && (
            <>
              <ErrorTable errors={[...result.errors, ...result.warnings].slice(0, 200)} />
              <div>
                <Button
                  variant="secondary"
                  onClick={() =>
                    downloadErrors(parsed.fileName, [...result.errors, ...result.warnings], t)
                  }
                >
                  {t('import.downloadErrors')}
                </Button>
              </div>
            </>
          )}
        </>
      )}
      {progress && <p role="status">{progress}</p>}
      {start.error && <Notice tone="error">{saveErrorMessage(start.error, t)}</Notice>}
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" onClick={onCancel}>
          {t('action.cancel')}
        </Button>
        <Button
          disabled={missing || !result.customers.length || start.isPending}
          onClick={() => start.mutate()}
        >
          {t('customerImport.start', { count: result.customers.length })}
        </Button>
      </div>
    </div>
  );
}
