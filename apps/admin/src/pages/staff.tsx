// Staff (phase-1-plan §5.6, §7.3): members and their roles, invitations,
// removing someone and leaving the store. Only roles you could hold
// yourself can be given (no escalation); the server enforces the same rule.
import { zodResolver } from '@hookform/resolvers/zod';
import { formatDateTime } from '@managemind/shared/i18n';
import { canManageRole, STORE_ROLES, type StoreRole } from '@managemind/shared/permissions';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { ConfirmDialog } from '../components/confirm-dialog';
import { DataList } from '../components/data-list';
import { Form, SelectField, TextField } from '../components/form';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { PermissionGate } from '../components/permission-gate';
import { useToast } from '../components/toast';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
import { type AdminKey, useLocale } from '../i18n';
import { ApiError, api, type Me, meQuery, unwrap } from '../lib/api';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import { refreshAccess } from '../lib/store';

type Member = Awaited<ReturnType<typeof fetchMembers>>['items'][number];
type Invitation = Awaited<ReturnType<typeof fetchInvitations>>[number];

async function fetchMembers(after?: string) {
  return unwrap(
    await api.GET('/v1/admin/members', {
      params: { query: { limit: 50, ...(after ? { after } : {}) } },
    }),
  );
}
async function fetchInvitations() {
  return unwrap(await api.GET('/v1/admin/invitations'));
}

/** The message for a refused staff change. */
function staffError(error: unknown, t: (key: AdminKey) => string): string {
  if (error instanceof ApiError) {
    if (error.problem?.code === 'last_owner') return t('staff.lastOwner');
    if (error.status === 409) return t('staff.alreadyMember');
  }
  return saveErrorMessage(error, t);
}

/** Roles the signed-in user may give, change or remove. */
function useManageable(me: Me) {
  return useMemo(() => {
    const held = new Set(me.permissions);
    return STORE_ROLES.filter((role) => canManageRole(held, role));
  }, [me.permissions]);
}

export function StaffPage() {
  const { t, locale } = useLocale();
  const { data: me } = useSuspenseQuery(meQuery);
  const manageable = useManageable(me);
  const store = me.stores.find((s) => s.tenantId === me.activeStore);
  const members = useInfiniteQuery({
    queryKey: ['members'],
    queryFn: ({ pageParam }) => fetchMembers(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const [inviting, setInviting] = useState(false);
  const [changing, setChanging] = useState<Member>();
  const [removing, setRemoving] = useState<Member>();
  const [leaving, setLeaving] = useState(false);

  const date = (d: string) => formatDateTime(locale, new Date(d), { dateStyle: 'medium' });
  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <PageHeader
        parent={{ to: '/settings', label: t('settings.title') }}
        title={t('settings.staff')}
        description={t('settings.staff.description')}
        actions={
          manageable.length > 0 && (
            <Button onClick={() => setInviting(true)}>{t('staff.invite')}</Button>
          )
        }
      />
      <section aria-labelledby="members-h" className="flex flex-col gap-3">
        <h2 id="members-h" className="text-lg font-semibold">
          {t('staff.members')}
        </h2>
        <DataList<Member>
          label={t('staff.members')}
          items={members.data?.pages.flatMap((p) => p.items)}
          rowKey={(m) => m.id}
          isPending={members.isPending}
          error={members.isError ? errorMessage(members.error, t) : undefined}
          onRetry={() => members.refetch()}
          hasMore={members.hasNextPage}
          loadingMore={members.isFetchingNextPage}
          onLoadMore={() => members.fetchNextPage()}
          columns={[
            {
              header: t('staff.name'),
              cell: (m) => (
                <>
                  {m.name}
                  {m.userId === me.user.id && (
                    <span className="ms-2 rounded bg-muted px-2 py-0.5 text-xs">
                      {t('staff.you')}
                    </span>
                  )}
                </>
              ),
            },
            { header: t('staff.email'), cell: (m) => <span className="break-all">{m.email}</span> },
            { header: t('staff.role'), cell: (m) => t(`role.${m.role}`) },
            { header: t('staff.joined'), cell: (m) => date(m.createdAt) },
            {
              header: t('staff.changeRole'),
              actions: true,
              cell: (m) =>
                m.userId !== me.user.id &&
                manageable.includes(m.role) && (
                  <span className="inline-flex flex-wrap justify-end gap-2">
                    <Button variant="secondary" onClick={() => setChanging(m)}>
                      {t('staff.changeRole')}
                    </Button>
                    <Button variant="secondary" onClick={() => setRemoving(m)}>
                      {t('staff.remove')}
                    </Button>
                  </span>
                ),
            },
          ]}
        />
      </section>

      <PermissionGate allow="staff.read">
        <Invitations canManage={(role) => manageable.includes(role)} date={date} />
      </PermissionGate>

      {me.role && !me.supportGrant && (
        <section className="border-t border-border pt-6">
          <Button variant="secondary" onClick={() => setLeaving(true)}>
            {t('staff.leave')}
          </Button>
        </section>
      )}

      <InviteDialog open={inviting} onOpenChange={setInviting} roles={manageable} />
      {changing && (
        <RoleDialog member={changing} roles={manageable} onClose={() => setChanging(undefined)} />
      )}
      {removing && (
        <RemoveDialog
          member={removing}
          storeName={store?.name ?? ''}
          onClose={() => setRemoving(undefined)}
        />
      )}
      <LeaveDialog open={leaving} onOpenChange={setLeaving} storeName={store?.name ?? ''} />
    </div>
  );
}

function roleOptions(roles: readonly StoreRole[], t: (key: AdminKey) => string) {
  return roles.map((role) => ({ value: role, label: t(`role.${role}`) }));
}

/** The chosen role's description, under the select (option text is cut off on phones). */
function RoleField({ roles }: { roles: readonly StoreRole[] }) {
  const { t } = useLocale();
  const role = useWatch({ name: 'role' }) as StoreRole;
  return (
    <SelectField
      name="role"
      label={t('staff.role')}
      hint={t(`role.${role}.hint`)}
      options={roleOptions(roles, t)}
    />
  );
}

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email('form.invalidEmail')),
  role: z.enum(STORE_ROLES),
});

function InviteDialog({
  open,
  onOpenChange,
  roles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roles: readonly StoreRole[];
}) {
  const { t } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  // One key per dialog: a retried send never invites twice.
  const [key, setKey] = useState(() => crypto.randomUUID());
  const form = useForm<z.input<typeof inviteSchema>, unknown, z.output<typeof inviteSchema>>({
    resolver: zodResolver(inviteSchema),
    defaultValues: {
      email: '',
      role: roles.includes('staff') ? 'staff' : (roles.at(-1) ?? 'viewer'),
    },
  });
  const invite = useMutation({
    mutationFn: async (v: z.output<typeof inviteSchema>) =>
      unwrap(
        await api.POST('/v1/admin/invitations', { body: v, headers: { 'Idempotency-Key': key } }),
      ),
    onSuccess: async (sent) => {
      toast(t('staff.invited', { email: sent.email }));
      close(false);
      await queryClient.invalidateQueries({ queryKey: ['invitations'] });
    },
  });
  function close(next: boolean) {
    if (!next) {
      form.reset();
      invite.reset();
      setKey(crypto.randomUUID());
    }
    onOpenChange(next);
  }
  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={t('staff.inviteTitle')}
      description={t('staff.inviteHint')}
    >
      <Form form={form} onSubmit={(v) => invite.mutate(v)}>
        <TextField
          name="email"
          label={t('staff.email')}
          type="email"
          inputMode="email"
          autoComplete="off"
        />
        <RoleField roles={roles} />
        {invite.isError && <Notice tone="error">{staffError(invite.error, t)}</Notice>}
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <Button variant="ghost" onClick={() => close(false)}>
            {t('action.cancel')}
          </Button>
          <Button type="submit" disabled={invite.isPending}>
            {t('staff.invite')}
          </Button>
        </div>
      </Form>
    </Dialog>
  );
}

const roleSchema = z.object({ role: z.enum(STORE_ROLES) });

function RoleDialog({
  member,
  roles,
  onClose,
}: {
  member: Member;
  roles: readonly StoreRole[];
  onClose: () => void;
}) {
  const { t } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const form = useForm<z.infer<typeof roleSchema>>({
    resolver: zodResolver(roleSchema),
    defaultValues: { role: member.role },
  });
  const change = useMutation({
    mutationFn: async ({ role }: z.infer<typeof roleSchema>) =>
      unwrap(
        await api.PATCH('/v1/admin/members/{id}', {
          params: { path: { id: member.id } },
          body: { role },
        }),
      ),
    onSuccess: async () => {
      toast(t('staff.roleChanged'));
      onClose();
      await queryClient.invalidateQueries({ queryKey: ['members'] });
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={t('staff.changeRoleTitle', { name: member.name })}
    >
      <Form form={form} onSubmit={(v) => change.mutate(v)}>
        <RoleField roles={roles} />
        {change.isError && <Notice tone="error">{staffError(change.error, t)}</Notice>}
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <Button variant="ghost" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button type="submit" disabled={change.isPending || !form.formState.isDirty}>
            {t('action.save')}
          </Button>
        </div>
      </Form>
    </Dialog>
  );
}

function RemoveDialog({
  member,
  storeName,
  onClose,
}: {
  member: Member;
  storeName: string;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: async () =>
      unwrap(await api.DELETE('/v1/admin/members/{id}', { params: { path: { id: member.id } } })),
    onSuccess: async () => {
      toast(t('staff.removed', { name: member.name }));
      onClose();
      await queryClient.invalidateQueries({ queryKey: ['members'] });
    },
  });
  return (
    <ConfirmDialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={t('staff.removeTitle', { name: member.name })}
      confirmLabel={t('staff.remove')}
      busy={remove.isPending}
      error={remove.isError ? staffError(remove.error, t) : undefined}
      onConfirm={() => remove.mutate()}
    >
      <p>{t('staff.removeBody', { name: member.name, store: storeName })}</p>
    </ConfirmDialog>
  );
}

function LeaveDialog({
  open,
  onOpenChange,
  storeName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeName: string;
}) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const leave = useMutation({
    mutationFn: async () => unwrap(await api.DELETE('/v1/admin/members/me')),
    onSuccess: async () => {
      await refreshAccess(queryClient);
      onOpenChange(false);
      await navigate({ to: '/', replace: true });
    },
  });
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) leave.reset();
        onOpenChange(next);
      }}
      title={t('staff.leaveTitle', { store: storeName })}
      confirmLabel={t('staff.leave')}
      confirmText={storeName}
      busy={leave.isPending}
      error={leave.isError ? staffError(leave.error, t) : undefined}
      onConfirm={() => leave.mutate()}
    >
      <p>{t('staff.leaveBody')}</p>
    </ConfirmDialog>
  );
}

function Invitations({
  canManage,
  date,
}: {
  canManage: (role: StoreRole) => boolean;
  date: (d: string) => string;
}) {
  const { t } = useLocale();
  const toast = useToast();
  const queryClient = useQueryClient();
  const invitations = useQuery({ queryKey: ['invitations'], queryFn: fetchInvitations });
  const [revoking, setRevoking] = useState<Invitation>();
  const resend = useMutation({
    mutationFn: async (id: string) =>
      unwrap(await api.POST('/v1/admin/invitations/{id}/resend', { params: { path: { id } } })),
    onSuccess: async () => {
      toast(t('staff.resent'));
      await queryClient.invalidateQueries({ queryKey: ['invitations'] });
    },
    onError: (e) => toast(staffError(e, t)),
  });
  const revoke = useMutation({
    mutationFn: async (id: string) =>
      unwrap(await api.DELETE('/v1/admin/invitations/{id}', { params: { path: { id } } })),
    onSuccess: async () => {
      toast(t('staff.revoked'));
      setRevoking(undefined);
      await queryClient.invalidateQueries({ queryKey: ['invitations'] });
    },
  });
  return (
    <section aria-labelledby="invitations-h" className="flex flex-col gap-3">
      <h2 id="invitations-h" className="text-lg font-semibold">
        {t('staff.invitations')}
      </h2>
      <DataList<Invitation>
        label={t('staff.invitations')}
        items={invitations.data}
        rowKey={(i) => i.id}
        isPending={invitations.isPending}
        error={invitations.isError ? errorMessage(invitations.error, t) : undefined}
        onRetry={() => invitations.refetch()}
        empty={t('staff.noInvitations')}
        columns={[
          { header: t('staff.email'), cell: (i) => <span className="break-all">{i.email}</span> },
          { header: t('staff.role'), cell: (i) => t(`role.${i.role}`) },
          { header: t('staff.expiresHeader'), cell: (i) => date(i.expiresAt) },
          {
            header: t('staff.resend'),
            actions: true,
            cell: (i) =>
              canManage(i.role) && (
                <span className="inline-flex flex-wrap justify-end gap-2">
                  <Button
                    variant="secondary"
                    disabled={resend.isPending}
                    onClick={() => resend.mutate(i.id)}
                  >
                    {t('staff.resend')}
                  </Button>
                  <Button variant="secondary" onClick={() => setRevoking(i)}>
                    {t('staff.revoke')}
                  </Button>
                </span>
              ),
          },
        ]}
      />
      {revoking && (
        <ConfirmDialog
          open
          onOpenChange={(next) => {
            if (!next) {
              setRevoking(undefined);
              revoke.reset();
            }
          }}
          title={t('staff.revokeTitle', { email: revoking.email })}
          confirmLabel={t('staff.revoke')}
          busy={revoke.isPending}
          error={revoke.isError ? staffError(revoke.error, t) : undefined}
          onConfirm={() => revoke.mutate(revoking.id)}
        />
      )}
    </section>
  );
}
