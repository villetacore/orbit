import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  AppWindow,
  CheckCircle2,
  ChevronRight,
  Fingerprint,
  KeyRound,
  Link2,
  ListChecks,
  MonitorSmartphone,
  Smartphone,
  type LucideIcon,
} from 'lucide-react';
import { useSearchParams } from 'react-router';
import { api, errorMessage } from '../api';
import { PageHeader, Skeleton } from '../components/ui';

const actionInfo: Record<string, { title: string; text: string; button: string; icon: LucideIcon }> = {
  UPDATE_PASSWORD: {
    title: 'Пароль',
    text: 'Перед сменой пароля Keycloak попросит подтвердить вход.',
    button: 'Сменить пароль',
    icon: KeyRound,
  },
  CONFIGURE_TOTP: {
    title: 'Приложение-аутентификатор',
    text: 'Одноразовые коды из Google Authenticator, FreeOTP или аналогов.',
    button: 'Настроить OTP',
    icon: Smartphone,
  },
  'webauthn-register': {
    title: 'Ключ безопасности',
    text: 'Аппаратный ключ или passkey (WebAuthn) как второй фактор.',
    button: 'Добавить ключ',
    icon: Fingerprint,
  },
};

const actionOrder = ['UPDATE_PASSWORD', 'CONFIGURE_TOTP', 'webauthn-register'];

const statusInfo: Record<string, { text: string; ok: boolean }> = {
  success: { text: 'Изменения сохранены в Keycloak.', ok: true },
  cancelled: { text: 'Действие отменено — ничего не изменилось.', ok: false },
  error: { text: 'Не удалось выполнить действие. Попробуйте ещё раз.', ok: false },
};

export function Security() {
  const [params] = useSearchParams();
  const config = useQuery({ queryKey: ['config'], queryFn: api.config, staleTime: Infinity });
  const status = statusInfo[params.get('kc_action_status') ?? ''];

  const header = (
    <PageHeader title="Безопасность" description="Способы входа и активность учётной записи. Все изменения выполняются в Keycloak." />
  );

  if (config.isPending) {
    return (
      <div className="page">
        {header}
        <div className="methods">
          <Skeleton height={190} count={3} />
        </div>
      </div>
    );
  }
  if (config.isError) {
    return (
      <div className="page">
        {header}
        <p className="form-error">{errorMessage(config.error)}</p>
      </div>
    );
  }
  const links = config.data.securityLinks;
  const actions = actionOrder.filter((a) => config.data.actions.includes(a));

  return (
    <div className="page">
      {header}
      {status && (
        <div className={`alert ${status.ok ? 'alert-ok' : 'alert-warn'}`} role="status">
          {status.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          <span>{status.text}</span>
        </div>
      )}

      <section className="section">
        <h2>Способы входа</h2>
        <div className="methods">
          {actions.map((a) => {
            const info = actionInfo[a]!;
            const Icon = info.icon;
            return (
              <div key={a} className="card method">
                <span className="method-icon">
                  <Icon size={20} />
                </span>
                <h3>{info.title}</h3>
                <p>{info.text}</p>
                {/* Full navigation: Keycloak runs the action and returns to Orbit. */}
                <a className="btn" href={`/auth/action/${encodeURIComponent(a)}`}>
                  {info.button}
                </a>
              </div>
            );
          })}
        </div>
      </section>

      <section className="section">
        <h2>Аккаунт в Keycloak</h2>
        <ul className="card link-list">
          <ExternalItem
            icon={ListChecks}
            title="Все способы входа"
            text="Настроенные пароли, OTP и ключи; удаление лишних"
            href={links.signingIn}
          />
          <ExternalItem
            icon={MonitorSmartphone}
            title="Устройства и сессии"
            text="Где выполнен вход; завершение отдельных сессий"
            href={links.deviceActivity}
          />
          <ExternalItem
            icon={Link2}
            title="Связанные аккаунты"
            text="Внешние провайдеры идентификации"
            href={links.linkedAccounts}
          />
          <ExternalItem
            icon={AppWindow}
            title="Приложения"
            text="Приложения с доступом к аккаунту и их разрешения"
            href={links.applications}
          />
        </ul>
      </section>
    </div>
  );
}

function ExternalItem({ icon: Icon, title, text, href }: { icon: LucideIcon; title: string; text: string; href: string }) {
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
