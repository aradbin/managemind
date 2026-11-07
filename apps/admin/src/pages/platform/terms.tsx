// Platform → Terms (phase-5b-plan §3.4, §7): versions with how many stores
// accepted each; super admins publish a new one with its effective date.
import { zodResolver } from '@hookform/resolvers/zod';
import { formatNumber } from '@managemind/shared/i18n';
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Form, TextField } from '../../components/form';
import { Notice } from '../../components/notice';
import { PageHeader } from '../../components/page-header';
import { SaveBar } from '../../components/save-bar';
import { useToast } from '../../components/toast';
import { SecondaryBadge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { cardPadded, cardTitle } from '../../components/ui/card';
import { Dialog } from '../../components/ui/dialog';
import { useLocale } from '../../i18n';
import { formatDateTime } from '../../lib/dates';
import '../../i18n/launch';
import { api, meQuery, unwrap } from '../../lib/api';
import { errorMessage, saveErrorMessage } from '../../lib/errors';
import { cn } from '../../lib/utils';

const schema = z.object({
  version: z
    .string()
    .trim()
    .regex(/^[\w.-]{1,40}$/, 'form.invalid'),
  effectiveAt: z.string().min(1, 'form.required'),
  url: z.string().trim().url('form.invalid'),
  sha256: z
    .string()
    .trim()
    .regex(/^([0-9a-fA-F]{64})?$/, 'form.invalid'),
});

export function PlatformTermsPage() {
  const { t, locale } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: me } = useSuspenseQuery(meQuery);
  const versions = useQuery({
    queryKey: ['platform', 'terms'],
    queryFn: async () => unwrap(await api.GET('/v1/platform/terms')),
  });
  const form = useForm<z.input<typeof schema>, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { version: '', effectiveAt: '', url: '', sha256: '' },
  });
  const publish = useMutation({
    mutationFn: async (v: z.output<typeof schema>) =>
      unwrap(
        await api.POST('/v1/platform/terms', {
          body: {
            version: v.version,
            // A date picked here is a Dhaka date: midnight in Dhaka.
            effectiveAt: new Date(`${v.effectiveAt}T00:00:00+06:00`).toISOString(),
            url: v.url,
            ...(v.sha256 ? { sha256: v.sha256 } : {}),
          },
        }),
      ),
    onSuccess: async (created) => {
      toast(t('pterms.published', { version: created.version }));
      form.reset();
      setPublishing(false);
      await queryClient.invalidateQueries({ queryKey: ['platform', 'terms'] });
    },
  });
  const [publishing, setPublishing] = useState(false);
  const superAdmin = me.user.platformRole === 'super_admin';
  // The version in force: the newest whose date has come.
  const current = versions.data?.find((v) => Date.parse(v.effectiveAt) <= Date.now())?.id;
  return (
    <div className="flex w-full max-w-[860px] flex-col gap-3 md:gap-4">
      <PageHeader className="mb-0" title={t('platform.terms')} />
      <section aria-labelledby="terms-h" className={cn(cardPadded, 'gap-3.5 md:gap-3.5')}>
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 id="terms-h" className={cardTitle}>
              {t('pterms.title')}
            </h2>
            <p className="text-[13px] text-muted-foreground">{t('pterms.intro')}</p>
          </div>
          {superAdmin && (
            <Button
              variant="secondary"
              className="h-8 md:h-8"
              aria-haspopup="dialog"
              onClick={() => setPublishing(true)}
            >
              <Plus aria-hidden />
              {t('pterms.publish')}
            </Button>
          )}
        </div>
        {versions.isError && <Notice tone="error">{errorMessage(versions.error, t)}</Notice>}
        {versions.data?.length === 0 && <p className="text-muted-foreground">{t('pterms.none')}</p>}
        {!!versions.data?.length && (
          <div className="-mx-4 md:-mx-5">
            <table className="w-full border-collapse">
              <thead>
                <tr className="h-[38px] bg-muted text-[13px] text-muted-foreground">
                  <th scope="col" className="pl-4 text-left font-medium md:pl-5">
                    {t('pterms.version')}
                  </th>
                  <th scope="col" className="w-[140px] px-3 text-left font-medium">
                    {t('pterms.effectiveAt')}
                  </th>
                  <th scope="col" className="w-[120px] pr-4 text-right font-medium md:pr-5">
                    {t('pterms.accepted')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {versions.data.map((v) => (
                  <tr key={v.id} className="h-11 border-t border-border">
                    <td className="pl-4 md:pl-5">
                      <span className="flex items-center gap-2">
                        <a href={v.url} target="_blank" rel="noopener" className="font-mono">
                          {v.version}
                        </a>
                        {v.id === current && <SecondaryBadge>{t('pterms.current')}</SecondaryBadge>}
                      </span>
                    </td>
                    <td className="px-3 text-[13px] text-muted-foreground">
                      {formatDateTime(locale, new Date(v.effectiveAt), { dateStyle: 'medium' })}
                    </td>
                    <td
                      className={cn(
                        'pr-4 text-right tabular-nums md:pr-5',
                        v.acceptedStores < v.storesAsked && 'text-warning-foreground',
                      )}
                    >
                      {t('pterms.acceptedOf', {
                        accepted: formatNumber(locale, v.acceptedStores),
                        asked: formatNumber(locale, v.storesAsked),
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {superAdmin && <SupportSection />}
      <Dialog open={publishing} onOpenChange={setPublishing} title={t('pterms.publish')}>
        <Form form={form} onSubmit={(v) => publish.mutate(v)}>
          <TextField name="version" label={t('pterms.version')} maxLength={40} />
          <TextField name="effectiveAt" label={t('pterms.effectiveAt')} type="date" />
          <TextField name="url" label={t('pterms.url')} type="url" inputMode="url" />
          <TextField
            name="sha256"
            label={t('pterms.sha256')}
            hint={t('pterms.sha256Hint')}
            optional
            spellCheck={false}
          />
          {publish.isError && <Notice tone="error">{saveErrorMessage(publish.error, t)}</Notice>}
          <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
            <Button variant="secondary" onClick={() => setPublishing(false)}>
              {t('action.cancel')}
            </Button>
            <Button type="submit" disabled={publish.isPending}>
              {t('pterms.publish')}
            </Button>
          </div>
        </Form>
      </Dialog>
    </div>
  );
}

const optional = (schema: z.ZodString) => z.union([z.literal(''), schema]);
const supportSchema = z.object({
  email: optional(z.string().trim().email('form.invalid')),
  whatsapp: optional(
    z
      .string()
      .trim()
      .regex(/^8801[3-9]\d{8}$/, 'form.invalid'),
  ),
  abuseEmail: optional(z.string().trim().email('form.invalid')),
  helpUrl: optional(z.string().trim().url('form.invalid')),
  privacyUrl: optional(z.string().trim().url('form.invalid')),
  dpaUrl: optional(z.string().trim().url('form.invalid')),
});
type SupportForm = z.output<typeof supportSchema>;

/** Our support contacts and documents (phase-5b-plan §3.15, §7). */
function SupportSection() {
  const { t } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const support = useQuery({
    queryKey: ['platform', 'support'],
    queryFn: async () => unwrap(await api.GET('/v1/platform/support')),
  });
  const form = useForm<z.input<typeof supportSchema>, unknown, SupportForm>({
    resolver: zodResolver(supportSchema),
    values: {
      email: support.data?.email ?? '',
      whatsapp: support.data?.whatsapp ?? '',
      abuseEmail: support.data?.abuseEmail ?? '',
      helpUrl: support.data?.helpUrl ?? '',
      privacyUrl: support.data?.privacyUrl ?? '',
      dpaUrl: support.data?.dpaUrl ?? '',
    },
  });
  const save = useMutation({
    mutationFn: async (v: SupportForm) =>
      unwrap(
        await api.PUT('/v1/platform/support', {
          body: Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '')),
        }),
      ),
    onSuccess: async () => {
      toast(t('psupport.saved'));
      await queryClient.invalidateQueries({ queryKey: ['platform', 'support'] });
      await queryClient.invalidateQueries({ queryKey: ['help'] });
    },
  });
  const submit = form.handleSubmit((v) => save.mutate(v));
  return (
    <section aria-labelledby="support-h" className={cn(cardPadded, 'gap-4 md:gap-4')}>
      <div className="flex flex-col gap-1">
        <h2 id="support-h" className={cardTitle}>
          {t('psupport.title')}
        </h2>
        <p className="text-[13px] text-muted-foreground">{t('psupport.intro')}</p>
      </div>
      {support.isError && <Notice tone="error">{errorMessage(support.error, t)}</Notice>}
      <Form form={form} onSubmit={(v) => save.mutate(v)}>
        <div className="grid gap-x-4 gap-y-3 md:grid-cols-2">
          <TextField name="email" label={t('psupport.email')} type="email" />
          <TextField
            name="whatsapp"
            label={t('psupport.whatsapp')}
            hint={t('psupport.whatsappHint')}
            inputMode="numeric"
          />
        </div>
        <TextField name="abuseEmail" label={t('psupport.abuseEmail')} type="email" />
        <TextField name="helpUrl" label={t('psupport.helpUrl')} type="url" />
        <div className="grid gap-x-4 gap-y-3 md:grid-cols-2">
          <TextField name="privacyUrl" label={t('psupport.privacyUrl')} type="url" />
          <TextField name="dpaUrl" label={t('psupport.dpaUrl')} type="url" />
        </div>
        {save.isError && <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>}
        <SaveBar
          show={form.formState.isDirty}
          message={t('form.unsaved')}
          discardLabel={t('action.discard')}
          onDiscard={() => form.reset()}
          saveLabel={t('action.save')}
          busy={save.isPending}
          onSave={() => void submit()}
        />
      </Form>
    </section>
  );
}
