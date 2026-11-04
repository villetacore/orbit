'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, CopyButton, DescriptionList, Dialog, Input, PageHeader, useToast } from '@villetacore/velessoft-ui';
import { useState, type FormEvent } from 'react';
import { api, type Profile, type ProfileUpdate } from '@/api';
import { meQueryKey } from '@/auth';
import { AvatarEditor } from '@/components/AvatarEditor';
import { ErrorAlert, Loading, ReauthFields } from '@/components/ui';
import { attributeLabel, formatDate } from '@/lib/format';

export default function ProfilePage() {
  const profile = useQuery({ queryKey: ['profile'], queryFn: api.profile });
  const header = <PageHeader title="Профиль" description="Как вас видят коллеги и корпоративные сервисы." />;

  if (profile.isPending) {
    return (
      <div className="page">
        {header}
        <div className="profile-grid">
          <Loading height={380} />
          <Loading height={300} />
        </div>
      </div>
    );
  }
  if (profile.isError) {
    return (
      <div className="page">
        {header}
        <ErrorAlert error={profile.error} />
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
        <Card flat className="identity">
          <AvatarEditor url={p.avatarUrl} name={fullName} />
          <h2>{fullName}</h2>
          <p className="hint mono">@{p.username}</p>
          <Badge tone={p.enabled ? 'success' : 'error'} dot>
            {p.enabled ? 'Аккаунт активен' : 'Аккаунт отключён'}
          </Badge>
          <DescriptionList
            items={[
              { id: 'login', term: 'Логин', description: p.username },
              ...(p.createdAt ? [{ id: 'created', term: 'Создан', description: formatDate(p.createdAt) }] : []),
              {
                id: 'sub',
                term: 'ID в Keycloak',
                description: (
                  <span className="id-row">
                    <span className="mono small">{p.sub}</span>
                    <CopyButton size="sm" value={p.sub} label="Копировать" copiedLabel="Скопировано" errorLabel="Не удалось" />
                  </span>
                ),
              },
            ]}
          />
        </Card>

        <div className="page">
          <Card flat title="Личные данные" description="Изменения сразу применяются во всех сервисах с единым входом.">
            <ProfileForm key={JSON.stringify([p.firstName, p.lastName, p.attributes])} profile={p} />
          </Card>
          <EmailCard profile={p} />
          <Card flat title="Организация и доступ" description="Управляется администратором.">
            <DescriptionList
              items={[
                ...readonly.map((a) => ({ id: a.name, term: attributeLabel(a.name), description: a.value || '—' })),
                {
                  id: 'groups',
                  term: 'Группы',
                  description: p.groups.length ? (
                    <span className="chips">
                      {p.groups.map((g) => (
                        <Badge key={g}>{g.replace(/^\//, '')}</Badge>
                      ))}
                    </span>
                  ) : (
                    '—'
                  ),
                },
                {
                  id: 'roles',
                  term: 'Роли',
                  description: p.roles.length ? (
                    <span className="chips">
                      {p.roles.map((r) => (
                        <Badge key={r} tone="info">
                          {r}
                        </Badge>
                      ))}
                    </span>
                  ) : (
                    '—'
                  ),
                },
              ]}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}

function EmailCard({ profile }: { profile: Profile }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const verify = useMutation({
    mutationFn: api.sendVerifyEmail,
    onSuccess: () => toast({ tone: 'success', title: 'Письмо отправлено', description: profile.email }),
  });
  return (
    <Card
      flat
      title="Email"
      description="Адрес для входа и восстановления доступа."
      actions={
        <Button size="sm" onClick={() => setEditing(true)}>
          Изменить
        </Button>
      }
    >
      <div className="row">
        <strong>{profile.email || 'не указан'}</strong>
        {profile.email && (
          <Badge tone={profile.emailVerified ? 'success' : 'warning'} dot>
            {profile.emailVerified ? 'подтверждён' : 'не подтверждён'}
          </Badge>
        )}
        {profile.email && !profile.emailVerified && (
          <Button size="sm" variant="ghost" onClick={() => verify.mutate()} loading={verify.isPending}>
            Отправить письмо для подтверждения
          </Button>
        )}
      </div>
      <ErrorAlert error={verify.error} />
      {editing && <EmailDialog current={profile.email} onClose={() => setEditing(false)} />}
    </Card>
  );
}

function EmailDialog({ current, onClose }: { current: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const credentials = useQuery({ queryKey: ['account', 'credentials'], queryFn: api.credentials });
  const hasOtp = credentials.data?.credentials.some((c) => c.type === 'otp') ?? false;
  const [email, setEmail] = useState(current);
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const change = useMutation({
    mutationFn: () => api.changeEmail({ email, currentPassword: password, otp }),
    onSuccess: ({ verification }) => {
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
      void queryClient.invalidateQueries({ queryKey: meQueryKey });
      if (verification === 'sent') toast({ tone: 'success', title: 'Email изменён', description: 'Подтвердите адрес по ссылке из письма.' });
      else if (verification === 'failed') toast({ tone: 'warning', title: 'Email изменён', description: 'Письмо для подтверждения отправить не удалось.' });
      onClose();
    },
  });
  return (
    <Dialog
      open
      title="Новый email"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" form="email-form" variant="primary" loading={change.isPending}>
            Сохранить
          </Button>
        </>
      }
    >
      <form
        id="email-form"
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          change.mutate();
        }}
      >
        <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required autoFocus />
        <Alert tone="info">Новый адрес нужно будет подтвердить по ссылке из письма.</Alert>
        <ReauthFields password={password} otp={otp} onPassword={setPassword} onOtp={setOtp} hasOtp={hasOtp} />
        <ErrorAlert error={change.error} />
      </form>
    </Dialog>
  );
}

function ProfileForm({ profile }: { profile: Profile }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const editable = profile.attributes.filter((a) => a.editable);
  const [firstName, setFirstName] = useState(profile.firstName);
  const [lastName, setLastName] = useState(profile.lastName);
  const [attrs, setAttrs] = useState<Record<string, string>>(Object.fromEntries(editable.map((a) => [a.name, a.value])));

  const save = useMutation({
    mutationFn: (input: ProfileUpdate) => api.updateProfile(input),
    onSuccess: (data) => {
      queryClient.setQueryData(['profile'], data);
      void queryClient.invalidateQueries({ queryKey: meQueryKey });
      toast({ tone: 'success', title: 'Сохранено' });
    },
  });

  const dirty =
    firstName !== profile.firstName || lastName !== profile.lastName || editable.some((a) => (attrs[a.name] ?? '') !== a.value);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate({ firstName, lastName, attributes: attrs });
  }

  function reset() {
    setFirstName(profile.firstName);
    setLastName(profile.lastName);
    setAttrs(Object.fromEntries(editable.map((a) => [a.name, a.value])));
  }

  return (
    <form className="stack" onSubmit={onSubmit}>
      <div className="form-grid">
        <Input label="Имя" value={firstName} onChange={(e) => setFirstName(e.target.value)} required maxLength={100} />
        <Input label="Фамилия" value={lastName} onChange={(e) => setLastName(e.target.value)} required maxLength={100} />
        {editable.map((a) => (
          <Input
            key={a.name}
            label={attributeLabel(a.name)}
            value={attrs[a.name] ?? ''}
            maxLength={255}
            type={a.name === 'phoneNumber' ? 'tel' : 'text'}
            placeholder={a.name === 'phoneNumber' ? '+7 900 000-00-00' : undefined}
            onChange={(e) => setAttrs({ ...attrs, [a.name]: e.target.value })}
          />
        ))}
      </div>
      <ErrorAlert error={save.error} />
      <div className="row">
        <Button type="submit" variant="primary" disabled={!dirty} loading={save.isPending}>
          Сохранить изменения
        </Button>
        {dirty && (
          <Button variant="ghost" onClick={reset} disabled={save.isPending}>
            Отменить
          </Button>
        )}
      </div>
    </form>
  );
}
