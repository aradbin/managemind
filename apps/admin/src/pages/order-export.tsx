// Order and customer export (phase-4-plan §3.17): the browser pages through
// the API and writes the file, as the catalog export does. Orders' lines come
// from the print endpoint, 100 orders a call.
import { Download } from 'lucide-react';
import { useState } from 'react';
import { Notice } from '../components/notice';
import { usePermission } from '../components/permission-gate';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
import { useLocale } from '../i18n';
import { api, unwrap } from '../lib/api';
import { errorMessage } from '../lib/errors';
import {
  csvRows,
  customerTable,
  EXPORT_FORMATS,
  type ExportFormat,
  type ExportTable,
  orderTable,
} from '../lib/order-export';
import {
  type CustomerFilters,
  type CustomerSummary,
  fetchCustomers,
  fetchOrders,
  type OrderDetail,
  type OrderFilters,
} from '../lib/orders';
import { download, toCsv } from './export';

const PRINT_BATCH = 100;

async function orderDetails(ids: string[]): Promise<OrderDetail[]> {
  const out: OrderDetail[] = [];
  for (let i = 0; i < ids.length; i += PRINT_BATCH) {
    const page = unwrap(
      await api.GET('/v1/admin/orders/print', {
        params: { query: { ids: ids.slice(i, i + PRINT_BATCH).join(',') } },
      }),
    );
    out.push(...page.orders);
  }
  return out;
}

async function orderIds(filters: OrderFilters, onProgress: (n: number) => void) {
  const ids: string[] = [];
  let after: string | undefined;
  do {
    const page = await fetchOrders(filters, after, 200);
    ids.push(...page.items.map((o) => o.id));
    onProgress(ids.length);
    after = page.nextCursor ?? undefined;
  } while (after);
  return ids;
}

async function save(name: string, table: ExportTable, format: 'csv' | 'xlsx') {
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === 'xlsx') {
    const { writeXlsx } = await import('../lib/xlsx');
    download(`${name}-${stamp}.xlsx`, await writeXlsx(table.header, table.rows));
  } else {
    download(
      `${name}-${stamp}.csv`,
      new Blob([toCsv(table.header, csvRows(table))], { type: 'text/csv;charset=utf-8' }),
    );
  }
}

export function OrderExportButton({
  filters,
  selected,
}: {
  filters: OrderFilters;
  selected: string[];
}) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const allowed = usePermission('orders.export');
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ExportFormat>('full');
  const [scope, setScope] = useState<'selected' | 'filtered'>('filtered');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string>();
  if (!allowed) return null;

  async function run(file: 'csv' | 'xlsx') {
    setError(undefined);
    setProgress(0);
    try {
      const ids =
        scope === 'selected' && selected.length ? selected : await orderIds(filters, setProgress);
      const orders = await orderDetails(ids);
      // Couriers only take orders still to send, with an address.
      const list =
        kind === 'full'
          ? orders
          : orders.filter((o) => o.address && o.status !== 'cancelled' && o.status !== 'completed');
      await save(
        kind === 'full' ? 'orders' : `orders-${kind}`,
        orderTable(kind, list, locale),
        file,
      );
      toast(t('export.ordersDone', { count: list.length }));
      setOpen(false);
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setProgress(null);
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Download aria-hidden className="size-4" />
        {t('export.button')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t('export.ordersTitle')}
        description={t('export.ordersDescription')}
      >
        {progress !== null ? (
          <p role="status">{t('export.reading', { count: progress })}</p>
        ) : (
          <div className="flex flex-col gap-4">
            <fieldset className="flex flex-col gap-1">
              <legend className="mb-1 text-sm font-medium">{t('export.format')}</legend>
              {EXPORT_FORMATS.map((f) => (
                <label key={f} className="flex min-h-11 items-center gap-3">
                  <input
                    type="radio"
                    name="export-format"
                    className="size-5"
                    checked={kind === f}
                    onChange={() => setKind(f)}
                  />
                  {t(`export.format.${f}`)}
                </label>
              ))}
            </fieldset>
            {selected.length > 0 && (
              <fieldset className="flex flex-col gap-1">
                <legend className="mb-1 text-sm font-medium">{t('export.which')}</legend>
                {(['selected', 'filtered'] as const).map((s) => (
                  <label key={s} className="flex min-h-11 items-center gap-3">
                    <input
                      type="radio"
                      name="export-scope"
                      className="size-5"
                      checked={scope === s}
                      onChange={() => setScope(s)}
                    />
                    {s === 'selected'
                      ? t('export.selected', { count: selected.length })
                      : t('export.filtered')}
                  </label>
                ))}
              </fieldset>
            )}
            <div className="flex flex-col gap-2 md:flex-row">
              {kind === 'full' && <Button onClick={() => run('xlsx')}>{t('export.xlsx')}</Button>}
              <Button
                variant={kind === 'full' ? 'secondary' : 'primary'}
                onClick={() => run('csv')}
              >
                {t('export.csv')}
              </Button>
            </div>
          </div>
        )}
        {error && <Notice tone="error">{error}</Notice>}
      </Dialog>
    </>
  );
}

export function CustomerExportButton({ filters }: { filters: CustomerFilters }) {
  const { t } = useLocale();
  const toast = useToast();
  const allowed = usePermission('customers.export');
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string>();
  if (!allowed) return null;

  async function run(file: 'csv' | 'xlsx') {
    setError(undefined);
    setProgress(0);
    try {
      const all: CustomerSummary[] = [];
      let after: string | undefined;
      do {
        const page = await fetchCustomers(filters, after, 200);
        all.push(...page.items);
        setProgress(all.length);
        after = page.nextCursor ?? undefined;
      } while (after);
      await save('customers', customerTable(all), file);
      toast(t('export.customersDone', { count: all.length }));
      setOpen(false);
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setProgress(null);
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Download aria-hidden className="size-4" />
        {t('export.button')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title={t('export.customersTitle')}>
        {progress !== null ? (
          <p role="status">{t('export.reading', { count: progress })}</p>
        ) : (
          <div className="flex flex-col gap-2 md:flex-row">
            <Button onClick={() => run('xlsx')}>{t('export.xlsx')}</Button>
            <Button variant="secondary" onClick={() => run('csv')}>
              {t('export.csv')}
            </Button>
          </div>
        )}
        {error && <Notice tone="error">{error}</Notice>}
      </Dialog>
    </>
  );
}
