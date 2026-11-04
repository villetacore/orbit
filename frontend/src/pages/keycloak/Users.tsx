import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, Checkbox, Dialog, Divider, Drawer, Input, MultiSelect, PasswordInput, SearchInput, Switch, Table, Tabs, useToast } from '@villetacore/velessoft-ui';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { kc } from '../../api';
import { useMe } from '../../auth';
import { ErrorAlert, Loading } from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import { ConfirmDialog, JsonEditor, RoleMapping, SaveBar, SettingsFields, useRepresentation, type Field, type Rep } from './shared';

interface KcUser extends Rep {
  id: string;
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  enabled: boolean;
  emailVerified?: boolean;
  requiredActions?: string[];
}

const PAGE = 30;

const userFields: Field[] = [
  { key: 'username', label: 'Логин' },
  { key: 'email', label: 'Email' },
  { key: 'firstName', label: 'Имя' },
  { key: 'lastName', label: 'Фамилия' },
  { key: 'enabled', label: 'Учётная запись включена', type: 'bool' },
  { key: 'emailVerified', label: 'Email подтверждён', type: 'bool' },
];

function useDebounced(value: string, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function UsersAdmin() {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim());
  const [creating, setCreating] = useState(false);
  const selected = params.get('user');
  const users = useInfiniteQuery({
    queryKey: ['kc', 'users', q],
    queryFn: ({ pageParam }) => kc.get<KcUser[]>(`/users?first=${pageParam * PAGE}&max=${PAGE}&search=${encodeURIComponent(q)}`),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.length === PAGE ? pages.length : undefined),
  });
  const list = users.data?.pages.flat() ?? [];
  const open = (id: string | null) =>
    setParams((p) => {
      if (id) p.set('user', id);
      else p.delete('user');
      return p;
    });

  return (
    <Card
      flat
      title="Пользователи"
      description="Данные, пароли, роли, группы, сессии и обязательные действия."
      actions={
        <Button size="sm" variant="primary" className="with-icon" onClick={() => setCreating(true)}>
          <Plus size={14} />
          Создать
        </Button>
      }
    >
      <SearchInput label="Поиск" clearLabel="Очистить" value={query} onValueChange={setQuery} placeholder="Логин, имя или email" />
      {users.isPending && <Loading height={240} />}
      <ErrorAlert error={users.error} />
      {users.isSuccess && (
        <Table
          compact
          rows={list}
          rowKey={(u) => u.id}
          emptyText="Никого не нашли"
          columns={[
            { key: 'username', header: 'Логин', sortValue: (u) => u.username, render: (u) => <button type="button" className="vs-link text-button mono" onClick={() => open(u.id)}>{u.username}</button> },
            { key: 'name', header: 'Имя', render: (u) => `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || '—' },
            { key: 'email', header: 'Email', render: (u) => u.email || '—' },
            {
              key: 'state',
              header: 'Состояние',
              render: (u) => (
                <span className="chips">
                  {!u.enabled && <Badge tone="error">Отключён</Badge>}
                  {u.email && u.emailVerified === false && <Badge tone="warning">email не подтверждён</Badge>}
                  {(u.requiredActions?.length ?? 0) > 0 && <Badge tone="info">есть действия</Badge>}
                </span>
              ),
            },
          ]}
        />
      )}
      {users.hasNextPage && (
        <div className="row center">
          <Button size="sm" onClick={() => users.fetchNextPage()} loading={users.isFetchingNextPage}>
            Показать ещё
          </Button>
        </div>
      )}
      {creating && (
        <CreateUserDialog
          onClose={() => setCreating(false)}
        />
      )}
      {selected && <UserDrawer key={selected} id={selected} onClose={() => open(null)} />}
    </Card>
  );
}

function CreateUserDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState({ username: '', email: '', firstName: '', lastName: '' });
  const [password, setPassword] = useState('');
  const [temporary, setTemporary] = useState(true);
  const create = useMutation({
    mutationFn: () =>
      kc.post('/users', {
        ...form,
        enabled: true,
        ...(password ? { credentials: [{ type: 'password', value: password, temporary }] } : {}),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['kc', 'users'] });
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      toast({ tone: 'success', title: 'Пользователь создан' });
      onClose();
    },
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  return (
    <Dialog
      open
      title="Новый пользователь"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" form="create-user" variant="primary" loading={create.isPending}>
            Создать
          </Button>
        </>
      }
    >
      <form
        id="create-user"
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Input label="Логин" value={form.username} onChange={set('username')} required autoComplete="off" autoFocus />
        <Input label="Email" type="email" value={form.email} onChange={set('email')} />
        <div className="form-grid">
          <Input label="Имя" value={form.firstName} onChange={set('firstName')} />
          <Input label="Фамилия" value={form.lastName} onChange={set('lastName')} />
        </div>
        <PasswordInput label="Пароль" showLabel="Показать" hideLabel="Скрыть" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" hint="Можно задать позже." />
        <Checkbox label="Временный: сменить при первом входе" checked={temporary} onChange={(e) => setTemporary(e.target.checked)} />
        <ErrorAlert error={create.error} />
      </form>
    </Dialog>
  );
}

function UserDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const me = useMe();
  const key = ['kc', 'user', id];
  const { value, query, setDraft, dirty, reset, save } = useRepresentation(`/users/${id}`, key);
  const [deleting, setDeleting] = useState(false);
  const remove = useMutation({
    mutationFn: () => kc.del(`/users/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['kc', 'users'] });
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
  });
  const user = value as KcUser | null;

  return (
    <Drawer open title={user?.username ?? 'Пользователь'} onClose={onClose} className="wide-drawer xl-drawer">
      {query.isPending && <Loading height={320} />}
      <ErrorAlert error={query.error} />
      {user && (
        <Tabs
          label="Разделы пользователя"
          items={[
            {
              value: 'data',
              label: 'Данные',
              content: (
                <div className="stack">
                  <SettingsFields fields={userFields} value={user} onChange={setDraft} />
                  <RequiredActions value={user.requiredActions ?? []} onChange={(requiredActions) => setDraft({ ...user, requiredActions })} />
                  <SaveBar dirty={dirty} save={save} onReset={reset} onSave={() => save.mutate(user)} />
                  {user.id !== me.sub && (
                    <>
                      <Divider />
                      <div className="row">
                        <Button variant="danger" className="with-icon" onClick={() => setDeleting(true)}>
                          <Trash2 size={14} />
                          Удалить пользователя
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ),
            },
            { value: 'password', label: 'Пароль', content: <PasswordTab user={user} /> },
            { value: 'roles', label: 'Роли', content: <RoleMapping basePath={`/users/${id}`} /> },
            { value: 'groups', label: 'Группы', content: <GroupsTab id={id} /> },
            { value: 'credentials', label: 'Вход', content: <CredentialsTab id={id} /> },
            { value: 'sessions', label: 'Сессии', content: <SessionsTab id={id} /> },
            { value: 'links', label: 'Связи', content: <LinksTab id={id} /> },
            {
              value: 'json',
              label: 'JSON',
              content: <JsonEditor key={JSON.stringify(query.data)} value={query.data} onSave={(rep) => save.mutate(rep)} saving={save.isPending} error={save.error} />,
            },
          ]}
        />
      )}
      {deleting && user && (
        <ConfirmDialog title={`Удалить ${user.username}?`} onClose={() => setDeleting(false)} onConfirm={() => remove.mutate()} pending={remove.isPending} error={remove.error}>
          <p>Учётная запись и все её сессии будут удалены без возможности восстановления.</p>
        </ConfirmDialog>
      )}
    </Drawer>
  );
}

function RequiredActions({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const actions = useQuery({
    queryKey: ['kc', 'required-actions'],
    queryFn: () => kc.get<{ alias: string; name: string; enabled: boolean }[]>('/authentication/required-actions'),
  });
  return (
    <MultiSelect
      label="Обязательные действия при следующем входе"
      searchLabel="Найти действие"
      emptyText="Нет действий"
      hint="Кроме смены пароля, они выполняются на странице единого входа."
      options={(actions.data ?? []).filter((a) => a.enabled).map((a) => ({ value: a.alias, label: a.name }))}
      value={value}
      onValueChange={onChange}
    />
  );
}

function PasswordTab({ user }: { user: KcUser }) {
  const { toast } = useToast();
  const [password, setPassword] = useState('');
  const [temporary, setTemporary] = useState(true);
  const set = useMutation({
    mutationFn: () => kc.put(`/users/${user.id}/reset-password`, { type: 'password', value: password, temporary }),
    onSuccess: () => {
      setPassword('');
      toast({ tone: 'success', title: 'Пароль задан' });
    },
  });
  const [actions, setActions] = useState<string[]>(['UPDATE_PASSWORD']);
  const email = useMutation({
    mutationFn: () => kc.put(`/users/${user.id}/execute-actions-email`, actions),
    onSuccess: () => toast({ tone: 'success', title: 'Письмо отправлено' }),
  });
  const verify = useMutation({
    mutationFn: () => kc.put(`/users/${user.id}/send-verify-email`),
    onSuccess: () => toast({ tone: 'success', title: 'Письмо отправлено' }),
  });
  const unlock = useMutation({
    mutationFn: () => kc.del(`/attack-detection/brute-force/users/${user.id}`),
    onSuccess: () => toast({ tone: 'success', title: 'Блокировка снята' }),
  });
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    set.mutate();
  };
  return (
    <div className="stack">
      <form className="stack" onSubmit={onSubmit}>
        <PasswordInput label="Новый пароль" showLabel="Показать" hideLabel="Скрыть" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
        <Switch label="Временный: сменить при следующем входе" checked={temporary} onChange={(e) => setTemporary(e.target.checked)} />
        <ErrorAlert error={set.error} />
        <div className="row">
          <Button type="submit" variant="primary" loading={set.isPending}>
            Задать пароль
          </Button>
          <Button onClick={() => unlock.mutate()} loading={unlock.isPending}>
            Снять блокировку за перебор
          </Button>
        </div>
      </form>
      <ErrorAlert error={unlock.error} />
      <Divider label="Письмом" />
      <MultiSelect
        label="Что попросить сделать"
        searchLabel="Найти"
        emptyText="Нет"
        options={[
          { value: 'UPDATE_PASSWORD', label: 'Сменить пароль' },
          { value: 'VERIFY_EMAIL', label: 'Подтвердить email' },
          { value: 'CONFIGURE_TOTP', label: 'Настроить OTP' },
          { value: 'UPDATE_PROFILE', label: 'Обновить профиль' },
        ]}
        value={actions}
        onValueChange={setActions}
      />
      <ErrorAlert error={email.error ?? verify.error} />
      <div className="row">
        <Button onClick={() => email.mutate()} disabled={!user.email || actions.length === 0} loading={email.isPending}>
          Отправить письмо с действиями
        </Button>
        <Button onClick={() => verify.mutate()} disabled={!user.email} loading={verify.isPending}>
          Письмо для подтверждения email
        </Button>
      </div>
    </div>
  );
}

function GroupsTab({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const key = ['kc', 'user', id, 'groups'];
  const all = useQuery({ queryKey: ['kc', 'groups', 'flat'], queryFn: () => loadAllGroups() });
  const mine = useQuery({ queryKey: key, queryFn: () => kc.get<{ id: string; path: string }[]>(`/users/${id}/groups`) });
  const [wanted, setWanted] = useState<string[] | null>(null);
  const current = mine.data?.map((g) => g.id) ?? [];
  const selected = wanted ?? current;
  const save = useMutation({
    mutationFn: async () => {
      for (const g of selected.filter((x) => !current.includes(x))) await kc.put(`/users/${id}/groups/${g}`);
      for (const g of current.filter((x) => !selected.includes(x))) await kc.del(`/users/${id}/groups/${g}`);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: key });
      setWanted(null);
      toast({ tone: 'success', title: 'Группы обновлены' });
    },
  });
  if (all.isPending || mine.isPending) return <Loading height={160} />;
  return (
    <div className="stack">
      <ErrorAlert error={all.error ?? mine.error ?? save.error} />
      <MultiSelect
        label="Группы"
        searchLabel="Найти группу"
        emptyText="Групп нет"
        options={(all.data ?? []).map((g) => ({ value: g.id, label: g.path }))}
        value={selected}
        onValueChange={setWanted}
      />
      <div className="row">
        <Button variant="primary" disabled={wanted === null} loading={save.isPending} onClick={() => save.mutate()}>
          Применить
        </Button>
      </div>
    </div>
  );
}

export interface KcGroup extends Rep {
  id: string;
  name: string;
  path: string;
  subGroupCount?: number;
}

// loadAllGroups walks the tree: lists return only one level.
export async function loadAllGroups(): Promise<KcGroup[]> {
  const out: KcGroup[] = [];
  const walk = async (path: string) => {
    const level = await kc.get<KcGroup[]>(path);
    for (const g of level) {
      out.push(g);
      if ((g.subGroupCount ?? 0) > 0) await walk(`/groups/${g.id}/children?max=500`);
    }
  };
  await walk('/groups?max=500');
  return out;
}

function CredentialsTab({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const key = ['kc', 'user', id, 'credentials'];
  const creds = useQuery({ queryKey: key, queryFn: () => kc.get<{ id: string; type: string; userLabel?: string; createdDate?: number }[]>(`/users/${id}/credentials`) });
  const remove = useMutation({ mutationFn: (c: string) => kc.del(`/users/${id}/credentials/${c}`), onSuccess: () => queryClient.invalidateQueries({ queryKey: key }) });
  if (creds.isPending) return <Loading height={120} />;
  return (
    <div className="stack">
      <ErrorAlert error={creds.error ?? remove.error} />
      <Table
        compact
        rows={creds.data ?? []}
        rowKey={(c) => c.id}
        emptyText="Нет способов входа"
        columns={[
          { key: 'type', header: 'Тип', render: (c) => <span className="mono">{c.type}</span> },
          { key: 'label', header: 'Название', render: (c) => c.userLabel || '—' },
          { key: 'created', header: 'Добавлен', render: (c) => (c.createdDate ? formatDateTime(new Date(c.createdDate).toISOString()) : '—') },
          {
            key: 'actions',
            header: <span className="vs-visually-hidden">Действия</span>,
            align: 'right',
            render: (c) => (
              <Button size="sm" variant="ghost" onClick={() => remove.mutate(c.id)} disabled={remove.isPending}>
                Удалить
              </Button>
            ),
          },
        ]}
      />
    </div>
  );
}

function SessionsTab({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const key = ['kc', 'user', id, 'sessions'];
  const sessions = useQuery({
    queryKey: key,
    queryFn: () => kc.get<{ id: string; ipAddress: string; start: number; lastAccess: number; clients: Record<string, string> }[]>(`/users/${id}/sessions`),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const end = useMutation({ mutationFn: (s: string) => kc.del(`/sessions/${s}`), onSuccess: refresh });
  const all = useMutation({ mutationFn: () => kc.post(`/users/${id}/logout`), onSuccess: refresh });
  if (sessions.isPending) return <Loading height={120} />;
  return (
    <div className="stack">
      <ErrorAlert error={sessions.error ?? end.error ?? all.error} />
      <Table
        compact
        rows={sessions.data ?? []}
        rowKey={(s) => s.id}
        emptyText="Активных сессий нет"
        columns={[
          { key: 'ip', header: 'IP', render: (s) => <span className="mono">{s.ipAddress}</span> },
          { key: 'start', header: 'Начало', render: (s) => formatDateTime(new Date(s.start).toISOString()) },
          { key: 'last', header: 'Активность', render: (s) => formatDateTime(new Date(s.lastAccess).toISOString()) },
          { key: 'clients', header: 'Клиенты', render: (s) => <span className="mono small">{Object.values(s.clients).join(', ')}</span> },
          {
            key: 'actions',
            header: <span className="vs-visually-hidden">Действия</span>,
            align: 'right',
            render: (s) => (
              <Button size="sm" variant="ghost" onClick={() => end.mutate(s.id)} disabled={end.isPending}>
                Завершить
              </Button>
            ),
          },
        ]}
      />
      <div className="row">
        <Button onClick={() => all.mutate()} disabled={!sessions.data?.length} loading={all.isPending}>
          Завершить все сессии
        </Button>
      </div>
    </div>
  );
}

function LinksTab({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const fedKey = ['kc', 'user', id, 'federated'];
  const consentKey = ['kc', 'user', id, 'consents'];
  const federated = useQuery({ queryKey: fedKey, queryFn: () => kc.get<{ identityProvider: string; userName: string }[]>(`/users/${id}/federated-identity`) });
  const consents = useQuery({ queryKey: consentKey, queryFn: () => kc.get<{ clientId: string; grantedClientScopes: string[] }[]>(`/users/${id}/consents`) });
  const unlink = useMutation({ mutationFn: (p: string) => kc.del(`/users/${id}/federated-identity/${p}`), onSuccess: () => queryClient.invalidateQueries({ queryKey: fedKey }) });
  const revoke = useMutation({ mutationFn: (c: string) => kc.del(`/users/${id}/consents/${c}`), onSuccess: () => queryClient.invalidateQueries({ queryKey: consentKey }) });
  return (
    <div className="stack">
      <ErrorAlert error={federated.error ?? consents.error ?? unlink.error ?? revoke.error} />
      <Table
        compact
        caption="Внешние провайдеры"
        rows={federated.data ?? []}
        rowKey={(f) => f.identityProvider}
        emptyText="Связей нет"
        columns={[
          { key: 'provider', header: 'Провайдер', render: (f) => f.identityProvider },
          { key: 'user', header: 'Пользователь', render: (f) => f.userName },
          { key: 'a', header: <span className="vs-visually-hidden">Действия</span>, align: 'right', render: (f) => <Button size="sm" variant="ghost" onClick={() => unlink.mutate(f.identityProvider)}>Отвязать</Button> },
        ]}
      />
      <Table
        compact
        caption="Согласия приложений"
        rows={consents.data ?? []}
        rowKey={(c) => c.clientId}
        emptyText="Согласий нет"
        columns={[
          { key: 'client', header: 'Клиент', render: (c) => <span className="mono">{c.clientId}</span> },
          { key: 'scopes', header: 'Разрешения', render: (c) => c.grantedClientScopes.join(', ') },
          { key: 'a', header: <span className="vs-visually-hidden">Действия</span>, align: 'right', render: (c) => <Button size="sm" variant="ghost" onClick={() => revoke.mutate(c.clientId)}>Отозвать</Button> },
        ]}
      />
    </div>
  );
}
