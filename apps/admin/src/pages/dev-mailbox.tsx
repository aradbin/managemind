// The dev mailbox (phase-1-plan §3.8, §7.3): emails the capture provider
// saved instead of sending, outside production. Previews need the deploy's
// DEV_TOKEN, kept in this tab only. HTML is shown in a sandboxed frame
// with scripts and navigation off.
import { formatDateTime } from '@managemind/shared/i18n';
import { useMutation } from '@tanstack/react-query';
import { type FormEvent, Fragment, useState } from 'react';
import { Field } from '../components/field';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { Button } from '../components/ui/button';
import { useLocale } from '../i18n';

interface Mail {
  id: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  createdAt: string;
}

const TOKEN_KEY = 'mm.devToken';
const readToken = () => {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
};

/** Plain text with its links clickable (sign-in codes and invitation links). */
function Linked({ text }: { text: string }) {
  return (
    <>
      {text.split(/(https?:\/\/[^\s<>"]+)/g).map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a key={i} href={part} className="break-all text-primary underline" rel="noreferrer">
            {part}
          </a>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

export function DevMailboxPage() {
  const { t, locale } = useLocale();
  const [to, setTo] = useState('');
  const [token, setToken] = useState(readToken);
  const load = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/v1/_dev/mailbox?to=${encodeURIComponent(to.trim())}`, {
        headers: token ? { 'x-dev-token': token } : {},
      });
      if (res.status === 404) throw new Error('unavailable');
      if (!res.ok) throw new Error(`http_${res.status}`);
      return (await res.json()) as Mail[];
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    try {
      sessionStorage.setItem(TOKEN_KEY, token);
    } catch {
      // Not kept for the next visit.
    }
    load.mutate();
  }
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <PageHeader title={t('dev.mailbox')} description={t('dev.mailboxIntro')} />
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field
          label={t('dev.to')}
          type="email"
          inputMode="email"
          required
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <Field
          label={t('dev.token')}
          hint={t('dev.tokenHint')}
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <div>
          <Button type="submit" disabled={load.isPending}>
            {t('dev.show')}
          </Button>
        </div>
      </form>
      {load.isError && (
        <Notice tone="error">
          {load.error.message === 'unavailable' ? t('dev.unavailable') : t('error.generic')}
        </Notice>
      )}
      {load.data?.length === 0 && <p className="text-muted-foreground">{t('dev.none')}</p>}
      <ul className="flex flex-col gap-3">
        {load.data?.map((m) => (
          <li key={m.id} className="rounded-md border border-border p-3">
            <details>
              <summary className="flex min-h-11 cursor-pointer flex-col justify-center">
                <span className="font-medium">{m.subject}</span>
                <span className="text-sm text-muted-foreground">
                  {formatDateTime(locale, new Date(m.createdAt))}
                </span>
              </summary>
              <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm">
                <Linked text={m.text} />
              </pre>
              {m.html && (
                <iframe
                  title={m.subject}
                  sandbox=""
                  srcDoc={m.html}
                  className="mt-3 h-96 w-full rounded border border-border bg-white"
                />
              )}
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}
