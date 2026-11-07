// Staff (phase-1-plan §5.6, §7.3): members and their roles, invitations,
// removing someone and leaving the store. Only roles you could hold
// yourself can be given (no escalation); the server enforces the same rule.
import { zodResolver } from '@hookform/resolvers/zod';
import { canManageRole, STORE_ROLES, type StoreRole } from '@managemind/shared/permissions';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Plus, UserCog, UserMinus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { ConfirmDialog } from '../components/confirm-dialog';
import { Form, SelectField, TextField } from '../components/form';
import { RowMenu, RowMenuItem, RowMenuSeparator } from '../components/list-tools';
import { Notice } from '../components/notice';
import { PageHeader } from '../components/page-header';
import { PermissionGate } from '../components/permission-gate';
import { initials } from '../components/store-switcher';
import { useToast } from '../components/toast';
import { SecondaryBadge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { cardFrame, cardPadded, cardTitle } from '../components/ui/card';
import { Dialog } from '../components/ui/dialog';
import { type AdminKey, useLocale } from '../i18n';
import { ApiError, api, type Me, meQuery, unwrap } from '../lib/api';
import { formatDateTime } from '../lib/dates';
import { errorMessage, saveErrorMessage } from '../lib/errors';
import { refreshAccess } from '../lib/store';
import { cn } from '../lib/utils';

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
    <div className="flex flex-col gap-3 md:gap-4">
      <PageHeader
        parent={{ to: '/settings', label: t('settings.title') }}
        title={t('settings.staff')}
        description={t('settings.staff.description')}
        actions={
          manageable.length > 0 && (
            <Button onClick={() => setInviting(true)}>
              <Plus aria-hidden />
              {t('staff.invite')}
            </Button>
          )
        }
      />
      <section
        aria-labelledby="members-h"
        className={cn(cardFrame, 'flex flex-col gap-2 pt-4 md:pt-5')}
      >
        <h2 id="members-h" className={cn(cardTitle, 'px-4 pb-1 md:px-5')}>
          {t('staff.members')}
        </h2>
        {members.isPending && (
          <p role="status" className="px-4 pb-4 md:px-5">
            {t('loading')}
          </p>
        )}
        {members.isError && (
          <div className="px-4 pb-4 md:px-5">
            <Notice tone="error">{errorMessage(members.error, t)}</Notice>
          </div>
        )}
        <ul aria-label={t('staff.members')}>
          {members.data?.pages
            .flatMap((p) => p.items)
            .map((m) => {
              const you = m.userId === me.user.id;
              return (
                <li
                  key={m.id}
                  className="grid min-h-14 grid-cols-[32px_minmax(0,1fr)_36px] items-center gap-3 border-t border-border py-2 pr-3 pl-4 md:grid-cols-[32px_minmax(0,1fr)_110px_120px_36px] md:pl-5"
                >
                  <span
                    aria-hidden
                    className="inline-flex size-8 items-center justify-center rounded-full bg-muted text-xs font-semibold"
                  >
                    {initials(m.name)}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-medium">{m.name}</span>
                      {you && <SecondaryBadge>{t('staff.you')}</SecondaryBadge>}
                    </span>
                    <span className="truncate text-[13px] text-muted-foreground">{m.email}</span>
                    <span className="text-[13px] text-muted-foreground md:hidden">
                      {t(`role.${m.role}`)} · {date(m.createdAt)}
                    </span>
                  </span>
                  <span className="max-md:hidden">{t(`role.${m.role}`)}</span>
                  <span className="text-[13px] text-muted-foreground max-md:hidden">
                    {date(m.createdAt)}
                  </span>
                  <span className="flex justify-end">
                    {!you && manageable.includes(m.role) && (
                      <RowMenu label={t('staff.memberActions', { name: m.name })}>
                        <RowMenuItem onSelect={() => setChanging(m)}>
                          <UserCog aria-hidden />
                          {t('staff.changeRole')}
                        </RowMenuItem>
                        <RowMenuSeparator />
                        <RowMenuItem danger onSelect={() => setRemoving(m)}>
                          <UserMinus aria-hidden />
                          {t('staff.remove')}
                        </RowMenuItem>
                      </RowMenu>
                    )}
                  </span>
                </li>
              );
            })}
        </ul>
        {members.hasNextPage && (
          <Button
            variant="ghost"
            className="mx-2 mb-2 self-start"
            disabled={members.isFetchingNextPage}
            onClick={() => members.fetchNextPage()}
          >
            {t('list.more')}
          </Button>
        )}
      </section>

      <PermissionGate allow="staff.read">
        <Invitations canManage={(role) => manageable.includes(role)} date={date} />
      </PermissionGate>

      {me.role && !me.supportGrant && (
        <Button
          variant="ghost"
          className="-ml-2.5 self-start px-2.5 text-danger hover:text-danger"
          onClick={() => setLeaving(true)}
        >
          {t('staff.leave')}
        </Button>
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
    <section aria-labelledby="invitations-h" className={cn(cardPadded, 'gap-2 md:gap-2')}>
      <h2 id="invitations-h" className={cardTitle}>
        {t('staff.invitations')}
      </h2>
      {invitations.isPending && <p role="status">{t('loading')}</p>}
      {invitations.isError && <Notice tone="error">{errorMessage(invitations.error, t)}</Notice>}
      {invitations.data?.length === 0 && (
        <p className="text-muted-foreground">{t('staff.noInvitations')}</p>
      )}
      {invitations.data && invitations.data.length > 0 && (
        <ul aria-label={t('staff.invitations')} className="-mx-4 md:-mx-5">
          {invitations.data.map((i) => (
            <li
              key={i.id}
              className="flex min-h-[52px] flex-wrap items-center gap-x-3 gap-y-2 border-t border-border px-4 py-2 md:px-5"
            >
              <span className="flex min-w-40 flex-1 flex-col">
                <span className="truncate font-medium">{i.email}</span>
                <span className="text-[13px] text-muted-foreground">
                  {t('staff.inviteLine', { role: t(`role.${i.role}`), date: date(i.expiresAt) })}
                </span>
              </span>
              {canManage(i.role) && (
                <>
                  <Button
                    variant="ghost"
                    disabled={resend.isPending}
                    onClick={() => resend.mutate(i.id)}
                  >
                    {t('staff.resend')}
                  </Button>
                  <Button
                    variant="ghost"
                    className="text-danger hover:text-danger"
                    onClick={() => setRevoking(i)}
                  >
                    {t('staff.revoke')}
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
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
