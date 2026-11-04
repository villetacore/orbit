'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, Dialog, Drawer, Input, MultiSelect, Switch, Table, Tabs, Textarea, useToast } from '@villetacore/velessoft-ui';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { kc } from '@/api';
import { ErrorAlert, Loading } from '@/components/ui';
import { ConfirmDialog, JsonEditor, RoleMapping, type Rep } from './shared';
import { loadAllGroups, type KcGroup } from './Users';

function depth(path: string) {
  return path.split('/').length - 2;
}

export function GroupsAdmin() {
  const queryClient = useQueryClient();
  const groups = useQuery({ queryKey: ['kc', 'groups', 'flat'], queryFn: loadAllGroups });
  const defaults = useQuery({ queryKey: ['kc', 'default-groups'], queryFn: () => kc.get<{ id: string }[]>('/default-groups') });
  const [creating, setCreating] = useState<{ parent: KcGroup | null } | null>(null);
  const [selected, setSelected] = useState<KcGroup | null>(null);
  const [deleting, setDeleting] = useState<KcGroup | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['kc', 'groups'] });
  const remove = useMutation({
    mutationFn: (g: KcGroup) => kc.del(`/groups/${g.id}`),
    onSuccess: async () => {
      await refresh();
      setDeleting(null);
    },
  });
  const toggleDefault = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => (on ? kc.put(`/default-groups/${id}`) : kc.del(`/default-groups/${id}`)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['kc', 'default-groups'] }),
  });
  const isDefault = (id: string) => defaults.data?.some((d) => d.id === id) ?? false;

  return (
    <Card
      flat
      title="Группы"
      description="Иерархия, роли и участники. Группа по умолчанию назначается новым пользователям."
      actions={
        <Button size="sm" variant="primary" className="with-icon" onClick={() => setCreating({ parent: null })}>
          <Plus size={14} />
          Создать
        </Button>
      }
    >
      {groups.isPending && <Loading height={200} />}
      <ErrorAlert error={groups.error ?? toggleDefault.error} />
      {groups.isSuccess && (
        <Table
          compact
          rows={groups.data}
          rowKey={(g) => g.id}
          emptyText="Групп нет"
          columns={[
            {
              key: 'name',
              header: 'Группа',
              render: (g) => (
                <button type="button" className="vs-link text-button" style={{ paddingLeft: depth(g.path) * 16 }} onClick={() => setSelected(g)}>
                  {g.name}
                </button>
              ),
            },
            { key: 'path', header: 'Путь', render: (g) => <span className="mono small">{g.path}</span> },
            {
              key: 'default',
              header: 'По умолчанию',
              render: (g) => <Switch label={<span className="vs-visually-hidden">Группа по умолчанию</span>} checked={isDefault(g.id)} onChange={(e) => toggleDefault.mutate({ id: g.id, on: e.target.checked })} />,
            },
            {
              key: 'actions',
              header: <span className="vs-visually-hidden">Действия</span>,
              align: 'right',
              render: (g) => (
                <span className="row end">
                  <Button size="sm" variant="ghost" onClick={() => setCreating({ parent: g })}>
                    Подгруппа
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(g)}>
                    Удалить
                  </Button>
                </span>
              ),
            },
          ]}
        />
      )}
      {creating && <GroupDialog parent={creating.parent} onClose={() => setCreating(null)} />}
      {selected && <GroupDrawer key={selected.id} group={selected} onClose={() => setSelected(null)} />}
      {deleting && (
        <ConfirmDialog title={`Удалить ${deleting.path}?`} onClose={() => setDeleting(null)} onConfirm={() => remove.mutate(deleting)} pending={remove.isPending} error={remove.error}>
          <p>Группа и подгруппы исчезнут. Участники останутся, но потеряют роли, полученные через неё.</p>
        </ConfirmDialog>
      )}
    </Card>
  );
}

function GroupDialog({ parent, onClose }: { parent: KcGroup | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () => kc.post(parent ? `/groups/${parent.id}/children` : '/groups', { name }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['kc', 'groups'] });
      onClose();
    },
  });
  return (
    <Dialog
      open
      title={parent ? `Подгруппа в ${parent.path}` : 'Новая группа'}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={() => create.mutate()} disabled={!name.trim()} loading={create.isPending}>
            Создать
          </Button>
        </>
      }
    >
      <div className="stack">
        <Input label="Название" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <ErrorAlert error={create.error} />
      </div>
    </Dialog>
  );
}

function GroupDrawer({ group, onClose }: { group: KcGroup; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const detail = useQuery({ queryKey: ['kc', 'groups', group.id], queryFn: () => kc.get<Rep>(`/groups/${group.id}`) });
  const members = useQuery({
    queryKey: ['kc', 'groups', group.id, 'members'],
    queryFn: () => kc.get<{ id: string; username: string; email?: string }[]>(`/groups/${group.id}/members?max=200`),
  });
  const save = useMutation({
    mutationFn: (rep: Rep) => kc.put(`/groups/${group.id}`, rep),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['kc', 'groups'] });
      toast({ tone: 'success', title: 'Сохранено в Keycloak' });
    },
  });
  return (
    <Drawer open title={group.path} onClose={onClose} className="wide-drawer xl-drawer">
      <Tabs
        label="Разделы группы"
        items={[
          { value: 'roles', label: 'Роли', content: <RoleMapping basePath={`/groups/${group.id}`} /> },
          {
            value: 'members',
            label: 'Участники',
            content: (
              <Table
                compact
                rows={members.data ?? []}
                rowKey={(m) => m.id}
                emptyText="Участников нет"
                columns={[
                  { key: 'username', header: 'Логин', render: (m) => <span className="mono">{m.username}</span> },
                  { key: 'email', header: 'Email', render: (m) => m.email || '—' },
                ]}
              />
            ),
          },
          {
            value: 'json',
            label: 'Атрибуты и JSON',
            content: detail.data ? (
              <JsonEditor key={JSON.stringify(detail.data)} value={detail.data} onSave={(rep) => save.mutate(rep)} saving={save.isPending} error={save.error} />
            ) : (
              <Loading height={200} />
            ),
          },
        ]}
      />
    </Drawer>
  );
}

interface KcRole extends Rep {
  id: string;
  name: string;
  description?: string;
  composite?: boolean;
}

export function RolesAdmin() {
  const queryClient = useQueryClient();
  const roles = useQuery({ queryKey: ['kc', 'roles'], queryFn: () => kc.get<KcRole[]>('/roles?max=500') });
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<KcRole | null>(null);
  const [deleting, setDeleting] = useState<KcRole | null>(null);
  const remove = useMutation({
    mutationFn: (r: KcRole) => kc.del(`/roles-by-id/${r.id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['kc', 'roles'] });
      setDeleting(null);
    },
  });
  return (
    <Card
      flat
      title="Роли realm"
      description="Роли дают доступ к сервисам каталога и к администрированию Orbit."
      actions={
        <Button size="sm" variant="primary" className="with-icon" onClick={() => setCreating(true)}>
          <Plus size={14} />
          Создать
        </Button>
      }
    >
      {roles.isPending && <Loading height={200} />}
      <ErrorAlert error={roles.error} />
      {roles.isSuccess && (
        <Table
          compact
          rows={roles.data}
          rowKey={(r) => r.id}
          emptyText="Ролей нет"
          columns={[
            {
              key: 'name',
              header: 'Роль',
              sortValue: (r) => r.name,
              render: (r) => (
                <button type="button" className="vs-link text-button mono" onClick={() => setSelected(r)}>
                  {r.name}
                </button>
              ),
            },
            { key: 'description', header: 'Описание', render: (r) => r.description || '—' },
            { key: 'composite', header: 'Составная', render: (r) => (r.composite ? <Badge tone="info">да</Badge> : '—') },
            {
              key: 'actions',
              header: <span className="vs-visually-hidden">Действия</span>,
              align: 'right',
              render: (r) => (
                <Button size="sm" variant="ghost" onClick={() => setDeleting(r)}>
                  Удалить
                </Button>
              ),
            },
          ]}
        />
      )}
      {creating && <RoleDialog onClose={() => setCreating(false)} />}
      {selected && <RoleDrawer key={selected.id} role={selected} roles={roles.data ?? []} onClose={() => setSelected(null)} />}
      {deleting && (
        <ConfirmDialog title={`Удалить роль ${deleting.name}?`} onClose={() => setDeleting(null)} onConfirm={() => remove.mutate(deleting)} pending={remove.isPending} error={remove.error}>
          <p>Пользователи и группы потеряют эту роль; сервисы, которые её требуют, станут им недоступны.</p>
        </ConfirmDialog>
      )}
    </Card>
  );
}

function RoleDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const create = useMutation({
    mutationFn: () => kc.post('/roles', { name, description }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['kc', 'roles'] });
      onClose();
    },
  });
  return (
    <Dialog
      open
      title="Новая роль"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={() => create.mutate()} disabled={!name.trim()} loading={create.isPending}>
            Создать
          </Button>
        </>
      }
    >
      <div className="stack">
        <Input label="Название" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <Textarea label="Описание" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        <ErrorAlert error={create.error} />
      </div>
    </Dialog>
  );
}

function RoleDrawer({ role, roles, onClose }: { role: KcRole; roles: KcRole[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [description, setDescription] = useState(role.description ?? '');
  const compositesKey = ['kc', 'roles', role.id, 'composites'];
  const composites = useQuery({ queryKey: compositesKey, queryFn: () => kc.get<KcRole[]>(`/roles-by-id/${role.id}/composites`) });
  const users = useQuery({
    queryKey: ['kc', 'roles', role.id, 'users'],
    queryFn: () => kc.get<{ id: string; username: string }[]>(`/roles/${encodeURIComponent(role.name)}/users?max=200`),
  });
  const [wanted, setWanted] = useState<string[] | null>(null);
  const current = composites.data ?? [];
  const selected = wanted ?? current.map((r) => r.id);
  const saveDescription = useMutation({
    mutationFn: () => kc.put(`/roles-by-id/${role.id}`, { ...role, description }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['kc', 'roles'] });
      toast({ tone: 'success', title: 'Сохранено в Keycloak' });
    },
  });
  const saveComposites = useMutation({
    mutationFn: async () => {
      const add = roles.filter((r) => selected.includes(r.id) && !current.some((c) => c.id === r.id));
      const remove = current.filter((c) => !selected.includes(c.id));
      if (add.length) await kc.post(`/roles-by-id/${role.id}/composites`, add);
      if (remove.length) await kc.del(`/roles-by-id/${role.id}/composites`, remove);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['kc', 'roles'] });
      setWanted(null);
    },
  });
  return (
    <Drawer open title={role.name} onClose={onClose} className="wide-drawer">
      <div className="stack">
        <Textarea label="Описание" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        <ErrorAlert error={saveDescription.error} />
        <div className="row">
          <Button variant="primary" onClick={() => saveDescription.mutate()} disabled={description === (role.description ?? '')} loading={saveDescription.isPending}>
            Сохранить
          </Button>
        </div>
        <MultiSelect
          label="Входящие роли (составная роль)"
          searchLabel="Найти роль"
          emptyText="Ролей нет"
          options={roles.filter((r) => r.id !== role.id).map((r) => ({ value: r.id, label: r.name }))}
          value={selected}
          onValueChange={setWanted}
        />
        <ErrorAlert error={saveComposites.error ?? composites.error} />
        <div className="row">
          <Button disabled={wanted === null} loading={saveComposites.isPending} onClick={() => saveComposites.mutate()}>
            Применить состав
          </Button>
        </div>
        <Table
          compact
          caption="Пользователи с этой ролью"
          rows={users.data ?? []}
          rowKey={(u) => u.id}
          emptyText="Никого"
          columns={[{ key: 'username', header: 'Логин', render: (u) => <span className="mono">{u.username}</span> }]}
        />
      </div>
    </Drawer>
  );
}
