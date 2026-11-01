import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AtSign, CalendarDays, Check, Copy, ExternalLink, Fingerprint, Mail } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { api, errorMessage, type Profile, type ProfileUpdate } from '../api';
import { meQueryKey } from '../auth';
import { AvatarEditor } from '../components/AvatarEditor';
import { PageHeader, Skeleton } from '../components/ui';
import { attributeLabel, formatDate } from '../lib/format';

export function ProfilePage() {
  const profile = useQuery({ queryKey: ['profile'], queryFn: api.profile });
  const config = useQuery({ queryKey: ['config'], queryFn: api.config, staleTime: Infinity });
  // Lives here, not in ProfileForm, because the form remounts after a save.
  const [saved, setSaved] = useState(false);

  const header = <PageHeader title="Профиль" description="Как вас видят коллеги и корпоративные сервисы." />;

  if (profile.isPending) {
    return (
      <div className="page">
        {header}
        <div className="profile-grid">
          <Skeleton height={380} />
          <Skeleton height={300} />
        </div>
      </div>
    );
  }
  if (profile.isError) {
    return (
      <div className="page">
        {header}
        <p className="form-error">{errorMessage(profile.error)}</p>
      </div>
    );
  }

  const p = profile.data;
  const fullName = `${p.firstName} ${p.lastName}`.trim() || p.username;
  const readonly = p.attributes.filter((a) => !a.editable);

  return (
    <div className="page">
      {header}
      <div className="profile-grid">
        <aside className="profile-side">
          <section className="card">
            <div className="identity">
              <AvatarEditor url={p.avatarUrl} name={fullName} />
              <h2>{fullName}</h2>
              <p className="muted">@{p.username}</p>
              <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
                <span className={`badge ${p.enabled ? 'badge-ok' : 'badge-danger'}`}>
                  <span className="dot" />
                  {p.enabled ? 'Аккаунт активен' : 'Аккаунт отключён'}
                </span>
              </div>
            </div>
            <ul className="meta">
              <li>
                <Mail size={16} />
                <div className="meta-text">
                  <small>Email</small>
                  <div title={p.email}>{p.email || '—'}</div>
                </div>
                {p.email && (
                  <span className={`badge ${p.emailVerified ? 'badge-ok' : 'badge-warn'}`}>
                    {p.emailVerified ? 'подтверждён' : 'не подтверждён'}
                  </span>
                )}
              </li>
              <li>
                <AtSign size={16} />
                <div className="meta-text">
                  <small>Логин</small>
                  <div>{p.username}</div>
                </div>
              </li>
              {p.createdAt && (
                <li>
                  <CalendarDays size={16} />
                  <div className="meta-text">
                    <small>Создан</small>
                    <div>{formatDate(p.createdAt)}</div>
                  </div>
                </li>
              )}
              <li>
                <Fingerprint size={16} />
                <div className="meta-text">
                  <small>ID в Keycloak</small>
                  <div className="mono" title={p.sub}>
                    {p.sub}
                  </div>
                </div>
                <CopyButton value={p.sub} />
              </li>
            </ul>
          </section>
        </aside>

        <div className="page" style={{ gap: 24 }}>
          <section className="card">
            <div className="card-head">
              <div>
                <h2>Личные данные</h2>
                <p>Изменения сразу применяются во всех сервисах с единым входом.</p>
              </div>
            </div>
            <div className="card-body">
              <ProfileForm
                key={JSON.stringify([p.firstName, p.lastName, p.attributes])}
                profile={p}
                saved={saved}
                onSavedChange={setSaved}
              />
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <div>
                <h2>Организация и доступ</h2>
                <p>Управляется администратором.</p>
              </div>
            </div>
            <div className="card-body">
              <dl className="kv">
                {readonly.map((a) => (
                  <Row key={a.name} label={attributeLabel(a.name)}>
                    {a.value || <span className="muted">—</span>}
                  </Row>
                ))}
                <Row label="Группы">
                  {p.groups.length ? (
                    p.groups.map((g) => (
                      <span key={g} className="badge">
                        {g.replace(/^\//, '')}
                      </span>
                    ))
                  ) : (
                    <span className="muted">—</span>
                  )}
                </Row>
                <Row label="Роли">
                  {p.roles.length ? (
                    p.roles.map((r) => (
                      <span key={r} className="badge badge-accent">
                        {r}
                      </span>
                    ))
                  ) : (
                    <span className="muted">—</span>
                  )}
                </Row>
              </dl>
            </div>
          </section>

          {config.data && (
            <section className="card">
              <div className="card-head">
                <div>
                  <h2>Email и вход</h2>
                  <p>Смена email и пароля выполняется в Keycloak с подтверждением.</p>
                </div>
                <a className="btn" href={config.data.accountConsoleUrl} target="_blank" rel="noopener noreferrer">
                  Открыть
                  <ExternalLink size={14} />
                </a>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="icon-btn"
      aria-label="Скопировать"
      title="Скопировать"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check size={15} /> : <Copy size={15} />}
    </button>
  );
}

interface ProfileFormProps {
  profile: Profile;
  saved: boolean;
  onSavedChange: (saved: boolean) => void;
}

function ProfileForm({ profile, saved, onSavedChange }: ProfileFormProps) {
  const queryClient = useQueryClient();
  const editable = profile.attributes.filter((a) => a.editable);
  const [firstName, setFirstName] = useState(profile.firstName);
  const [lastName, setLastName] = useState(profile.lastName);
  const [attrs, setAttrs] = useState<Record<string, string>>(
    Object.fromEntries(editable.map((a) => [a.name, a.value])),
  );

  const save = useMutation({
    mutationFn: (input: ProfileUpdate) => api.updateProfile(input),
    onSuccess: (data) => {
      queryClient.setQueryData(['profile'], data);
      void queryClient.invalidateQueries({ queryKey: meQueryKey });
      onSavedChange(true);
    },
  });

  const dirty =
    firstName !== profile.firstName ||
    lastName !== profile.lastName ||
    editable.some((a) => (attrs[a.name] ?? '') !== a.value);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    onSavedChange(false);
    save.mutate({ firstName, lastName, attributes: attrs });
  }

  function reset() {
    setFirstName(profile.firstName);
    setLastName(profile.lastName);
    setAttrs(Object.fromEntries(editable.map((a) => [a.name, a.value])));
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <div className="form-row">
        <label className="field">
          <span>Имя</span>
          <input value={firstName} onChange={(e) => setFirstName(e.target.value)} required maxLength={100} />
        </label>
        <label className="field">
          <span>Фамилия</span>
          <input value={lastName} onChange={(e) => setLastName(e.target.value)} required maxLength={100} />
        </label>
      </div>
      {editable.length > 0 && (
        <div className="form-row">
          {editable.map((a) => (
            <label key={a.name} className="field">
              <span>{attributeLabel(a.name)}</span>
              <input
                value={attrs[a.name] ?? ''}
                maxLength={255}
                type={a.name === 'phoneNumber' ? 'tel' : 'text'}
                placeholder={a.name === 'phoneNumber' ? '+7 900 000-00-00' : undefined}
                onChange={(e) => setAttrs({ ...attrs, [a.name]: e.target.value })}
              />
            </label>
          ))}
        </div>
      )}
      {save.isError && (
        <p className="form-error" role="alert">
          {errorMessage(save.error)}
        </p>
      )}
      <div className="form-actions">
        <button className="btn btn-primary" type="submit" disabled={!dirty || save.isPending}>
          {save.isPending ? 'Сохранение…' : 'Сохранить изменения'}
        </button>
        {dirty && (
          <button className="btn btn-ghost" type="button" onClick={reset} disabled={save.isPending}>
            Отменить
          </button>
        )}
        {saved && !dirty && (
          <span className="saved" role="status">
            <Check size={16} />
            Сохранено
          </span>
        )}
      </div>
    </form>
  );
}
