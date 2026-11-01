import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  AppWindow,
  CheckCircle2,
  ChevronRight,
  Fingerprint,
  KeyRound,
  Link2,
  LogOut,
  MonitorSmartphone,
  ShieldQuestion,
  Smartphone,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { useSearchParams } from 'react-router';
import { api, errorMessage, type AccountSession, type Credential } from '../api';
import { EmptyState, PageHeader, Skeleton } from '../components/ui';
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

const addActions: Record<string, { button: string; icon: LucideIcon }> = {
  CONFIGURE_TOTP: { button: 'Настроить OTP', icon: Smartphone },
  'webauthn-register': { button: 'Добавить ключ', icon: Fingerprint },
};

const statusInfo: Record<string, { text: string; ok: boolean }> = {
  success: { text: 'Изменения сохранены в Keycloak.', ok: true },
  cancelled: { text: 'Действие отменено — ничего не изменилось.', ok: false },
  error: { text: 'Не удалось выполнить действие. Попробуйте ещё раз.', ok: false },
};

// Full navigation: Keycloak re-authenticates, runs the action and returns to Orbit.
const actionHref = (action: string) => `/auth/action/${encodeURIComponent(action)}`;

export function Security() {
  const [params] = useSearchParams();
  const config = useQuery({ queryKey: ['config'], queryFn: api.config, staleTime: Infinity });
  const status = statusInfo[params.get('kc_action_status') ?? ''];

  return (
    <div className="page">
      <PageHeader
        title="Безопасность"
        description="Способы входа и активные сессии вашей учётной записи Keycloak — прямо в Orbit."
      />
      {status && (
        <div className={`alert ${status.ok ? 'alert-ok' : 'alert-warn'}`} role="status">
          {status.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          <span>{status.text}</span>
        </div>
      )}
      <Credentials actions={config.data?.actions ?? []} />
      <Sessions />
      {config.isSuccess && (
        <section className="section">
          <div className="section-head">
            <h2>Ещё в Keycloak</h2>
          </div>
          <ul className="card link-list">
            <ExternalItem
              icon={Link2}
              title="Связанные аккаунты"
              text="Внешние провайдеры идентификации"
              href={config.data.securityLinks.linkedAccounts}
            />
            <ExternalItem
              icon={AppWindow}
              title="Приложения"
              text="Приложения с доступом к аккаунту и их разрешения"
              href={config.data.securityLinks.applications}
            />
          </ul>
        </section>
      )}
    </div>
  );
}

function Credentials({ actions }: { actions: string[] }) {
  const credentials = useQuery({ queryKey: ['account', 'credentials'], queryFn: api.credentials });
  const add = Object.keys(addActions).filter((a) => actions.includes(a));

  return (
    <section className="section">
      <div className="section-head">
        <h2>Способы входа</h2>
        <div className="row">
          {add.map((a) => {
            const { button, icon: Icon } = addActions[a]!;
            return (
              <a key={a} className="btn btn-sm" href={actionHref(a)}>
                <Icon size={15} />
                {button}
              </a>
            );
          })}
        </div>
      </div>
      {credentials.isPending && <Skeleton height={140} />}
      {credentials.isError && <p className="form-error">{errorMessage(credentials.error)}</p>}
      {credentials.isSuccess && (
        <ul className="card rows">
          {credentials.data.credentials.map((c) => {
            const { title, icon: Icon } = credentialTitle(c);
            return (
              <li key={c.id} className="row-item">
                <span className="quick-icon">
                  <Icon size={18} />
                </span>
                <span className="row-text">
                  <strong>{c.label || title}</strong>
                  <small>
                    {c.label ? `${title} · ` : ''}
                    {c.createdAt ? `добавлен ${formatDate(c.createdAt)}` : 'дата неизвестна'}
                  </small>
                </span>
                {c.type === 'password' && actions.includes('UPDATE_PASSWORD') && (
                  <a className="btn btn-sm" href={actionHref('UPDATE_PASSWORD')}>
                    Сменить
                  </a>
                )}
                {c.removable && (
                  // Keycloak asks to confirm the deletion after re-authentication.
                  <a className="btn btn-sm btn-danger" href={actionHref(`delete_credential:${c.id}`)}>
                    <Trash2 size={15} />
                    Удалить
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {credentials.isSuccess && !credentials.data.credentials.some((c) => c.type !== 'password') && (
        <p className="field-hint">
          Второй фактор не настроен. Добавьте OTP или ключ безопасности — это защитит вход, даже если пароль утечёт.
        </p>
      )}
    </section>
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
    <section className="section">
      <div className="section-head">
        <h2>Устройства и сессии</h2>
        {others > 0 && (
          <button
            className="btn btn-sm"
            onClick={() => endOthers.mutate()}
            disabled={endOthers.isPending}
            aria-busy={endOthers.isPending}
          >
            <LogOut size={15} />
            Завершить другие ({others})
          </button>
        )}
      </div>
      {sessions.isPending && <Skeleton height={140} />}
      {sessions.isError && <p className="form-error">{errorMessage(sessions.error)}</p>}
      {(end.isError || endOthers.isError) && <p className="form-error">{errorMessage(end.error ?? endOthers.error)}</p>}
      {sessions.isSuccess && list.length === 0 && <EmptyState icon={MonitorSmartphone} title="Активных сессий нет" />}
      {list.length > 0 && (
        <ul className="card rows">
          {list.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              onEnd={() => end.mutate(s.id)}
              busy={end.isPending && end.variables === s.id}
            />
          ))}
        </ul>
      )}
      {sessions.isSuccess && (
        <p className="field-hint">
          {list.length} {plural(list.length, 'активная сессия', 'активные сессии', 'активных сессий')} в Keycloak.
          Завершённая сессия выходит из всех сервисов на том устройстве.
        </p>
      )}
    </section>
  );
}

export function SessionRow({
  session: s,
  onEnd,
  busy,
}: {
  session: AccountSession;
  onEnd?: () => void;
  busy?: boolean;
}) {
  return (
    <li className="row-item">
      <span className="quick-icon">
        <MonitorSmartphone size={18} />
      </span>
      <span className="row-text">
        <strong>
          <span className="mono">{s.ipAddress || 'IP неизвестен'}</span>
          {s.current && <span className="badge badge-accent">Эта сессия</span>}
        </strong>
        <small>
          {s.clients.length > 0 ? <span className="mono">{s.clients.join(', ')}</span> : 'без приложений'} · активна{' '}
          {formatRelative(s.lastAccess)} · вход {formatDateTime(s.started)}
        </small>
      </span>
      {!s.current && onEnd && (
        <button className="btn btn-sm btn-danger" onClick={onEnd} disabled={busy} aria-busy={busy}>
          Завершить
        </button>
      )}
    </li>
  );
}

function ExternalItem({
  icon: Icon,
  title,
  text,
  href,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
  href: string;
}) {
  return (
    <li>
      <a href={href} target="_blank" rel="noopener noreferrer">
        <span className="quick-icon">
          <Icon size={18} />
        </span>
        <span>
          <strong>{title}</strong>
          <small>{text}</small>
        </span>
        <ChevronRight size={18} className="chev" />
      </a>
    </li>
  );
}
