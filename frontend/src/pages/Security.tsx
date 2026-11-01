import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { api, errorMessage } from '../api';

const actionInfo: Record<string, { title: string; text: string; button: string }> = {
  UPDATE_PASSWORD: {
    title: 'Пароль',
    text: 'Смена пароля выполняется в Keycloak; перед изменением потребуется подтвердить вход.',
    button: 'Сменить пароль',
  },
  CONFIGURE_TOTP: {
    title: 'Приложение-аутентификатор',
    text: 'Одноразовые коды из Google Authenticator, FreeOTP или аналогичного приложения.',
    button: 'Настроить OTP',
  },
  'webauthn-register': {
    title: 'Ключ безопасности',
    text: 'Аппаратный ключ или passkey (WebAuthn) как второй фактор.',
    button: 'Добавить ключ',
  },
};

const statusText: Record<string, { text: string; kind: string }> = {
  success: { text: 'Изменения сохранены.', kind: 'banner-ok' },
  cancelled: { text: 'Действие отменено.', kind: 'banner-warn' },
  error: { text: 'Не удалось выполнить действие.', kind: 'banner-warn' },
};

export function Security() {
  const [params] = useSearchParams();
  const config = useQuery({ queryKey: ['config'], queryFn: api.config, staleTime: Infinity });
  const status = statusText[params.get('kc_action_status') ?? ''];

  if (config.isPending) return <div className="page muted">Загрузка…</div>;
  if (config.isError) return <div className="page form-error">{errorMessage(config.error)}</div>;
  const links = config.data.securityLinks;

  return (
    <div className="page">
      <h1>Безопасность</h1>
      {status && (
        <p className={`banner ${status.kind}`} role="status">
          {status.text}
        </p>
      )}

      <section className="card">
        <h2>Способы входа</h2>
        <ul className="action-list">
          {config.data.actions
            .filter((a) => actionInfo[a])
            .map((a) => {
              const info = actionInfo[a]!;
              return (
                <li key={a}>
                  <div>
                    <h3>{info.title}</h3>
                    <p className="muted">{info.text}</p>
                  </div>
                  {/* Full navigation: Keycloak runs the action and returns to Orbit. */}
                  <a className="btn" href={`/auth/action/${encodeURIComponent(a)}`}>
                    {info.button}
                  </a>
                </li>
              );
            })}
        </ul>
      </section>

      <section className="card">
        <h2>Аккаунт в Keycloak</h2>
        <ul className="action-list">
          <ExternalItem
            title="Все способы входа"
            text="Просмотр и удаление настроенных паролей, OTP и ключей."
            href={links.signingIn}
          />
          <ExternalItem
            title="Устройства и сессии"
            text="Где выполнен вход; завершение отдельных сессий."
            href={links.deviceActivity}
          />
          <ExternalItem
            title="Связанные аккаунты"
            text="Внешние провайдеры идентификации, подключённые к аккаунту."
            href={links.linkedAccounts}
          />
          <ExternalItem
            title="Приложения"
            text="Приложения с доступом к аккаунту и выданные им разрешения."
            href={links.applications}
          />
        </ul>
      </section>
    </div>
  );
}

function ExternalItem({ title, text, href }: { title: string; text: string; href: string }) {
  return (
    <li>
      <div>
        <h3>{title}</h3>
        <p className="muted">{text}</p>
      </div>
      <a className="btn btn-ghost" href={href} target="_blank" rel="noopener noreferrer">
        Открыть ↗
      </a>
    </li>
  );
}
