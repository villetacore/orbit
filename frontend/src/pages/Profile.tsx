import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api, errorMessage, type Profile, type ProfileUpdate } from '../api';
import { meQueryKey } from '../auth';
import { AvatarEditor } from '../components/AvatarEditor';
import { attributeLabel, formatDate } from '../lib/format';

export function ProfilePage() {
  const profile = useQuery({ queryKey: ['profile'], queryFn: api.profile });
  const config = useQuery({ queryKey: ['config'], queryFn: api.config, staleTime: Infinity });
  // Lives here, not in ProfileForm, because the form remounts after a save.
  const [saved, setSaved] = useState(false);

  if (profile.isPending) return <div className="page muted">Загрузка…</div>;
  if (profile.isError) return <div className="page form-error">{errorMessage(profile.error)}</div>;

  const p = profile.data;
  const fullName = `${p.firstName} ${p.lastName}`.trim() || p.username;

  return (
    <div className="page">
      <h1>Профиль</h1>

      <section className="card">
        <h2>Фото</h2>
        <AvatarEditor url={p.avatarUrl} name={fullName} />
      </section>

      <section className="card">
        <h2>Личные данные</h2>
        {/* Remount on save so the form picks up server-normalized values. */}
        <ProfileForm
          key={JSON.stringify([p.firstName, p.lastName, p.attributes])}
          profile={p}
          saved={saved}
          onSavedChange={setSaved}
        />
      </section>

      <section className="card">
        <h2>Учётная запись</h2>
        <dl className="details">
          <dt>Логин</dt>
          <dd>{p.username}</dd>
          <dt>Email</dt>
          <dd>
            {p.email || '—'}{' '}
            {p.email && (
              <span className={`tag ${p.emailVerified ? 'tag-ok' : 'tag-warn'}`}>
                {p.emailVerified ? 'подтверждён' : 'не подтверждён'}
              </span>
            )}
            {config.data && (
              <a className="inline-link" href={config.data.accountConsoleUrl} target="_blank" rel="noopener noreferrer">
                Изменить в Keycloak
              </a>
            )}
          </dd>
          {p.attributes
            .filter((a) => !a.editable)
            .map((a) => (
              <Detail key={a.name} label={attributeLabel(a.name)} value={a.value} />
            ))}
          <dt>Статус</dt>
          <dd>
            <span className={`tag ${p.enabled ? 'tag-ok' : 'tag-warn'}`}>{p.enabled ? 'активна' : 'отключена'}</span>
          </dd>
          {p.createdAt && <Detail label="Создана" value={formatDate(p.createdAt)} />}
          <dt>Группы</dt>
          <dd>{p.groups.length ? p.groups.map((g) => <span key={g} className="tag">{g}</span>) : '—'}</dd>
          <dt>Роли</dt>
          <dd>{p.roles.length ? p.roles.map((r) => <span key={r} className="tag">{r}</span>) : '—'}</dd>
          <dt>ID</dt>
          <dd>
            <code>{p.sub}</code>
          </dd>
        </dl>
        <p className="hint">Эти данные управляются администратором или через Keycloak.</p>
      </section>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value || '—'}</dd>
    </>
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

  return (
    <form className="form" onSubmit={onSubmit}>
      <div className="form-row">
        <label>
          Имя
          <input value={firstName} onChange={(e) => setFirstName(e.target.value)} required maxLength={100} />
        </label>
        <label>
          Фамилия
          <input value={lastName} onChange={(e) => setLastName(e.target.value)} required maxLength={100} />
        </label>
      </div>
      {editable.length > 0 && (
        <div className="form-row">
          {editable.map((a) => (
            <label key={a.name}>
              {attributeLabel(a.name)}
              <input
                value={attrs[a.name] ?? ''}
                maxLength={255}
                type={a.name === 'phoneNumber' ? 'tel' : 'text'}
                onChange={(e) => setAttrs({ ...attrs, [a.name]: e.target.value })}
              />
            </label>
          ))}
        </div>
      )}
      {save.isError && (
        <p className="form-error" role="alert" style={{ whiteSpace: 'pre-line' }}>
          {errorMessage(save.error)}
        </p>
      )}
      <div className="form-actions">
        <button className="btn btn-primary" type="submit" disabled={!dirty || save.isPending}>
          {save.isPending ? 'Сохранение…' : 'Сохранить'}
        </button>
        {saved && !dirty && <span className="ok">Сохранено</span>}
      </div>
    </form>
  );
}
