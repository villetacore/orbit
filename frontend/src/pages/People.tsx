import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, LogOut, Mail, Search, UserRoundX, Users } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { api, errorMessage, type DirectoryUser, type EmailAction, type UserDetail } from '../api';
import { useMe } from '../auth';
import { Avatar } from '../components/Avatar';
import { Drawer, EmptyState, PageHeader, Skeleton } from '../components/ui';
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

  const open = (sub: string | null) =>
    setParams((p) => {
      if (sub) p.set('user', sub);
      else p.delete('user');
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
      <div className="toolbar">
        <label className="input-icon">
          <Search size={18} />
          <span className="sr-only">Поиск</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Имя, логин или email"
            autoFocus
          />
        </label>
      </div>

      {users.isPending && (
        <div className="people">
          <Skeleton height={96} count={6} />
        </div>
      )}
      {users.isError && <p className="form-error">{errorMessage(users.error)}</p>}
      {users.isSuccess && list.length === 0 && (
        <EmptyState
          icon={Users}
          title={q ? 'Никого не нашли' : 'Каталог пуст'}
          text={q ? `По запросу «${q}» нет пользователей.` : undefined}
          action={
            q && (
              <button className="btn" onClick={() => setQuery('')}>
                Сбросить поиск
              </button>
            )
          }
        />
      )}
      {list.length > 0 && (
        <div className="people">
          {list.map((u) => (
            <PersonCard key={u.sub} user={u} onOpen={() => open(u.sub)} />
          ))}
        </div>
      )}
      {users.hasNextPage && (
        <button
          className="btn"
          style={{ alignSelf: 'center' }}
          onClick={() => users.fetchNextPage()}
          disabled={users.isFetchingNextPage}
          aria-busy={users.isFetchingNextPage}
        >
          Показать ещё
        </button>
      )}
      {selected && <PersonDrawer sub={selected} onClose={close} />}
    </div>
  );
}

function PersonCard({ user: u, onOpen }: { user: DirectoryUser; onOpen: () => void }) {
  const dept = u.attributes.find((a) => a.name === 'department')?.value;
  const job = u.attributes.find((a) => a.name === 'jobTitle')?.value;
  return (
    <button className={`card person${u.enabled ? '' : ' person-off'}`} onClick={onOpen}>
      <Avatar url={u.avatarUrl} name={u.name} size={52} />
      <span className="person-text">
        <strong>{u.name}</strong>
        <small>{[job, dept].filter(Boolean).join(' · ') || u.email || u.username}</small>
        <span className="mono person-login">@{u.username}</span>
      </span>
      {!u.enabled && <span className="badge badge-danger">Отключён</span>}
    </button>
  );
}

function PersonDrawer({ sub, onClose }: { sub: string; onClose: () => void }) {
  const me = useMe();
  const user = useQuery({ queryKey: ['user', sub], queryFn: () => api.user(sub) });
  return (
    <Drawer title={user.data?.name ?? 'Пользователь'} onClose={onClose}>
      {user.isPending && <Skeleton height={240} />}
      {user.isError && <p className="form-error">{errorMessage(user.error)}</p>}
      {user.isSuccess && <PersonDetail user={user.data} admin={me.isAdmin} />}
    </Drawer>
  );
}

function PersonDetail({ user: u, admin }: { user: UserDetail; admin: boolean }) {
  return (
    <div className="person-detail">
      <div className="person-hero">
        <Avatar url={u.avatarUrl} name={u.name} size={88} />
        <div>
          <h3>{u.name}</h3>
          <p className="mono muted">@{u.username}</p>
          <div className="chips" style={{ marginTop: 8 }}>
            {u.self && <span className="badge badge-accent">Это вы</span>}
            {!u.enabled && <span className="badge badge-danger">Отключён</span>}
            {admin && u.emailVerified === false && <span className="badge badge-warn">email не подтверждён</span>}
          </div>
        </div>
      </div>
      <dl className="kv">
        {u.email && (
          <>
            <dt>Email</dt>
            <dd>
              <a href={`mailto:${u.email}`}>{u.email}</a>
            </dd>
          </>
        )}
        {u.attributes.map((a) => (
          <div key={a.name} style={{ display: 'contents' }}>
            <dt>{attributeLabel(a.name)}</dt>
            <dd>{a.value}</dd>
          </div>
        ))}
        {u.groups.length > 0 && (
          <>
            <dt>Группы</dt>
            <dd>
              {u.groups.map((g) => (
                <span key={g} className="badge mono">
                  {g}
                </span>
              ))}
            </dd>
          </>
        )}
        {admin && u.roles && u.roles.length > 0 && (
          <>
            <dt>Роли</dt>
            <dd>
              {u.roles.map((r) => (
                <span key={r} className="badge badge-accent mono">
                  {r}
                </span>
              ))}
            </dd>
          </>
        )}
        {admin && u.createdAt && (
          <>
            <dt>Создан</dt>
            <dd>{formatDate(u.createdAt)}</dd>
          </>
        )}
      </dl>
      {admin && <AdminControls user={u} />}
    </div>
  );
}

const emailActionLabels: Record<EmailAction, string> = {
  UPDATE_PASSWORD: 'Сменить пароль',
  VERIFY_EMAIL: 'Подтвердить email',
  CONFIGURE_TOTP: 'Настроить OTP',
};

function AdminControls({ user: u }: { user: UserDetail }) {
  const queryClient = useQueryClient();
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
      (u.attributeNames ?? u.attributes.map((a) => a.name)).map((name) => [
        name,
        u.attributes.find((a) => a.name === name)?.value ?? '',
      ]),
    ),
  });
  const sessions = u.sessions ?? [];
  const credentials = u.credentials ?? [];
  const save = useMutation({ mutationFn: () => api.admin.updateUser(u.sub, form), onSuccess: sync });
  const toggle = useMutation({
    mutationFn: () => api.admin.updateUser(u.sub, { enabled: !u.enabled }),
    onSuccess: sync,
  });
  const logout = useMutation({ mutationFn: () => api.admin.logoutUser(u.sub), onSuccess: () => sync() });
  const [actions, setActions] = useState<EmailAction[]>(['UPDATE_PASSWORD']);
  const email = useMutation({ mutationFn: () => api.admin.actionsEmail(u.sub, actions) });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <>
      <section className="drawer-section">
        <div className="eyebrow">Данные в Keycloak</div>
        <form className="form" onSubmit={submit}>
          <div className="form-row">
            <label className="field">
              <span>Имя</span>
              <input
                value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                required
              />
            </label>
            <label className="field">
              <span>Фамилия</span>
              <input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} required />
            </label>
          </div>
          <label className="field">
            <span>Email</span>
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <span className="field-hint">Новый адрес нужно будет подтвердить заново.</span>
          </label>
          {Object.keys(form.attributes).map((name) => (
            <label key={name} className="field">
              <span>{attributeLabel(name)}</span>
              <input
                value={form.attributes[name]}
                onChange={(e) => setForm({ ...form, attributes: { ...form.attributes, [name]: e.target.value } })}
              />
            </label>
          ))}
          {save.isError && <p className="form-error">{errorMessage(save.error)}</p>}
          <div className="form-actions">
            <button className="btn btn-primary" disabled={save.isPending} aria-busy={save.isPending}>
              Сохранить
            </button>
            {save.isSuccess && (
              <span className="saved">
                <CheckCircle2 size={16} /> Сохранено
              </span>
            )}
          </div>
        </form>
      </section>

      <section className="drawer-section">
        <div className="eyebrow">Письмо с действиями</div>
        <div className="chips">
          {(Object.keys(emailActionLabels) as EmailAction[]).map((a) => {
            const on = actions.includes(a);
            return (
              <button
                key={a}
                type="button"
                className={`chip${on ? ' chip-on' : ''}`}
                aria-pressed={on}
                onClick={() => setActions(on ? actions.filter((x) => x !== a) : [...actions, a])}
              >
                {emailActionLabels[a]}
              </button>
            );
          })}
        </div>
        <div className="form-actions">
          <button
            className="btn"
            onClick={() => email.mutate()}
            disabled={!u.email || actions.length === 0 || email.isPending}
            aria-busy={email.isPending}
          >
            <Mail size={16} />
            Отправить письмо
          </button>
          {email.isSuccess && (
            <span className="saved">
              <CheckCircle2 size={16} /> Отправлено
            </span>
          )}
        </div>
        {!u.email && <p className="field-hint">У пользователя не указан email.</p>}
        {email.isError && <p className="form-error">{errorMessage(email.error)}</p>}
      </section>

      <section className="drawer-section">
        <div className="eyebrow">Способы входа</div>
        {credentials.length === 0 ? (
          <p className="muted">Нет ни одного способа входа.</p>
        ) : (
          <div className="chips">
            {credentials.map((c) => (
              <span key={c.id} className="badge">
                {c.label ? `${credentialTitle(c).title}: ${c.label}` : credentialTitle(c).title}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="drawer-section">
        <div className="eyebrow">Сессии · {sessions.length}</div>
        {sessions.length === 0 ? (
          <p className="muted">Активных сессий нет.</p>
        ) : (
          <ul className="card rows">
            {sessions.map((s) => (
              <SessionRow key={s.id} session={s} />
            ))}
          </ul>
        )}
        <div className="form-actions">
          <button
            className="btn"
            onClick={() => logout.mutate()}
            disabled={sessions.length === 0 || logout.isPending}
            aria-busy={logout.isPending}
          >
            <LogOut size={16} />
            Завершить все сессии
          </button>
        </div>
        {logout.isError && <p className="form-error">{errorMessage(logout.error)}</p>}
      </section>

      {!u.self && (
        <section className="drawer-section">
          <div className="eyebrow">Доступ</div>
          <p className="muted">
            {u.enabled
              ? 'Отключённый пользователь не сможет войти ни в один сервис; его открытые сессии будут завершены.'
              : 'Учётная запись отключена: вход во все сервисы запрещён.'}
          </p>
          <div className="form-actions">
            <button
              className={u.enabled ? 'btn btn-danger-solid' : 'btn btn-primary'}
              onClick={() => toggle.mutate()}
              disabled={toggle.isPending}
              aria-busy={toggle.isPending}
            >
              <UserRoundX size={16} />
              {u.enabled ? 'Отключить учётную запись' : 'Включить учётную запись'}
            </button>
          </div>
          {toggle.isError && <p className="form-error">{errorMessage(toggle.error)}</p>}
        </section>
      )}
    </>
  );
}
