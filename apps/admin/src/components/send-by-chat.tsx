// Send by chat (phase-9-plan §3.1.3): the order's summary, payment link or
// tracking link as one message in the order's language, opened in WhatsApp
// with the text written in, or copied for Messenger and Instagram, whose
// links can't carry text. A payment link is made, or reused, on asking.
import type { ChatMessageKind } from '@managemind/shared/channels';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageCircle } from 'lucide-react';
import { useState } from 'react';
import { useLocale } from '../i18n';
import '../i18n/orders';
import { api, unwrap } from '../lib/api';
import { orderErrorMessage } from '../lib/orders';
import { Notice } from './notice';
import { useToast } from './toast';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';

export function SendByChat({ orderId, canPay }: { orderId: string; canPay: boolean }) {
  const { t } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ChatMessageKind>('summary');
  const make = useMutation({
    mutationFn: async (k: ChatMessageKind) =>
      unwrap(
        await api.POST('/v1/admin/orders/{id}/chat-message', {
          params: { path: { id: orderId } },
          body: { kind: k },
        }),
      ),
    onSuccess: (_, k) => {
      if (k === 'payment') void queryClient.invalidateQueries({ queryKey: ['order', orderId] });
    },
  });
  const choose = (k: ChatMessageKind) => {
    setKind(k);
    make.mutate(k);
  };
  const kinds: ChatMessageKind[] = canPay
    ? ['summary', 'payment', 'tracking']
    : ['summary', 'tracking'];
  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          setOpen(true);
          choose('summary');
        }}
      >
        <MessageCircle aria-hidden className="size-4" />
        {t('chat.send')}
      </Button>
      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(false)} title={t('chat.send')}>
          <div className="flex flex-col gap-4">
            <div role="radiogroup" aria-label={t('chat.send')} className="flex flex-wrap gap-2">
              {kinds.map((k) => (
                <Button
                  key={k}
                  role="radio"
                  aria-checked={kind === k}
                  variant={kind === k ? 'primary' : 'secondary'}
                  onClick={() => choose(k)}
                >
                  {t(`chat.kind.${k}`)}
                </Button>
              ))}
            </div>
            {make.isPending && <p role="status">{t('loading')}</p>}
            {make.isError && <Notice tone="error">{orderErrorMessage(make.error, t)}</Notice>}
            {make.data && !make.isPending && (
              <>
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  {t('chat.message')}
                  <textarea
                    readOnly
                    rows={9}
                    value={make.data.text}
                    lang={make.data.locale}
                    className="rounded-lg border border-border bg-muted p-3 text-base font-normal"
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button asChild>
                    <a href={make.data.whatsappUrl} target="_blank" rel="noopener noreferrer">
                      {t('chat.whatsapp')}
                    </a>
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      await navigator.clipboard.writeText(make.data.text);
                      toast(t('chat.copied'));
                    }}
                  >
                    {t('chat.copy')}
                  </Button>
                </div>
              </>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}
