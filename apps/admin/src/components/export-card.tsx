// Settings → Store → Download your store's data (phase-5b-plan §3.10, Q13),
// for owners: once a day, prepared in a few minutes, and emailed as a link
// that works for 7 days.
import { formatDateTime } from '@managemind/shared/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale } from '../i18n';
import '../i18n/launch';
import { api, unwrap } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { Notice } from './notice';
import { Button } from './ui/button';

export function ExportCard() {
  const { t, locale } = useLocale();
  const queryClient = useQueryClient();
  const latest = useQuery({
    queryKey: ['export'],
    queryFn: async () => unwrap(await api.GET('/v1/admin/export')),
    refetchInterval: (q) =>
      q.state.data?.status === 'pending' || q.state.data?.status === 'running' ? 30_000 : false,
  });
  const request = useMutation({
    mutationFn: async () => unwrap(await api.POST('/v1/admin/export')),
    onSuccess: (job) => queryClient.setQueryData(['export'], job),
  });
  const job = latest.data;
  const busy = job?.status === 'pending' || job?.status === 'running';
  return (
    <section
      aria-labelledby="export-h"
      className="mt-8 flex flex-col gap-3 border-t border-border pt-6"
    >
      <h2 id="export-h" className="text-lg font-semibold">
        {t('exportData.title')}
      </h2>
      <p className="text-muted-foreground">{t('exportData.intro')}</p>
      {busy && <Notice>{t('exportData.pending')}</Notice>}
      {job?.status === 'failed' && <Notice tone="error">{t('exportData.failed')}</Notice>}
      {job?.downloadUrl && job.expiresAt && (
        <p>{t('exportData.ready', { date: formatDateTime(locale, new Date(job.expiresAt)) })}</p>
      )}
      {request.isError && <Notice tone="error">{errorMessage(request.error, t)}</Notice>}
      <div className="flex flex-wrap gap-2">
        {job?.downloadUrl && (
          <Button asChild>
            <a href={job.downloadUrl} rel="noopener noreferrer">
              {t('jobs.download')}
            </a>
          </Button>
        )}
        {!busy && (
          <Button
            variant={job?.downloadUrl ? 'secondary' : 'primary'}
            disabled={request.isPending}
            onClick={() => request.mutate()}
          >
            {t('exportData.request')}
          </Button>
        )}
      </div>
    </section>
  );
}
