import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  CodeBlock,
  Dialog,
  EmptyState,
  Input,
  PageHeader,
  PasswordInput,
  useToast,
} from '@villetacore/velessoft-ui';
import { Fingerprint, KeyRound, Link2, LogOut, MonitorSmartphone, Plus, ShieldQuestion, Smartphone, Trash2, type LucideIcon } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { api, type AccountSession, type Credential, type LinkedAccount } from '../api';
import { ErrorAlert, Loading, ReauthFields } from '../components/ui';
import { formatDate, formatDateTime, formatRelative, plural } from '../lib/format';

// Labels for Keycloak credential types.
export const credentialInfo: Record<string, { title: string; icon: LucideIcon }> = {
  password: { title: 'Пароль', icon: KeyRound },
  otp: { title: 'Приложение-аутентификатор', icon: Smartphone },
  webauthn: { title: 'Ключ безопасности', icon: Fingerprint },
  'webauthn-passwordless': { title: 'Passkey', icon: Fingerprint },
};

export function credentialTitle(c: Credential) {
  return credentialInfo[c.type] ?? { title: c.type, icon: ShieldQuestion };
}

const statusInfo: Record<string, { text: string; ok: boolean }> = {
  success: { text: 'Изменения сохранены.', ok: true },
  cancelled: { text: 'Действие отменено — ничего не изменилось.', ok: false },
  error: { text: 'Не удалось выполнить действие. Попробуйте ещё раз.', ok: false },
};

const credentialsKey = ['account', 'credentials'] as const;

function useHasOtp() {
  const credentials = useQuery({ queryKey: credentialsKey, queryFn: api.credentials });
  return credentials.data?.credentials.some((c) => c.type === 'otp') ?? false;
}

export function Security() {
  const [params] = useSearchParams();
  const status = statusInfo[params.get('kc_action_status') ?? ''];

  return (
    <div className="page">
      <PageHeader title="Безопасность" description="Пароль, способы входа, устройства и подключённые приложения вашей учётной записи." />
      {status && <Alert tone={status.ok ? 'success' : 'warning'}>{status.text}</Alert>}
      <div className="settings-columns">
        <PasswordCard />
        <Credentials />
      </div>
      <Sessions />
      <div className="settings-columns">
        <LinkedAccounts />
        <Applications />
      </div>
      <LoginHistory />
    </div>
  );
}

function PasswordCard() {
  const { toast } = useToast();
  const hasOtp = useHasOtp();
  const [current, setCurrent] = useState('');
  const [otp, setOtp] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [logoutOthers, setLogoutOthers] = useState(false);
  const queryClient = useQueryClient();
  const change = useMutation({
    mutationFn: () => api.changePassword({ currentPassword: current, otp, newPassword: next, logoutOthers }),
    onSuccess: ({ endedSessions }) => {
      setCurrent('');
      setOtp('');
      setNext('');
      setRepeat('');
      toast({
        tone: 'success',
        title: 'Пароль изменён',
        description: endedSessions > 0 ? `Завершено других сессий: ${endedSessions}` : undefined,
      });
      void queryClient.invalidateQueries({ queryKey: ['account'] });
    },
  });
  const mismatch = repeat !== '' && repeat !== next;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!mismatch) change.mutate();
  }

  return (
    <Card flat title="Пароль" description="Требования к паролю задаёт политика realm.">
      <form className="stack" onSubmit={onSubmit}>
        <ReauthFields password={current} otp={otp} onPassword={setCurrent} onOtp={setOtp} hasOtp={hasOtp} />
        <PasswordInput
          label="Новый пароль"
          showLabel="Показать"
          hideLabel="Скрыть"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          required
        />
        <PasswordInput
          label="Повторите новый пароль"
          showLabel="Показать"
          hideLabel="Скрыть"
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
          autoComplete="new-password"
          error={mismatch ? 'Пароли не совпадают' : undefined}
          required
        />
        <Checkbox label="Завершить сеансы на других устройствах" checked={logoutOthers} onChange={(e) => setLogoutOthers(e.target.checked)} />
        <ErrorAlert error={change.error} />
        <div className="row">
          <Button type="submit" variant="primary" loading={change.isPending} disabled={mismatch}>
            Сменить пароль
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Credentials() {
  const credentials = useQuery({ queryKey: credentialsKey, queryFn: api.credentials });
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Credential | null>(null);
  const list = credentials.data?.credentials ?? [];
  const hasOtp = list.some((c) => c.type === 'otp');

  return (
    <Card
      flat
      title="Способы входа"
      description="Пароль и второй фактор."
      actions={
        <div className="row">
          <Button size="sm" className="with-icon" onClick={() => setAdding(true)}>
            <Smartphone size={14} />
            Настроить OTP
          </Button>
        </div>
      }
    >
      {credentials.isPending && <Loading height={120} />}
      <ErrorAlert error={credentials.error} />
      {credentials.isSuccess && (
        <ul className="rows">
          {list.map((c) => {
            const { title, icon: Icon } = credentialTitle(c);
            return (
              <li key={c.id}>
                <Icon size={18} />
                <span className="row-text">
                  <strong>{c.label || title}</strong>
                  <small>
                    {c.label ? `${title} · ` : ''}
                    {c.createdAt ? `добавлен ${formatDate(c.createdAt)}` : 'дата неизвестна'}
                  </small>
                </span>
                {c.removable && (
                  <Button size="sm" variant="danger" className="with-icon" onClick={() => setRemoving(c)}>
                    <Trash2 size={14} />
                    Удалить
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {credentials.isSuccess && !list.some((c) => c.type !== 'password') && (
        <Alert tone="warning">Второй фактор не настроен. Добавьте OTP или passkey — это защитит вход, даже если пароль утечёт.</Alert>
      )}
      <p className="hint">
        Passkey привязан к домену Keycloak, поэтому его добавление — единственный шаг, который открывает страницу единого
        входа. <a className="vs-link" href="/auth/action/webauthn-register-passwordless">Добавить passkey</a>
        {' · '}
        <a className="vs-link" href="/auth/action/webauthn-register">Добавить ключ безопасности</a>
      </p>
      {adding && <TOTPDialog hasOtp={hasOtp} onClose={() => setAdding(false)} />}
      {removing && <DeleteCredentialDialog credential={removing} hasOtp={hasOtp} onClose={() => setRemoving(null)} />}
    </Card>
  );
}

// TOTPDialog enrolls an authenticator app without leaving Orbit.
function TOTPDialog({ hasOtp, onClose }: { hasOtp: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const setup = useQuery({ queryKey: ['account', 'totp-setup'], queryFn: api.totpSetup, gcTime: 0, staleTime: Infinity, retry: false });
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const confirm = useMutation({
    mutationFn: () => api.totpConfirm({ setupToken: setup.data!.setupToken, code, label, currentPassword: password, otp }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: credentialsKey });
      toast({ tone: 'success', title: 'Приложение-аутентификатор подключено', description: 'При следующем входе понадобится код.' });
      onClose();
    },
  });

  return (
    <Dialog
      open
      title="Настройка OTP"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" form="totp-form" variant="primary" loading={confirm.isPending} disabled={!setup.isSuccess}>
            Подключить
          </Button>
        </>
      }
    >
      {setup.isPending && <Loading height={260} />}
      <ErrorAlert error={setup.error} />
      {setup.isSuccess && (
        <form
          id="totp-form"
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            confirm.mutate();
          }}
        >
          <p className="hint">Отсканируйте QR-код в Google Authenticator, FreeOTP, Яндекс Ключе или аналогичном приложении.</p>
          <img className="totp-qr" src={setup.data.qrImage} alt="QR-код для приложения-аутентификатора" />
          <CodeBlock code={setup.data.secret} label="Ключ для ручного ввода" copyLabel="Копировать" copiedLabel="Скопировано" errorLabel="Не удалось" />
          <p className="hint">
            {setup.data.digits} цифр · {setup.data.period} секунд · {setup.data.algorithm}
          </p>
          <Input
            label="Код из приложения"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            required
          />
          <Input label="Название устройства" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={64} placeholder="Рабочий телефон" />
          <ReauthFields password={password} otp={otp} onPassword={setPassword} onOtp={setOtp} hasOtp={hasOtp} />
          <ErrorAlert error={confirm.error} />
        </form>
      )}
    </Dialog>
  );
}

function DeleteCredentialDialog({ credential, hasOtp, onClose }: { credential: Credential; hasOtp: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const remove = useMutation({
    mutationFn: () => api.deleteCredential(credential.id, { currentPassword: password, otp }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: credentialsKey });
      toast({ tone: 'success', title: 'Способ входа удалён' });
      onClose();
    },
  });
  const title = credential.label || credentialTitle(credential).title;
  return (
    <Dialog
      open
      title={`Удалить «${title}»?`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" form="delete-credential" variant="danger" loading={remove.isPending}>
            Удалить
          </Button>
        </>
      }
    >
      <form
        id="delete-credential"
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          remove.mutate();
        }}
      >
        <p>Войти с этим способом будет нельзя. Подтвердите действие.</p>
        <ReauthFields password={password} otp={otp} onPassword={setPassword} onOtp={setOtp} hasOtp={hasOtp} />
        <ErrorAlert error={remove.error} />
      </form>
    </Dialog>
  );
}

function Sessions() {
  const queryClient = useQueryClient();
  const sessions = useQuery({ queryKey: ['account', 'sessions'], queryFn: api.sessions });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['account', 'sessions'] });
  const end = useMutation({ mutationFn: api.endSession, onSuccess: refresh });
  const endOthers = useMutation({ mutationFn: api.endOtherSessions, onSuccess: refresh });
  const list = sessions.data?.sessions ?? [];
  const others = list.filter((s) => !s.current).length;

  return (
    <Card
      flat
      title="Устройства и сессии"
      description={
        sessions.isSuccess
          ? `${list.length} ${plural(list.length, 'активная сессия', 'активные сессии', 'активных сессий')}. Завершённая сессия выходит из всех сервисов на том устройстве.`
          : undefined
      }
      actions={
        others > 0 && (
          <Button size="sm" className="with-icon" onClick={() => endOthers.mutate()} loading={endOthers.isPending}>
            <LogOut size={14} />
            Завершить другие ({others})
          </Button>
        )
      }
    >
      {sessions.isPending && <Loading height={120} />}
      <ErrorAlert error={sessions.error ?? end.error ?? endOthers.error} />
      {sessions.isSuccess && list.length === 0 && <EmptyState icon={<MonitorSmartphone size={20} />} title="Активных сессий нет" />}
      {list.length > 0 && (
        <ul className="rows">
          {list.map((s) => (
            <SessionRow key={s.id} session={s} onEnd={() => end.mutate(s.id)} busy={end.isPending && end.variables === s.id} />
          ))}
        </ul>
      )}
    </Card>
  );
}

export function SessionRow({ session: s, onEnd, busy }: { session: AccountSession; onEnd?: () => void; busy?: boolean }) {
  return (
    <li>
      <MonitorSmartphone size={18} />
      <span className="row-text">
        <strong>
          <span className="mono">{s.ipAddress || 'IP неизвестен'}</span>{' '}
          {s.current && (
            <Badge tone="info" variant="solid">
              Эта сессия
            </Badge>
          )}
        </strong>
        <small>
          {s.clients.length > 0 ? <span className="mono">{s.clients.join(', ')}</span> : 'без приложений'} · активна{' '}
          {formatRelative(s.lastAccess)} · вход {formatDateTime(s.started)}
        </small>
      </span>
      {!s.current && onEnd && (
        <Button size="sm" variant="danger" onClick={onEnd} loading={busy}>
          Завершить
        </Button>
      )}
    </li>
  );
}

function LinkedAccounts() {
  const queryClient = useQueryClient();
  const linked = useQuery({ queryKey: ['account', 'linked'], queryFn: api.linkedAccounts });
  const unlink = useMutation({
    mutationFn: api.unlinkAccount,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['account', 'linked'] }),
  });
  const accounts: LinkedAccount[] = linked.data?.accounts ?? [];
  return (
    <Card flat title="Связанные аккаунты" description="Вход через внешних провайдеров.">
      {linked.isPending && <Loading height={80} />}
      <ErrorAlert error={linked.error ?? unlink.error} />
      {linked.isSuccess && accounts.length === 0 && <p className="hint">В realm не настроены внешние провайдеры.</p>}
      {accounts.length > 0 && (
        <ul className="rows">
          {accounts.map((a) => (
            <li key={a.alias}>
              <Link2 size={18} />
              <span className="row-text">
                <strong>{a.displayName}</strong>
                <small>{a.linked ? a.userName || 'связан' : 'не связан'}</small>
              </span>
              {a.linked ? (
                <Button size="sm" onClick={() => unlink.mutate(a.alias)} loading={unlink.isPending && unlink.variables === a.alias}>
                  Отвязать
                </Button>
              ) : (
                // Linking is a redirect to the external provider by nature.
                <a className="vs-button vs-sm with-icon" href={`/auth/action/${encodeURIComponent(`idp_link:${a.alias}`)}`}>
                  <Plus size={14} />
                  Связать
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Applications() {
  const queryClient = useQueryClient();
  const consents = useQuery({ queryKey: ['account', 'consents'], queryFn: api.consents });
  const revoke = useMutation({
    mutationFn: api.revokeConsent,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['account', 'consents'] }),
  });
  const list = consents.data?.consents ?? [];
  return (
    <Card flat title="Приложения" description="Кому вы разрешили доступ к аккаунту.">
      {consents.isPending && <Loading height={80} />}
      <ErrorAlert error={consents.error ?? revoke.error} />
      {consents.isSuccess && list.length === 0 && <p className="hint">Приложений с отдельным согласием нет.</p>}
      {list.length > 0 && (
        <ul className="rows">
          {list.map((c) => (
            <li key={c.clientId}>
              <span className="row-text">
                <strong className="mono">{c.clientId}</strong>
                <small>{c.scopes.join(', ') || 'без дополнительных разрешений'}</small>
              </span>
              <Button size="sm" variant="danger" onClick={() => revoke.mutate(c.clientId)} loading={revoke.isPending && revoke.variables === c.clientId}>
                Отозвать
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const eventLabels: Record<string, string> = {
  LOGIN: 'Вход',
  LOGIN_ERROR: 'Неудачный вход',
  LOGOUT: 'Выход',
  LOGOUT_ERROR: 'Ошибка выхода',
  UPDATE_PASSWORD: 'Смена пароля',
  UPDATE_CREDENTIAL: 'Смена способа входа',
  REMOVE_CREDENTIAL: 'Удаление способа входа',
  REFRESH_TOKEN_ERROR: 'Ошибка продления сессии',
};

function LoginHistory() {
  const events = useQuery({ queryKey: ['account', 'events'], queryFn: api.loginEvents });
  const list = events.data?.events ?? [];
  return (
    <Card flat title="История входов" description="Последние события вашей учётной записи.">
      {events.isPending && <Loading height={80} />}
      <ErrorAlert error={events.error} />
      {events.isSuccess && list.length === 0 && <p className="hint">Событий нет: хранение событий может быть отключено в realm.</p>}
      {list.length > 0 && (
        <ul className="rows">
          {list.map((e, i) => (
            <li key={`${e.time}-${i}`}>
              <span className="row-text">
                <strong>
                  {eventLabels[e.type] ?? e.type}{' '}
                  {e.error && <Badge tone="error">{e.error}</Badge>}
                </strong>
                <small>
                  {formatDateTime(e.time)} · <span className="mono">{e.ipAddress}</span>
                  {e.client && <> · <span className="mono">{e.client}</span></>}
                </small>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

