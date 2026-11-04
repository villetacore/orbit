import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  DescriptionList,
  Divider,
  Drawer,
  EmptyState,
  Grid,
  Input,
  PageHeader,
  SearchInput,
  ToggleGroup,
  useToast,
} from '@villetacore/velessoft-ui';
import { KeyRound, LogOut, Mail, UserRoundX, Users } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { api, type DirectoryUser, type EmailAction, type UserDetail } from '../api';
import { useMe } from '../auth';
import { Avatar } from '../components/Avatar';
import { ErrorAlert, LinkButton, Loading } from '../components/ui';
import { attributeLabel, formatDate } from '../lib/format';
import { credentialTitle, SessionRow } from './Security';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function People() {
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const q = useDebounced(query.trim(), 300);
  const selected = params.get('user');

  useEffect(() => {
    setParams(
      (p) => {
        if (q) p.set('q', q);
        else p.delete('q');
        return p;
      },
      { replace: true },
    );
  }, [q, setParams]);

  const users = useInfiniteQuery({
    queryKey: ['users', q],
    queryFn: ({ pageParam }) => api.users(q, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.hasMore ? pages.length : undefined),
  });
  const list = users.data?.pages.flatMap((p) => p.users) ?? [];

  const open = (sub: string) =>
    setParams((p) => {
      p.set('user', sub);
      return p;
    });
  const close = useCallback(
    () =>
      setParams((p) => {
        p.delete('user');
        return p;
      }),
    [setParams],
  );

  return (
    <div className="page">
      <PageHeader
        title="Люди"
        description={
          me.isAdmin
            ? 'Все учётные записи realm. Откройте карточку, чтобы изменить данные, отключить аккаунт или завершить сессии.'
            : 'Коллеги из корпоративного каталога: контакты, подразделения и группы.'
        }
      />
      <SearchInput label="Поиск" clearLabel="Очистить" value={query} onValueChange={setQuery} placeholder="Имя, логин или email" autoFocus />

      {users.isPending && (
        <Grid min={280}>
          <Loading height={96} count={6} />
        </Grid>
      )}
      <ErrorAlert error={users.error} />
      {users.isSuccess && list.length === 0 && (
        <EmptyState
          icon={<Users size={20} />}
          title={q ? 'Никого не нашли' : 'Каталог пуст'}
          description={q ? `По запросу «${q}» нет пользователей.` : undefined}
          actions={q ? <Button onClick={() => setQuery('')}>Сбросить поиск</Button> : undefined}
        />
      )}
      {list.length > 0 && (
        <Grid min={280}>
          {list.map((u) => (
            <PersonCard key={u.sub} user={u} onOpen={() => open(u.sub)} />
          ))}
        </Grid>
      )}
      {users.hasNextPage && (
        <div className="row center">
          <Button onClick={() => users.fetchNextPage()} loading={users.isFetchingNextPage}>
            Показать ещё
          </Button>
        </div>
      )}
      {selected && <PersonDrawer sub={selected} onClose={close} />}
    </div>
  );
}

function PersonCard({ user: u, onOpen }: { user: DirectoryUser; onOpen: () => void }) {
  const dept = u.attributes.find((a) => a.name === 'department')?.value;
  const job = u.attributes.find((a) => a.name === 'jobTitle')?.value;
  return (
    <button type="button" className={`person-card${u.enabled ? '' : ' person-off'}`} onClick={onOpen}>
      <Avatar url={u.avatarUrl} name={u.name} size={48} />
      <span className="row-text">
        <strong>{u.name}</strong>
        <small>{[job, dept].filter(Boolean).join(' · ') || u.email || u.username}</small>
        <small className="mono">@{u.username}</small>
      </span>
      {!u.enabled && <Badge tone="error">Отключён</Badge>}
    </button>
  );
}

function PersonDrawer({ sub, onClose }: { sub: string; onClose: () => void }) {
  const me = useMe();
  const user = useQuery({ queryKey: ['user', sub], queryFn: () => api.user(sub) });
  return (
    <Drawer open title={user.data?.name ?? 'Пользователь'} onClose={onClose} className="wide-drawer">
      {user.isPending && <Loading height={240} />}
      <ErrorAlert error={user.error} />
      {user.isSuccess && <PersonDetail user={user.data} admin={me.isAdmin} />}
    </Drawer>
  );
}

function PersonDetail({ user: u, admin }: { user: UserDetail; admin: boolean }) {
  return (
    <div className="stack">
      <div className="person-hero">
        <Avatar url={u.avatarUrl} name={u.name} size={72} />
        <div>
          <p className="mono hint">@{u.username}</p>
          <div className="chips">
            {u.self && <Badge tone="info">Это вы</Badge>}
            {!u.enabled && <Badge tone="error">Отключён</Badge>}
            {admin && u.emailVerified === false && <Badge tone="warning">email не подтверждён</Badge>}
          </div>
        </div>
      </div>
      <DescriptionList
        items={[
          ...(u.email ? [{ id: 'email', term: 'Email', description: <a className="vs-link" href={`mailto:${u.email}`}>{u.email}</a> }] : []),
          ...u.attributes.map((a) => ({ id: a.name, term: attributeLabel(a.name), description: a.value })),
          ...(u.groups.length
            ? [{ id: 'groups', term: 'Группы', description: <span className="chips">{u.groups.map((g) => <Badge key={g}>{g}</Badge>)}</span> }]
            : []),
          ...(admin && u.roles?.length
            ? [{ id: 'roles', term: 'Роли', description: <span className="chips">{u.roles.map((r) => <Badge key={r} tone="info">{r}</Badge>)}</span> }]
            : []),
          ...(admin && u.createdAt ? [{ id: 'created', term: 'Создан', description: formatDate(u.createdAt) }] : []),
        ]}
      />
      {admin && <AdminControls user={u} />}
    </div>
  );
}

const emailActionOptions: { value: EmailAction; label: string }[] = [
  { value: 'UPDATE_PASSWORD', label: 'Сменить пароль' },
  { value: 'VERIFY_EMAIL', label: 'Подтвердить email' },
  { value: 'CONFIGURE_TOTP', label: 'Настроить OTP' },
];

function AdminControls({ user: u }: { user: UserDetail }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const sync = (d?: UserDetail) => {
    if (d) queryClient.setQueryData(['user', u.sub], d);
    else void queryClient.invalidateQueries({ queryKey: ['user', u.sub] });
    void queryClient.invalidateQueries({ queryKey: ['users'] });
  };

  const [form, setForm] = useState({
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    attributes: Object.fromEntries(
      (u.attributeNames ?? u.attributes.map((a) => a.name)).map((name) => [name, u.attributes.find((a) => a.name === name)?.value ?? '']),
    ),
  });
  const sessions = u.sessions ?? [];
  const credentials = u.credentials ?? [];
  const save = useMutation({
    mutationFn: () => api.admin.updateUser(u.sub, form),
    onSuccess: (d) => {
      sync(d);
      toast({ tone: 'success', title: 'Сохранено' });
    },
  });
  const toggle = useMutation({ mutationFn: () => api.admin.updateUser(u.sub, { enabled: !u.enabled }), onSuccess: sync });
  const logout = useMutation({ mutationFn: () => api.admin.logoutUser(u.sub), onSuccess: () => sync() });
  const [actions, setActions] = useState<string[]>(['UPDATE_PASSWORD']);
  const email = useMutation({
    mutationFn: () => api.admin.actionsEmail(u.sub, actions as EmailAction[]),
    onSuccess: () => toast({ tone: 'success', title: 'Письмо отправлено' }),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <>
      <LinkButton to={`/keycloak/users?user=${encodeURIComponent(u.sub)}`}>
        <KeyRound size={16} />
        Роли, группы, пароль и всё остальное в Keycloak
      </LinkButton>
      <Divider label="Данные" />
      <form className="stack" onSubmit={submit}>
        <div className="form-grid">
          <Input label="Имя" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required />
          <Input label="Фамилия" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} required />
        </div>
        <Input
          label="Email"
          hint="Новый адрес нужно будет подтвердить заново."
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
        {Object.keys(form.attributes).map((name) => (
          <Input
            key={name}
            label={attributeLabel(name)}
            value={form.attributes[name]}
            onChange={(e) => setForm({ ...form, attributes: { ...form.attributes, [name]: e.target.value } })}
          />
        ))}
        <ErrorAlert error={save.error} />
        <div className="row">
          <Button type="submit" variant="primary" loading={save.isPending}>
            Сохранить
          </Button>
        </div>
      </form>

      <Divider label="Письмо с действиями" />
      <ToggleGroup label="Действия" options={emailActionOptions} value={actions} onValueChange={setActions} />
      <div className="row">
        <Button
          className="with-icon"
          onClick={() => email.mutate()}
          disabled={!u.email || actions.length === 0}
          loading={email.isPending}
        >
          <Mail size={16} />
          Отправить письмо
        </Button>
      </div>
      {!u.email && <p className="hint">У пользователя не указан email.</p>}
      <ErrorAlert error={email.error} />

      <Divider label="Способы входа" />
      {credentials.length === 0 ? (
        <p className="hint">Нет ни одного способа входа.</p>
      ) : (
        <div className="chips">
          {credentials.map((c) => (
            <Badge key={c.id}>{c.label ? `${credentialTitle(c).title}: ${c.label}` : credentialTitle(c).title}</Badge>
          ))}
        </div>
      )}

      <Divider label={`Сессии · ${sessions.length}`} />
      {sessions.length === 0 ? (
        <p className="hint">Активных сессий нет.</p>
      ) : (
        <Card flat className="list-card">
          <ul className="rows">
            {sessions.map((s) => (
              <SessionRow key={s.id} session={s} />
            ))}
          </ul>
        </Card>
      )}
      <div className="row">
        <Button className="with-icon" onClick={() => logout.mutate()} disabled={sessions.length === 0} loading={logout.isPending}>
          <LogOut size={16} />
          Завершить все сессии
        </Button>
      </div>
      <ErrorAlert error={logout.error} />

      {!u.self && (
        <>
          <Divider label="Доступ" />
          <p className="hint">
            {u.enabled
              ? 'Отключённый пользователь не сможет войти ни в один сервис; его открытые сессии будут завершены.'
              : 'Учётная запись отключена: вход во все сервисы запрещён.'}
          </p>
          <div className="row">
            <Button variant={u.enabled ? 'danger' : 'primary'} className="with-icon" onClick={() => toggle.mutate()} loading={toggle.isPending}>
              <UserRoundX size={16} />
              {u.enabled ? 'Отключить учётную запись' : 'Включить учётную запись'}
            </Button>
          </div>
          <ErrorAlert error={toggle.error} />
        </>
      )}
    </>
  );
}
