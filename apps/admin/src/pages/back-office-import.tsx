// The back office's imports (phase-8-plan §3.10): suppliers with what the
// store owed them, and past months' expenses. The browser reads the file,
// checks every row and shows what will be made and what's wrong; on confirm
// it sends the good rows 200 at a time, each under its own Idempotency-Key,
// and says how many were made and how many the store already had.
import {
  BACK_OFFICE_IMPORT_LIMITS,
  type ImportCategory,
  mapExpenseHeaders,
  mapSupplierHeaders,
  parseExpenseRow,
  parseSupplierRow,
  type RowIssue,
} from '@managemind/shared/back-office';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { DropZone, ImportFrame, type Sample } from '../components/import-frame';
import { Notice } from '../components/notice';
import { usePermission } from '../components/permission-gate';
import { dhakaDay } from '../components/report-range';
import { Button } from '../components/ui/button';
import { useLocale } from '../i18n';
import '../i18n/back-office-reports';
import '../i18n/expenses';
import '../i18n/purchasing';
import { api, unwrap } from '../lib/api';
import { saveErrorMessage } from '../lib/errors';
import { expenseCategoriesQuery } from '../lib/expenses';
import { downloadErrors, ErrorTable, type Parsed, type RowError } from './import';

type Result = { created: number; skipped: { row: number; reason: 'exists' }[] };

interface Checked<T> {
  rows: T[];
  errors: RowError[];
  warnings: RowError[];
  /** Fields the file has a column for. */
  found: string[];
  /** The file lacks a column the rows need. */
  missing: boolean;
}

const issues = (row: number, list: RowIssue[]): RowError[] => list.map((e) => ({ row, ...e }));

export function SupplierImportPage() {
  const { t } = useLocale();
  const allowed = usePermission('purchasing.write');
  const queryClient = useQueryClient();
  const check = (parsed: Parsed): Checked<unknown> => {
    const columns = mapSupplierHeaders(parsed.header);
    const out: Checked<unknown> = {
      rows: [],
      errors: [],
      warnings: [],
      found: Object.keys(columns),
      missing: columns.name === undefined,
    };
    const seen = new Set<string>();
    parsed.rows.slice(0, BACK_OFFICE_IMPORT_LIMITS.rows).forEach((cells, i) => {
      // Row 1 is the header, as the spreadsheet shows it.
      const r = parseSupplierRow(cells, columns, i + 2);
      out.errors.push(...issues(i + 2, r.errors));
      out.warnings.push(...issues(i + 2, r.warnings));
      if (!r.supplier) return;
      const key = r.supplier.name.toLowerCase();
      if (seen.has(key)) {
        out.errors.push({
          row: i + 2,
          field: 'name',
          code: 'duplicate',
          message: 'the same name appears earlier in the file; left out',
        });
        return;
      }
      seen.add(key);
      out.rows.push(r.supplier);
    });
    return out;
  };
  return (
    <ImportPage
      title={t('boImport.supplierTitle')}
      intro={t('boImport.supplierIntro')}
      parent="/inventory/suppliers"
      sample={{
        name: 'suppliers-sample.csv',
        header: ['name', 'contact', 'phone', 'email', 'address', 'city', 'note', 'opening balance'],
        rows: [
          [
            'Tangail Weavers',
            'Karim Mia',
            '01812345678',
            '',
            'Tangail Sadar',
            'Tangail',
            '',
            '12500',
          ],
        ],
      }}
      columns={t('boImport.supplierColumns')}
      missingText={t('boImport.missingSupplier')}
      allowed={allowed}
      check={check}
      send={async (rows) =>
        unwrap(
          await api.POST('/v1/admin/suppliers/import', {
            headers: { 'idempotency-key': crypto.randomUUID() },
            body: rows as never,
          }),
        ) as Result
      }
      onDone={() => queryClient.invalidateQueries({ queryKey: ['suppliers'] })}
    />
  );
}

export function ExpenseImportPage() {
  const { t } = useLocale();
  const allowed = usePermission('expenses.write');
  const queryClient = useQueryClient();
  const categories = useQuery(expenseCategoriesQuery);
  const check = (parsed: Parsed): Checked<unknown> => {
    const columns = mapExpenseHeaders(parsed.header);
    const today = dhakaDay(new Date());
    const out: Checked<unknown> = {
      rows: [],
      errors: [],
      warnings: [],
      found: Object.keys(columns),
      missing: columns.date === undefined || columns.amount === undefined,
    };
    const list = (categories.data ?? []) as ImportCategory[];
    parsed.rows.slice(0, BACK_OFFICE_IMPORT_LIMITS.rows).forEach((cells, i) => {
      const r = parseExpenseRow(cells, columns, i + 2, list, today);
      out.errors.push(...issues(i + 2, r.errors));
      out.warnings.push(...issues(i + 2, r.warnings));
      if (r.expense) out.rows.push(r.expense);
    });
    return out;
  };
  if (categories.isPending) return <p role="status">{t('loading')}</p>;
  return (
    <ImportPage
      title={t('boImport.expenseTitle')}
      intro={t('boImport.expenseIntro')}
      parent="/expenses"
      sample={{
        name: 'expenses-sample.csv',
        header: ['date', 'category', 'amount', 'paid by', 'paid to', 'note'],
        rows: [['2026-09-15', 'Rent', '25000', 'bKash', 'Landlord', 'September rent']],
      }}
      columns={t('boImport.expenseColumns')}
      missingText={t('boImport.missingExpense')}
      allowed={allowed}
      check={check}
      send={async (rows) =>
        unwrap(
          await api.POST('/v1/admin/expenses/import', {
            headers: { 'idempotency-key': crypto.randomUUID() },
            body: rows as never,
          }),
        ) as Result
      }
      onDone={() => queryClient.invalidateQueries({ queryKey: ['expenses'] })}
    />
  );
}

function ImportPage({
  title,
  intro,
  parent,
  sample,
  columns,
  missingText,
  allowed,
  check,
  send,
  onDone,
}: {
  title: string;
  intro: string;
  parent: '/inventory/suppliers' | '/expenses';
  sample: Sample;
  columns: string;
  missingText: string;
  allowed: boolean;
  check: (parsed: Parsed) => Checked<unknown>;
  send: (rows: unknown[]) => Promise<Result>;
  onDone: () => void;
}) {
  const { t } = useLocale();
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [done, setDone] = useState<{ created: number; skipped: number } | null>(null);
  return (
    <ImportFrame
      title={title}
      intro={intro}
      parent={{ to: parent, label: t(parent === '/expenses' ? 'nav.expenses' : 'nav.suppliers') }}
      sample={sample}
      steps={[t('import.step.choose'), t('import.step.check'), t('import.step.import')]}
      step={done ? 2 : parsed ? 1 : 0}
    >
      {!allowed ? (
        <Notice>{t('boImport.notAllowed')}</Notice>
      ) : done ? (
        <>
          <Notice>{t('boImport.done', { created: done.created, skipped: done.skipped })}</Notice>
          <div>
            <Button
              variant="secondary"
              onClick={() => {
                setDone(null);
                setParsed(null);
              }}
            >
              {t('boImport.again')}
            </Button>
          </div>
        </>
      ) : parsed ? (
        <Review
          parsed={parsed}
          checked={check(parsed)}
          missingText={missingText}
          send={send}
          onCancel={() => setParsed(null)}
          onDone={(result) => {
            onDone();
            setDone(result);
          }}
        />
      ) : (
        <DropZone hint={columns} onParsed={setParsed} />
      )}
    </ImportFrame>
  );
}

function Review({
  parsed,
  checked,
  missingText,
  send,
  onCancel,
  onDone,
}: {
  parsed: Parsed;
  checked: Checked<unknown>;
  missingText: string;
  send: (rows: unknown[]) => Promise<Result>;
  onCancel: () => void;
  onDone: (result: { created: number; skipped: number }) => void;
}) {
  const { t } = useLocale();
  const [progress, setProgress] = useState<string | null>(null);
  const tooMany = parsed.rows.length > BACK_OFFICE_IMPORT_LIMITS.rows;
  const problems = useMemo(
    () => [...checked.errors, ...checked.warnings].sort((a, b) => a.row - b.row),
    [checked],
  );
  const start = useMutation({
    mutationFn: async () => {
      const size = BACK_OFFICE_IMPORT_LIMITS.chunk;
      const total = checked.rows.length;
      let created = 0;
      let skipped = 0;
      for (let i = 0; i < total; i += size) {
        setProgress(t('boImport.progress', { done: i, total }));
        const result = await send(checked.rows.slice(i, i + size));
        created += result.created;
        skipped += result.skipped.length;
      }
      return { created, skipped };
    },
    onSuccess: onDone,
    onSettled: () => setProgress(null),
  });
  return (
    <div className="flex flex-col gap-4">
      <p>{parsed.fileName}</p>
      <p className="text-sm text-muted-foreground">
        {t('boImport.found', { columns: checked.found.join(', ') || '—' })}
      </p>
      {checked.missing && <Notice tone="error">{missingText}</Notice>}
      {tooMany && (
        <Notice tone="error">
          {t('boImport.tooMany', { count: BACK_OFFICE_IMPORT_LIMITS.rows })}
        </Notice>
      )}
      {!checked.missing && (
        <>
          <p role="status">
            {t('boImport.summary', {
              valid: checked.rows.length,
              errors: checked.errors.length,
              warnings: checked.warnings.length,
            })}
          </p>
          {problems.length > 0 && (
            <>
              <ErrorTable errors={problems.slice(0, 200)} />
              <div>
                <Button
                  variant="secondary"
                  onClick={() => downloadErrors(parsed.fileName, problems, t)}
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
          disabled={checked.missing || tooMany || !checked.rows.length || start.isPending}
          onClick={() => start.mutate()}
        >
          {t('boImport.start', { count: String(checked.rows.length) })}
        </Button>
      </div>
    </div>
  );
}
