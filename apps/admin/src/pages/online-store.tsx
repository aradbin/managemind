// Online store (phase-3-plan §7), as the canvas draws it (ADR 0034): the
// store's address with Copy link and whether search engines list it, then
// the theme, pages and store settings as three cards, each with a line on
// where it stands (unpublished changes, how many pages are published,
// whether search engines show the store).
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  CircleAlert,
  CircleCheck,
  Copy,
  ExternalLink,
  FileText,
  Globe,
  Palette,
  SlidersHorizontal,
} from 'lucide-react';
import { PageHeader } from '../components/page-header';
import { usePermission } from '../components/permission-gate';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { cardPadded, cardTitle } from '../components/ui/card';
import { useLocale } from '../i18n';
import '../i18n/online-store';
import { storeSettingsQuery } from '../lib/catalog';
import { pagesQuery, themeQuery } from '../lib/online-store';
import { cn } from '../lib/utils';

export function OnlineStorePage() {
  const { t } = useLocale();
  const toast = useToast();
  const canRead = usePermission('settings.read');
  const store = useQuery(storeSettingsQuery);
  const theme = useQuery({ ...themeQuery, enabled: canRead });
  const pages = useQuery({ ...pagesQuery, enabled: canRead });
  const host = store.data ? new URL(store.data.storeUrl).host : '';
  const indexing = store.data?.storefront.indexing ?? false;
  const published = pages.data?.filter((p) => p.published).length ?? 0;
  const items = [
    {
      to: '/online-store/theme' as const,
      icon: Palette,
      title: t('theme.title'),
      description: t('theme.description'),
      status: theme.data?.unpublishedChanges ? t('onlineStore.unpublished') : undefined,
      warn: true,
    },
    {
      to: '/online-store/pages' as const,
      icon: FileText,
      title: t('pages.title'),
      description: t('pages.description'),
      status: pages.data
        ? t('onlineStore.pagesCount', { count: pages.data.length, published })
        : undefined,
      warn: false,
    },
    {
      to: '/online-store/settings' as const,
      icon: SlidersHorizontal,
      title: t('storefront.title'),
      description: t('storefront.description'),
      status: store.data
        ? t(indexing ? 'onlineStore.indexed' : 'onlineStore.notIndexed')
        : undefined,
      warn: !indexing,
    },
  ];
  return (
    <div className="flex w-full max-w-[860px] flex-col gap-3 md:gap-4">
      <PageHeader
        className="mb-0"
        title={t('onlineStore.title')}
        description={<span className="max-md:hidden">{t('onlineStore.description')}</span>}
        actions={
          store.data && (
            <Button asChild variant="secondary">
              <a href={store.data.storeUrl} target="_blank" rel="noopener">
                <ExternalLink aria-hidden />
                {t('store.view')}
              </a>
            </Button>
          )
        }
      />
      {store.data && (
        <section aria-labelledby="your-store" className={cn(cardPadded, 'gap-3 md:gap-3')}>
          <h2 id="your-store" className={cardTitle}>
            {t('onlineStore.yourStore')}
          </h2>
          <p className="flex flex-wrap items-center gap-2.5">
            <Globe aria-hidden className="size-4 text-muted-foreground" />
            <span dir="ltr" className="min-w-[180px] flex-1 font-mono">
              {host}
            </span>
            <Button
              variant="ghost"
              className="h-8 md:h-8"
              onClick={() =>
                navigator.clipboard
                  ?.writeText(store.data.storeUrl)
                  .then(() => toast(t('onlineStore.copied')))
              }
            >
              <Copy aria-hidden />
              {t('onlineStore.copyLink')}
            </Button>
          </p>
          {indexing ? (
            <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <CircleCheck aria-hidden className="size-4 text-success" />
              {t('onlineStore.live')}
            </p>
          ) : (
            <div className="flex items-start gap-2.5 rounded-[10px] border border-[color-mix(in_oklch,var(--tone-warn)_35%,transparent)] bg-[color-mix(in_oklch,var(--tone-warn)_7%,transparent)] px-3.5 py-3 text-[13px]">
              <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-[var(--tone-warn)]" />
              <p>{t('onlineStore.notLive')}</p>
            </div>
          )}
        </section>
      )}
      <ul className="grid overflow-hidden max-md:rounded-xl max-md:border max-md:border-border max-md:bg-card md:grid-cols-3 md:gap-3 md:overflow-visible">
        {items.map(({ to, icon: Icon, title, description, status, warn }) => (
          <li key={to} className="max-md:border-t max-md:border-border max-md:first:border-t-0">
            <Link
              to={to}
              className="flex h-full flex-col gap-2.5 bg-card px-4 py-3.5 md:rounded-[12px] md:border md:border-border md:p-4 hover:bg-[color-mix(in_oklch,var(--color-muted)_40%,var(--color-card))]"
            >
              <span
                aria-hidden
                className="inline-flex size-8 items-center justify-center rounded-lg bg-muted"
              >
                <Icon className="size-4" />
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="font-semibold">{title}</span>
                <span className="text-[13px] leading-[18px] text-muted-foreground">
                  {description}
                </span>
              </span>
              {status && (
                <span
                  className={cn(
                    'text-xs font-medium',
                    warn ? 'text-warning-foreground' : 'text-muted-foreground',
                  )}
                >
                  {status}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
