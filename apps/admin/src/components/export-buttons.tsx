// Export ▾ for a report table or a list (phase-8-plan §3.8, the canvas's
// export menu): Excel or CSV. `rows` builds the cells when asked, so a list
// can read all its pages first. Counts and money stay numbers in Excel.
import * as Menu from '@radix-ui/react-dropdown-menu';
import { ChevronDown, Download, FileSpreadsheet, FileText } from 'lucide-react';
import { useState } from 'react';
import { useLocale } from '../i18n';
import '../i18n/back-office-reports';
import { errorMessage } from '../lib/errors';
import { type ReportCell, type ReportFormat, saveReport } from '../lib/report-export';
import { cn } from '../lib/utils';
import { useToast } from './toast';
import { Button } from './ui/button';
import { menuContent, menuItem } from './ui/menu';

export function ExportButtons({
  name,
  what,
  head,
  rows,
  variant = 'secondary',
  chevron,
}: {
  /** The file's name, before the date. */
  name: string;
  /** What is exported, for the button's accessible name. */
  what: string;
  head: string[];
  rows: () => ReportCell[][] | Promise<ReportCell[][]>;
  /** An outline button in a page's header; a ghost one in a card's. */
  variant?: 'secondary' | 'ghost';
  /** The ▾ after the word, where the board draws it. */
  chevron?: boolean;
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
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button
          variant={variant}
          disabled={saving !== null}
          aria-label={t('reports.exportWhat', { what })}
          className={cn(variant === 'ghost' && '-mr-2 h-7 px-2 md:h-7')}
        >
          <Download aria-hidden />
          {saving ? t('loading') : t('reports.export')}
          {chevron && <ChevronDown aria-hidden className="opacity-60" />}
        </Button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={4} className={cn(menuContent, 'min-w-[180px]')}>
          <Menu.Item className={menuItem} onSelect={() => void save('xlsx')}>
            <FileSpreadsheet aria-hidden />
            {t('reports.export.xlsxFile')}
          </Menu.Item>
          <Menu.Item className={menuItem} onSelect={() => void save('csv')}>
            <FileText aria-hidden />
            {t('reports.export.csv')}
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
