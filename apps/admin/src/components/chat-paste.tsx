// "Paste a chat" on the new order screen (phase-9-plan §3.1.2): the API reads
// the phone, the store's product links and order numbers from the text, and
// the screen fills in what it found. Names and addresses stay for staff to
// copy: the box never guesses them.
import { formatPhone } from '@managemind/shared/phone';
import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { X } from 'lucide-react';
import { useState } from 'react';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/orders';
import { api, unwrap } from '../lib/api';
import { orderErrorMessage, pickText } from '../lib/orders';
import { cn } from '../lib/utils';
import { Notice } from './notice';
import { Button } from './ui/button';
import { cardPadded, cardTitle } from './ui/card';
import { Textarea } from './ui/input';

const readChat = async (text: string) =>
  unwrap(await api.POST('/v1/admin/orders/parse-chat', { body: { text } }));
export type ParsedChat = Awaited<ReturnType<typeof readChat>>;

export function ChatPaste({
  initialText,
  onRead,
  onClose,
}: {
  initialText: string;
  /** Called with what the chat says; returns how many lines were added. */
  onRead: (parsed: ParsedChat) => number;
  /** Closes the box; the page opens it from its own "Paste a chat" action. */
  onClose: () => void;
}) {
  const { t, locale } = useLocale();
  const [text, setText] = useState(initialText);
  const read = useMutation({
    mutationFn: () => readChat(text),
  });
  const [added, setAdded] = useState<number | null>(null);
  const result = read.data;
  const nothing = result && !result.phone && result.lines.length === 0 && !result.orders.length;
  const needsVariant = result?.lines.filter((l) => !l.variantId) ?? [];

  return (
    <section aria-labelledby="chat-paste-h" className={cn(cardPadded, 'gap-3 md:gap-3')}>
      <div className="flex min-h-5 items-center justify-between gap-3">
        <h2 id="chat-paste-h" className={cardTitle}>
          {t('chat.paste')}
        </h2>
        <Button
          variant="ghost"
          size="icon"
          className="-my-1 -mr-2 size-7 md:size-7"
          aria-label={t('action.close')}
          onClick={onClose}
        >
          <X aria-hidden className="size-4" />
        </Button>
      </div>
      <p className="-mt-1 text-[13px] text-muted-foreground" id="chat-paste-hint">
        {t('chat.pasteHint')}
      </p>
      <Textarea
        aria-labelledby="chat-paste-h"
        aria-describedby="chat-paste-hint"
        rows={5}
        maxLength={5000}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <Button
        variant="secondary"
        className="self-end"
        disabled={!text.trim() || read.isPending}
        onClick={() => read.mutate(undefined, { onSuccess: (parsed) => setAdded(onRead(parsed)) })}
      >
        {t('chat.read')}
      </Button>
      {read.isError && <Notice tone="error">{orderErrorMessage(read.error, t)}</Notice>}
      {nothing && <Notice>{t('chat.nothing')}</Notice>}
      {result && !nothing && (
        <div role="status" className="flex flex-col gap-2 text-sm">
          {added !== null && added > 0 && <p>{t('chat.added', { count: added })}</p>}
          {needsVariant.map((l) => (
            <p key={l.productId}>{t('chat.pickVariant', { product: pickText(l.title, locale) })}</p>
          ))}
          {result.unknownProducts.length > 0 && (
            <p>{t('chat.unknown', { slugs: result.unknownProducts.join(', ') })}</p>
          )}
          {result.phones.length > 1 && (
            <p>
              {t('chat.otherPhones', {
                phones: result.phones
                  .slice(1)
                  .map((p) => formatPhone(p))
                  .join(', '),
              })}
            </p>
          )}
          {result.orders.length > 0 && (
            <p>
              {t('chat.mentions')}:{' '}
              {result.orders.map((o, i) => (
                <span key={o.id}>
                  {i > 0 && ', '}
                  <Link
                    to="/orders/$id"
                    params={{ id: o.id }}
                    target="_blank"
                    className="font-medium underline"
                  >
                    {o.displayNumber}
                  </Link>{' '}
                  ({t(`orderStatus.${o.status}` as AdminKey)})
                </span>
              ))}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
