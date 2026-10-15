// Platform: stores (phase-1-plan §7.3), searched by name or address and
// filtered by status; super admins create stores with their first owner.
import { zodResolver } from '@hookform/resolvers/zod';
import { formatDateTime } from '@managemind/shared/i18n';
import { SLUG_PATTERN } from '@managemind/shared/slug';
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { DataList } from '../../components/data-list';
import { Field } from '../../components/field';
import { Form, SelectField, TextField } from '../../components/form';
import { Notice } from '../../components/notice';
import { PageHeader } from '../../components/page-header';
import { useToast } from '../../components/toast';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { useLocale } from '../../i18n';
import { ApiError, api, meQuery, unwrap } from '../../lib/api';
import { errorMessage, saveErrorMessage } from '../../lib/errors';
import { StatusBadge, TENANT_STATUSES, type TenantStatus } from './status';

type Tenant = Awaited<ReturnType<typeof fetchTenants>>['items'][number];

async function fetchTenants(q: string, status: TenantStatus | '', after?: string) {
  return unwrap(
    await api.GET('/v1/platform/tenants', {
      params: {
        query: {
          limit: 50,
          ...(q ? { q } : {}),
          ...(status ? { status } : {}),
          ...(after ? { after } : {}),
        },
      },
    }),
  );
}

/** The value after the user stops typing for a moment. */
function useDebounced<T>(value: T, ms = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

export function TenantsPage() {
  const { t, locale } = useLocale();
  const { data: me } = useSuspenseQuery(meQuery);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<TenantStatus | ''>('');
  const [creating, setCreating] = useState(false);
  const q = useDebounced(query.trim());
  const tenants = useInfiniteQuery({
    queryKey: ['platform', 'tenants', q, status],
    queryFn: ({ pageParam }) => fetchTenants(q, status, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next ?? undefined,
  });
  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <PageHeader
        title={t('platform.tenants')}
        actions={
          me.user.platformRole === 'super_admin' && (
            <Button onClick={() => setCreating(true)}>{t('tenants.create')}</Button>
          )
        }
      />
      <div className="grid gap-3 md:grid-cols-[1fr_12rem]">
        <Field
          label={t('tenants.search')}
          type="search"
          value={query}
          maxLength={100}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="tenant-status" className="text-sm font-medium">
            {t('tenants.status')}
          </label>
          <select
            id="tenant-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as TenantStatus | '')}
            className="min-h-11 rounded-md border border-border bg-background px-3 text-base"
          >
            <option value="">{t('tenants.allStatuses')}</option>
            {TENANT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <DataList<Tenant>
        label={t('platform.tenants')}
        items={tenants.data?.pages.flatMap((p) => p.items)}
        rowKey={(x) => x.id}
        isPending={tenants.isPending}
        error={tenants.isError ? errorMessage(tenants.error, t) : undefined}
        onRetry={() => tenants.refetch()}
        empty={t('tenants.none')}
        hasMore={tenants.hasNextPage}
        loadingMore={tenants.isFetchingNextPage}
        onLoadMore={() => tenants.fetchNextPage()}
        columns={[
          {
            header: t('store.name'),
            cell: (x) => (
              <Link
                to="/platform/tenants/$id"
                params={{ id: x.id }}
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                {x.name}
              </Link>
            ),
          },
          { header: t('tenants.slug'), cell: (x) => <span lang="en">{x.slug}</span> },
          { header: t('tenants.status'), cell: (x) => <StatusBadge status={x.status} /> },
          {
            header: t('tenants.createdAt'),
            cell: (x) => formatDateTime(locale, new Date(x.createdAt), { dateStyle: 'medium' }),
          },
        ]}
      />
      <CreateDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

const createSchema = z.object({
  slug: z.string().trim().toLowerCase().regex(SLUG_PATTERN, 'tenants.slugInvalid'),
  name: z.string().trim().min(1).max(100),
  defaultLocale: z.enum(['bn', 'en']),
  ownerEmail: z.string().trim().toLowerCase().max(254).pipe(z.email('form.invalidEmail')),
  ownerName: z.string().trim().min(1).max(100),
});
type CreateInput = z.input<typeof createSchema>;
type CreateOutput = z.output<typeof createSchema>;

function CreateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLocale();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const form = useForm<CreateInput, unknown, CreateOutput>({
    resolver: zodResolver(createSchema),
    defaultValues: { slug: '', name: '', defaultLocale: 'bn', ownerEmail: '', ownerName: '' },
  });
  const create = useMutation({
    mutationFn: async (v: CreateOutput) =>
      unwrap(
        await api.POST('/v1/platform/tenants', {
          body: {
            slug: v.slug,
            name: v.name,
            defaultLocale: v.defaultLocale,
            owner: { email: v.ownerEmail, name: v.ownerName },
          },
        }),
      ),
    onSuccess: async (created, v) => {
      toast(t('tenants.created', { name: v.name, email: v.ownerEmail }));
      close(false);
      await queryClient.invalidateQueries({ queryKey: ['platform', 'tenants'] });
      await navigate({ to: '/platform/tenants/$id', params: { id: created.id } });
    },
    onError: (e) => {
      const code = e instanceof ApiError ? e.problem?.code : undefined;
      if (code === 'slug_taken') form.setError('slug', { message: 'tenants.slugTaken' });
      if (code === 'slug_reserved') form.setError('slug', { message: 'tenants.slugReserved' });
    },
  });
  function close(next: boolean) {
    if (!next) {
      form.reset();
      create.reset();
    }
    onOpenChange(next);
  }
  const slugError =
    create.error instanceof ApiError &&
    ['slug_taken', 'slug_reserved'].includes(create.error.problem?.code ?? '');
  return (
    <Dialog open={open} onOpenChange={close} title={t('tenants.create')}>
      <Form form={form} onSubmit={(v) => create.mutate(v)}>
        <TextField
          name="slug"
          label={t('tenants.slug')}
          hint={t('tenants.slugHint')}
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          maxLength={32}
        />
        <TextField name="name" label={t('store.name')} maxLength={100} />
        <SelectField
          name="defaultLocale"
          label={t('store.defaultLocale')}
          options={[
            { value: 'bn', label: 'বাংলা' },
            { value: 'en', label: 'English' },
          ]}
        />
        <TextField
          name="ownerEmail"
          label={t('tenants.ownerEmail')}
          type="email"
          inputMode="email"
          autoComplete="off"
        />
        <TextField
          name="ownerName"
          label={t('tenants.ownerName')}
          maxLength={100}
          autoComplete="off"
        />
        {create.isError && !slugError && (
          <Notice tone="error">{saveErrorMessage(create.error, t)}</Notice>
        )}
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <Button variant="ghost" onClick={() => close(false)}>
            {t('action.cancel')}
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {t('tenants.create')}
          </Button>
        </div>
      </Form>
    </Dialog>
  );
}
