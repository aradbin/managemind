// Platform staff (super admins; phase-1-plan §5.3): who holds a platform
// role and whether they use two-factor login. Changing a role signs that
// person out. New platform staff are added with platform:grant-role.
import { zodResolver } from '@hookform/resolvers/zod';
import { PLATFORM_ROLES } from '@managemind/shared/permissions';
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { DataList } from '../../components/data-list';
import { Form, SelectField } from '../../components/form';
import { Notice } from '../../components/notice';
import { PageHeader } from '../../components/page-header';
import { useToast } from '../../components/toast';
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
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <PageHeader title={t('platform.staff')} description={t('platformStaff.grantHint')} />
      <DataList<Person>
        label={t('platform.staff')}
        items={staff.data}
        rowKey={(p) => p.id}
        isPending={staff.isPending}
        error={staff.isError ? errorMessage(staff.error, t) : undefined}
        onRetry={() => staff.refetch()}
        columns={[
          {
            header: t('staff.name'),
            cell: (p) => (
              <>
                {p.name}
                {p.id === me.user.id && (
                  <span className="ms-2 rounded bg-muted px-2 py-0.5 text-xs">
                    {t('staff.you')}
                  </span>
                )}
              </>
            ),
          },
          { header: t('staff.email'), cell: (p) => <span className="break-all">{p.email}</span> },
          {
            header: t('platformStaff.role'),
            cell: (p) => (p.platformRole ? t(`role.${p.platformRole}`) : t('platformStaff.none')),
          },
          {
            header: t('platformStaff.twoFactor'),
            cell: (p) => t(p.twoFactorEnabled ? 'platformStaff.on' : 'platformStaff.off'),
          },
          {
            header: t('staff.changeRole'),
            actions: true,
            cell: (p) =>
              p.id !== me.user.id && (
                <Button variant="secondary" onClick={() => setChanging(p)}>
                  {t('staff.changeRole')}
                </Button>
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
