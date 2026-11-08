// shadcn/ui's Calendar (components/ui/shadcn) in the admin's language:
// months and weekdays in Bangla or English. Only the date pickers import it,
// so react-day-picker stays out of the sign-in chunk.
import type { ComponentProps } from 'react';
import { bn } from 'react-day-picker/locale/bn';
import { enGB } from 'react-day-picker/locale/en-GB';
import { useLocale } from '../../i18n';
import { Calendar as ShadCalendar } from './shadcn/calendar';

export function Calendar(props: ComponentProps<typeof ShadCalendar>) {
  const { locale } = useLocale();
  return <ShadCalendar locale={locale === 'bn' ? bn : enGB} {...props} />;
}
