// The platform terms prompt for owners (phase-5b-plan §3.4, Q7): from the day
// a version is published, owners see it with Accept; from its effective date
// their admin is read-only until one owner accepts. Loaded only for owners.
import { formatDateTime } from '@managemind/shared/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale } from '../i18n';
import '../i18n/launch';
import { api, unwrap } from '../lib/api';
import { saveErrorMessage } from '../lib/errors';
import { Button } from './ui/button';

export const termsQuery = {
  queryKey: ['terms'] as const,
  queryFn: async () => unwrap(await api.GET('/v1/admin/terms/pending')),
  staleTime: 5 * 60_000,
};

export default function TermsPrompt() {
  const { t, locale } = useLocale();
  const queryClient = useQueryClient();
  const terms = useQuery(termsQuery);
  const accept = useMutation({
    mutationFn: async (versionId: string) =>
      unwrap(await api.POST('/v1/admin/terms/accept', { body: { versionId } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['terms'] });
      await queryClient.invalidateQueries({ queryKey: ['setup'] });
    },
  });
  const p = terms.data?.pending;
  if (!p || !terms.data?.canAccept) return null;
  const blocking = terms.data.blocking;
  return (
    <div
      role={blocking ? 'alert' : 'status'}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-warning px-4 py-2 text-sm text-warning-foreground"
    >
      <span>
        {t(blocking ? 'terms.blocking' : 'terms.pending', {
          date: formatDateTime(locale, new Date(p.effectiveAt), { dateStyle: 'long' }),
        })}{' '}
        <a href={p.url} target="_blank" rel="noopener" className="font-semibold underline">
          {t('terms.read', { version: p.version })}
        </a>
      </span>
      <Button variant="secondary" disabled={accept.isPending} onClick={() => accept.mutate(p.id)}>
        {t('terms.accept')}
      </Button>
      {accept.isError && <span role="alert">{saveErrorMessage(accept.error, t)}</span>}
    </div>
  );
}
