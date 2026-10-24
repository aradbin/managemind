// Platform → Terms (phase-5b-plan §3.4, §7): versions with how many stores
// accepted each; super admins publish a new one with its effective date.
import { zodResolver } from '@hookform/resolvers/zod';
import { formatDateTime } from '@managemind/shared/i18n';
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Form, TextField } from '../../components/form';
import { Notice } from '../../components/notice';
import { PageHeader } from '../../components/page-header';
import { useToast } from '../../components/toast';
import { Button } from '../../components/ui/button';
import { useLocale } from '../../i18n';
import '../../i18n/launch';
import { api, meQuery, unwrap } from '../../lib/api';
import { errorMessage, saveErrorMessage } from '../../lib/errors';

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
      await queryClient.invalidateQueries({ queryKey: ['platform', 'terms'] });
    },
  });
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title={t('pterms.title')} />
      <p className="text-muted-foreground">{t('pterms.intro')}</p>
      {versions.isError && <Notice tone="error">{errorMessage(versions.error, t)}</Notice>}
      {versions.data?.length === 0 && <p>{t('pterms.none')}</p>}
      {!!versions.data?.length && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted-foreground">
              <th className="text-start font-normal">{t('pterms.version')}</th>
              <th className="text-start font-normal">{t('pterms.effectiveAt')}</th>
              <th className="text-end font-normal">{t('pterms.accepted')}</th>
            </tr>
          </thead>
          <tbody>
            {versions.data.map((v) => (
              <tr key={v.id} className="border-t border-border">
                <td className="py-2">
                  <a href={v.url} target="_blank" rel="noopener" className="text-primary underline">
                    {v.version}
                  </a>
                </td>
                <td>{formatDateTime(locale, new Date(v.effectiveAt), { dateStyle: 'medium' })}</td>
                <td className="text-end">{v.acceptedStores}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {me.user.platformRole === 'super_admin' && (
        <section
          aria-labelledby="publish-h"
          className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 md:p-5"
        >
          <h2 id="publish-h" className="font-semibold">
            {t('pterms.publish')}
          </h2>
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
            <div>
              <Button type="submit" disabled={publish.isPending}>
                {t('pterms.publish')}
              </Button>
            </div>
          </Form>
        </section>
      )}
      {me.user.platformRole === 'super_admin' && <SupportSection />}
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
  return (
    <section
      aria-labelledby="support-h"
      className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 md:p-5"
    >
      <h2 id="support-h" className="font-semibold">
        {t('psupport.title')}
      </h2>
      <p className="text-muted-foreground">{t('psupport.intro')}</p>
      {support.isError && <Notice tone="error">{errorMessage(support.error, t)}</Notice>}
      <Form form={form} onSubmit={(v) => save.mutate(v)}>
        <TextField name="email" label={t('psupport.email')} type="email" optional />
        <TextField
          name="whatsapp"
          label={t('psupport.whatsapp')}
          hint={t('psupport.whatsappHint')}
          inputMode="numeric"
          optional
        />
        <TextField name="abuseEmail" label={t('psupport.abuseEmail')} type="email" optional />
        <TextField name="helpUrl" label={t('psupport.helpUrl')} type="url" optional />
        <TextField name="privacyUrl" label={t('psupport.privacyUrl')} type="url" optional />
        <TextField name="dpaUrl" label={t('psupport.dpaUrl')} type="url" optional />
        {save.isError && <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>}
        <div>
          <Button type="submit" disabled={save.isPending}>
            {t('action.save')}
          </Button>
        </div>
      </Form>
    </section>
  );
}
