// Platform staff (super admins; phase-1-plan §5.3): who holds a platform
// role and whether they use two-factor login. Changing a role signs that
// person out. New platform staff are added with platform:grant-role.
import { zodResolver } from '@hookform/resolvers/zod';
import { PLATFORM_ROLES } from '@managemind/shared/permissions';
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Info, UserCog } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { DataList } from '../../components/data-list';
import { Form, SelectField } from '../../components/form';
import { RowMenu, RowMenuItem } from '../../components/list-tools';
import { Notice } from '../../components/notice';
import { PageHeader } from '../../components/page-header';
import { StoreTile } from '../../components/store-switcher';
import { useToast } from '../../components/toast';
import { SecondaryBadge, StatusBadge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { useLocale } from '../../i18n';
import { api, meQuery, unwrap } from '../../lib/api';
import { errorMessage, saveErrorMessage } from '../../lib/errors';

type Person = Awaited<ReturnType<typeof fetchStaff>>[number];

async function fetchStaff() {
  return unwrap(await api.GET('/v1/platform/staff'));
}

export function PlatformStaffPage() {
  const { t } = useLocale();
  const { data: me } = useSuspenseQuery(meQuery);
  const staff = useQuery({ queryKey: ['platform', 'staff'], queryFn: fetchStaff });
  const [changing, setChanging] = useState<Person>();
  const [before = '', after = ''] = t('platformStaff.note', { command: '\u0000' }).split('\u0000');
  const roleTone = { super_admin: 'moving', support: 'progress' } as const;
  return (
    <div className="flex w-full max-w-[960px] flex-col gap-3 md:gap-4">
      <PageHeader
        className="mb-0"
        title={t('platform.staff')}
        description={t('platformStaff.intro')}
      />
      <div className="flex items-start gap-2.5 rounded-[10px] bg-muted px-3.5 py-3">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p>
          {before}
          <code lang="en" className="font-mono text-[13px]">
            platform:grant-role
          </code>
          {after}
        </p>
      </div>
      <DataList<Person>
        label={t('platform.staff')}
        items={staff.data}
        rowKey={(p) => p.id}
        grid="minmax(0,1.3fr) minmax(0,1.4fr) 140px minmax(0,1fr) 36px"
        rowHeight={52}
        isPending={staff.isPending}
        error={staff.isError ? errorMessage(staff.error, t) : undefined}
        onRetry={() => staff.refetch()}
        menu={(p) =>
          p.id !== me.user.id ? (
            <RowMenu label={p.name}>
              <RowMenuItem onSelect={() => setChanging(p)}>
                <UserCog aria-hidden />
                {t('staff.changeRole')}
              </RowMenuItem>
            </RowMenu>
          ) : (
            <span />
          )
        }
        card={(p) => (
          <div className="flex items-center gap-2.5">
            <StoreTile
              name={p.name}
              className="size-8 rounded-lg bg-muted text-xs text-foreground"
            />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-medium">{p.name}</span>
              <span className="truncate text-[13px] text-muted-foreground">{p.email}</span>
            </span>
            <StatusBadge tone={p.platformRole ? roleTone[p.platformRole] : 'plain'}>
              {p.platformRole ? t(`role.${p.platformRole}`) : t('platformStaff.none')}
            </StatusBadge>
          </div>
        )}
        columns={[
          {
            header: t('staff.name'),
            skeleton: 'lines',
            cell: (p) => (
              <span className="flex min-w-0 items-center gap-2.5">
                <StoreTile
                  name={p.name}
                  className="size-8 rounded-lg bg-muted text-xs font-semibold text-foreground"
                />
                <span className="truncate font-medium">{p.name}</span>
                {p.id === me.user.id && <SecondaryBadge>{t('staff.you')}</SecondaryBadge>}
              </span>
            ),
          },
          {
            header: t('staff.email'),
            cell: (p) => <span className="block truncate text-muted-foreground">{p.email}</span>,
          },
          {
            header: t('platformStaff.role'),
            skeleton: 'badge',
            cell: (p) => (
              <StatusBadge tone={p.platformRole ? roleTone[p.platformRole] : 'plain'}>
                {p.platformRole ? t(`role.${p.platformRole}`) : t('platformStaff.none')}
              </StatusBadge>
            ),
          },
          {
            header: t('platformStaff.twoFactor'),
            skeleton: 'badge',
            cell: (p) => (
              <StatusBadge tone={p.twoFactorEnabled ? 'good' : 'waiting'}>
                {t(p.twoFactorEnabled ? 'platformStaff.on' : 'platformStaff.off')}
              </StatusBadge>
            ),
          },
        ]}
      />
      {changing && <RoleDialog person={changing} onClose={() => setChanging(undefined)} />}
    </div>
  );
}

const schema = z.object({ role: z.enum([...PLATFORM_ROLES, 'none']) });

function RoleDialog({ person, onClose }: { person: Person; onClose: () => void }) {
  const { t } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { role: person.platformRole ?? 'none' },
  });
  const save = useMutation({
    mutationFn: async ({ role }: z.infer<typeof schema>) =>
      unwrap(
        await api.PUT('/v1/platform/staff/{id}/role', {
          params: { path: { id: person.id } },
          body: { role: role === 'none' ? null : role },
        }),
      ),
    onSuccess: async () => {
      toast(t('platformStaff.changed'));
      onClose();
      await queryClient.invalidateQueries({ queryKey: ['platform', 'staff'] });
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={t('platformStaff.changeTitle', { name: person.name })}
      description={t('platformStaff.changeHint')}
    >
      <Form form={form} onSubmit={(v) => save.mutate(v)}>
        <SelectField
          name="role"
          label={t('platformStaff.role')}
          options={[
            ...PLATFORM_ROLES.map((r) => ({ value: r, label: t(`role.${r}`) })),
            { value: 'none', label: t('platformStaff.none') },
          ]}
        />
        {save.isError && <Notice tone="error">{saveErrorMessage(save.error, t)}</Notice>}
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <Button variant="ghost" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button type="submit" disabled={save.isPending || !form.formState.isDirty}>
            {t('action.save')}
          </Button>
        </div>
      </Form>
    </Dialog>
  );
}
