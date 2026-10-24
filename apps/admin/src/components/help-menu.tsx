// The help menu in the header (phase-5b-plan §7): the Bangla help guide,
// support by email and WhatsApp, and the platform's terms, privacy notice
// and data processing agreement, as far as the platform has set them.
import * as Menu from '@radix-ui/react-dropdown-menu';
import { useQuery } from '@tanstack/react-query';
import { CircleHelp } from 'lucide-react';
import { useState } from 'react';
import { type AdminKey, useLocale } from '../i18n';
import { api, unwrap } from '../lib/api';
import { Button } from './ui/button';

/** The help links the platform has set, loaded once `enabled` turns true. */
export function useHelpLinks(enabled: boolean) {
  const help = useQuery({
    queryKey: ['help'],
    enabled,
    staleTime: 60 * 60_000,
    queryFn: async () => unwrap(await api.GET('/v1/admin/help')),
  });
  const h = help.data;
  const entries: [AdminKey, string | null][] = h
    ? [
        ['help.guide', h.helpUrl],
        ['help.email', h.email && `mailto:${h.email}`],
        ['help.whatsapp', h.whatsapp && `https://wa.me/${h.whatsapp}`],
        ['help.terms', h.termsUrl],
        ['help.privacy', h.privacyUrl],
        ['help.dpa', h.dpaUrl],
      ]
    : [];
  const links = entries.flatMap(([label, href]) => (href ? [{ label, href }] : []));
  return { help, links };
}

export function HelpMenu() {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  // Loaded the first time the menu opens.
  const { help, links } = useHelpLinks(open);
  const item =
    'flex min-h-11 cursor-pointer items-center rounded px-3 outline-none data-[highlighted]:bg-muted';
  return (
    <Menu.Root open={open} onOpenChange={setOpen}>
      <Menu.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('help.menu')}>
          <CircleHelp aria-hidden className="size-6" />
        </Button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-56 rounded-lg border border-border bg-background p-1 shadow-lg"
        >
          {help.isPending && <p className="px-3 py-2 text-muted-foreground">{t('loading')}</p>}
          {help.isSuccess && links.length === 0 && (
            <p className="px-3 py-2 text-muted-foreground">{t('help.none')}</p>
          )}
          {links.map((l) => (
            <Menu.Item key={l.label} asChild className={item}>
              <a href={l.href} target="_blank" rel="noopener noreferrer">
                {t(l.label)}
              </a>
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
