// Excel and CSV buttons for a report table or a list (phase-8-plan §3.8):
// `rows` builds the cells when asked, so a list can read all its pages
// first. Counts and money stay numbers in Excel.
import { useState } from 'react';
import { useLocale } from '../i18n';
import '../i18n/back-office-reports';
import { errorMessage } from '../lib/errors';
import { type ReportCell, type ReportFormat, saveReport } from '../lib/report-export';
import { useToast } from './toast';
import { Button } from './ui/button';

export function ExportButtons({
  name,
  what,
  head,
  rows,
}: {
  /** The file's name, before the date. */
  name: string;
  /** What is exported, for the buttons' accessible names. */
  what: string;
  head: string[];
  rows: () => ReportCell[][] | Promise<ReportCell[][]>;
}) {
  const { t } = useLocale();
  const toast = useToast();
  const [saving, setSaving] = useState<ReportFormat | null>(null);
  async function save(format: ReportFormat) {
    setSaving(format);
    try {
      await saveReport(name, head, await rows(), format);
    } catch (e) {
      toast(errorMessage(e, t));
    } finally {
      setSaving(null);
    }
  }
  return (
    <div className="flex gap-2">
      {(['xlsx', 'csv'] as const).map((format) => (
        <Button
          key={format}
          type="button"
          variant="secondary"
          disabled={saving !== null}
          aria-label={t('reports.exportOf', { what, format: t(`reports.export.${format}`) })}
          onClick={() => save(format)}
        >
          {saving === format ? t('loading') : t(`reports.export.${format}`)}
        </Button>
      ))}
    </div>
  );
}
