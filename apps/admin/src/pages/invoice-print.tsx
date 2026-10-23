// One of our invoices, alone in its own tab so only the invoice prints
// (phase-5b-plan §3.7), in the language the reader picks.
import type { Locale } from '@managemind/shared/i18n';
import { useQuery } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { Printer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { InvoiceDocument } from '../components/invoice-document';
import { Notice } from '../components/notice';
import { Button } from '../components/ui/button';
import { translate, useLocale } from '../i18n';
import '../i18n/billing';
import '../i18n/orders';
import { storeInvoiceQuery } from '../lib/billing';
import { errorMessage } from '../lib/errors';

export function InvoicePrintPage() {
  const { t, locale } = useLocale();
  const { id } = useSearch({ strict: false }) as { id?: string };
  const [lang, setLang] = useState<Locale>(locale);
  const invoice = useQuery({ ...storeInvoiceQuery(id ?? ''), enabled: !!id });
  const number = invoice.data?.number ?? '';
  useEffect(() => {
    document.title = translate(lang, 'invoice.title', { number });
  }, [lang, number]);
  if (!id) return <Notice tone="error">{t('billing.noInvoices')}</Notice>;
  return (
    <div className="bg-background">
      <style>{`
        @page { size: A4; margin: 12mm; }
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; color: #000 !important; }
        }
      `}</style>
      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-background p-3">
        <label className="ml-auto flex items-center gap-2 text-sm">
          {t('print.language')}
          <select
            className="min-h-11 rounded-md border border-border bg-background px-3"
            value={lang}
            onChange={(e) => setLang(e.target.value as Locale)}
          >
            <option value="bn">বাংলা</option>
            <option value="en">English</option>
          </select>
        </label>
        <Button disabled={!invoice.data} onClick={() => window.print()}>
          <Printer aria-hidden className="size-4" />
          {t('print.print')}
        </Button>
      </div>
      {invoice.isPending && (
        <p role="status" className="p-4">
          {t('loading')}
        </p>
      )}
      {invoice.isError && (
        <div className="p-4">
          <Notice tone="error">{errorMessage(invoice.error, t)}</Notice>
        </div>
      )}
      {invoice.data && (
        <main className="flex justify-center bg-muted p-4 print:block print:bg-white print:p-0">
          <div className="w-full max-w-[210mm] bg-background p-8 shadow print:p-0 print:shadow-none">
            <InvoiceDocument invoice={invoice.data} lang={lang} />
          </div>
        </main>
      )}
    </div>
  );
}
