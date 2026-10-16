// Online store (phase-3-plan §7): the theme, pages and store settings, and
// a link to the store itself.
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronRight, ExternalLink, FileText, Palette, SlidersHorizontal } from 'lucide-react';
import { PageHeader } from '../components/page-header';
import { Button } from '../components/ui/button';
import { useLocale } from '../i18n';
import '../i18n/online-store';
import { storeSettingsQuery } from '../lib/catalog';

export function OnlineStorePage() {
  const { t } = useLocale();
  const store = useQuery(storeSettingsQuery);
  const items = [
    {
      to: '/online-store/theme' as const,
      icon: Palette,
      title: t('theme.title'),
      description: t('theme.description'),
    },
    {
      to: '/online-store/pages' as const,
      icon: FileText,
      title: t('pages.title'),
      description: t('pages.description'),
    },
    {
      to: '/online-store/settings' as const,
      icon: SlidersHorizontal,
      title: t('storefront.title'),
      description: t('storefront.description'),
    },
  ];
  return (
    <>
      <PageHeader
        title={t('onlineStore.title')}
        description={t('onlineStore.description')}
        actions={
          store.data && (
            <Button asChild variant="secondary">
              <a href={store.data.storeUrl} target="_blank" rel="noopener">
                <ExternalLink aria-hidden className="size-4" />
                {t('store.view')}
              </a>
            </Button>
          )
        }
      />
      <ul className="flex max-w-2xl flex-col divide-y divide-border rounded-md border border-border">
        {items.map(({ to, icon: Icon, title, description }) => (
          <li key={to}>
            <Link to={to} className="flex min-h-16 items-center gap-3 p-4 hover:bg-muted">
              <Icon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
              <span className="flex flex-1 flex-col">
                <span className="font-medium">{title}</span>
                <span className="text-sm text-muted-foreground">{description}</span>
              </span>
              <ChevronRight aria-hidden className="size-5 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
