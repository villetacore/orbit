'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Tabs, useToast } from '@villetacore/velessoft-ui';
import { useMemo, useState } from 'react';
import { kc, type KeycloakServerInfo } from '@/api';
import { useMe } from '@/auth';
import { ErrorAlert, Loading } from '@/components/ui';
import { JsonEditor, SaveBar, SettingsFields, useRepresentation, type Field, type Rep } from './shared';

export const realmKey = ['kc', 'realm'];

const general: Field[] = [
  { key: 'displayName', label: 'Отображаемое имя', hint: 'Издатель в приложениях-аутентификаторах и письмах.' },
  { key: 'displayNameHtml', label: 'Имя в HTML', hint: 'Для страниц единого входа.' },
  { key: 'attributes.frontendUrl', label: 'Внешний URL (Frontend URL)', hint: 'Пусто — определяется автоматически.' },
  {
    key: 'sslRequired',
    label: 'Требовать HTTPS',
    type: 'select',
    options: [
      { value: 'none', label: 'Нет' },
      { value: 'external', label: 'Для внешних запросов' },
      { value: 'all', label: 'Всегда' },
    ],
  },
  { key: 'userManagedAccessAllowed', label: 'User-Managed Access', type: 'bool' },
  { key: 'organizationsEnabled', label: 'Организации', type: 'bool' },
  { key: 'adminPermissionsEnabled', label: 'Детальные права администраторов', type: 'bool' },
  { key: 'verifiableCredentialsEnabled', label: 'Verifiable Credentials', type: 'bool' },
];

const login: Field[] = [
  { key: 'registrationAllowed', label: 'Саморегистрация на странице Keycloak', type: 'bool', hint: 'Заявки в Orbit работают независимо от этого.' },
  { key: 'registrationEmailAsUsername', label: 'Email вместо логина', type: 'bool' },
  { key: 'editUsernameAllowed', label: 'Пользователь может менять логин', type: 'bool' },
  { key: 'resetPasswordAllowed', label: '«Забыли пароль» на странице Keycloak', type: 'bool' },
  { key: 'rememberMe', label: '«Запомнить меня»', type: 'bool' },
  { key: 'verifyEmail', label: 'Подтверждать email', type: 'bool' },
  { key: 'loginWithEmailAllowed', label: 'Вход по email', type: 'bool' },
  { key: 'duplicateEmailsAllowed', label: 'Одинаковый email у разных пользователей', type: 'bool' },
];

const sessions: Field[] = [
  { key: 'ssoSessionIdleTimeout', label: 'SSO: время простоя', type: 'seconds' },
  { key: 'ssoSessionMaxLifespan', label: 'SSO: максимальная длительность', type: 'seconds' },
  { key: 'ssoSessionIdleTimeoutRememberMe', label: 'SSO «Запомнить меня»: простой', type: 'seconds' },
  { key: 'ssoSessionMaxLifespanRememberMe', label: 'SSO «Запомнить меня»: максимум', type: 'seconds' },
  { key: 'clientSessionIdleTimeout', label: 'Сессия клиента: простой', type: 'seconds' },
  { key: 'clientSessionMaxLifespan', label: 'Сессия клиента: максимум', type: 'seconds' },
  { key: 'offlineSessionIdleTimeout', label: 'Offline: простой', type: 'seconds' },
  { key: 'offlineSessionMaxLifespanEnabled', label: 'Offline: ограничить длительность', type: 'bool' },
  { key: 'offlineSessionMaxLifespan', label: 'Offline: максимум', type: 'seconds' },
  { key: 'accessCodeLifespanLogin', label: 'Время на вход', type: 'seconds' },
];

const tokens: Field[] = [
  { key: 'accessTokenLifespan', label: 'Access token', type: 'seconds' },
  { key: 'accessTokenLifespanForImplicitFlow', label: 'Access token (implicit)', type: 'seconds' },
  { key: 'accessCodeLifespan', label: 'Код авторизации', type: 'seconds' },
  { key: 'accessCodeLifespanUserAction', label: 'Действие пользователя', type: 'seconds' },
  { key: 'actionTokenGeneratedByAdminLifespan', label: 'Ссылка от администратора', type: 'seconds' },
  { key: 'actionTokenGeneratedByUserLifespan', label: 'Ссылка от пользователя', type: 'seconds' },
  { key: 'revokeRefreshToken', label: 'Одноразовые refresh-токены', type: 'bool' },
  { key: 'refreshTokenMaxReuse', label: 'Повторов refresh-токена', type: 'number' },
  { key: 'defaultSignatureAlgorithm', label: 'Алгоритм подписи по умолчанию' },
];

const security: Field[] = [
  { key: 'bruteForceProtected', label: 'Защита от перебора', type: 'bool' },
  { key: 'permanentLockout', label: 'Постоянная блокировка', type: 'bool' },
  { key: 'maxTemporaryLockouts', label: 'Временных блокировок до постоянной', type: 'number' },
  { key: 'failureFactor', label: 'Неудачных попыток до блокировки', type: 'number' },
  { key: 'waitIncrementSeconds', label: 'Шаг ожидания', type: 'seconds' },
  { key: 'maxFailureWaitSeconds', label: 'Максимальное ожидание', type: 'seconds' },
  { key: 'maxDeltaTimeSeconds', label: 'Сброс счётчика неудач', type: 'seconds' },
  { key: 'quickLoginCheckMilliSeconds', label: 'Порог быстрых попыток', type: 'number', hint: 'Миллисекунды.' },
  { key: 'minimumQuickLoginWaitSeconds', label: 'Ожидание после быстрой попытки', type: 'seconds' },
  { key: 'browserSecurityHeaders.contentSecurityPolicy', label: 'Content-Security-Policy' },
  { key: 'browserSecurityHeaders.xFrameOptions', label: 'X-Frame-Options' },
  { key: 'browserSecurityHeaders.strictTransportSecurity', label: 'Strict-Transport-Security' },
  { key: 'browserSecurityHeaders.referrerPolicy', label: 'Referrer-Policy' },
];

const otp: Field[] = [
  {
    key: 'otpPolicyType',
    label: 'Тип',
    type: 'select',
    hint: 'Подключение OTP в Orbit работает только с TOTP.',
    options: [
      { value: 'totp', label: 'TOTP — по времени' },
      { value: 'hotp', label: 'HOTP — по счётчику' },
    ],
  },
  {
    key: 'otpPolicyAlgorithm',
    label: 'Алгоритм',
    type: 'select',
    options: ['HmacSHA1', 'HmacSHA256', 'HmacSHA512'].map((v) => ({ value: v, label: v })),
  },
  { key: 'otpPolicyDigits', label: 'Цифр в коде', type: 'number' },
  { key: 'otpPolicyPeriod', label: 'Период', type: 'seconds' },
  { key: 'otpPolicyLookAheadWindow', label: 'Окно допуска', type: 'number', hint: 'На сколько шагов может отличаться время устройства.' },
  { key: 'otpPolicyCodeReusable', label: 'Разрешить повторное использование кода', type: 'bool' },
];

const email: Field[] = [
  { key: 'smtpServer.host', label: 'Сервер SMTP' },
  { key: 'smtpServer.port', label: 'Порт' },
  { key: 'smtpServer.from', label: 'Адрес отправителя' },
  { key: 'smtpServer.fromDisplayName', label: 'Имя отправителя' },
  { key: 'smtpServer.replyTo', label: 'Адрес для ответа' },
  { key: 'smtpServer.envelopeFrom', label: 'Envelope From' },
  { key: 'smtpServer.ssl', label: 'SSL', type: 'boolString' },
  { key: 'smtpServer.starttls', label: 'StartTLS', type: 'boolString' },
  { key: 'smtpServer.auth', label: 'Авторизация', type: 'boolString' },
  { key: 'smtpServer.user', label: 'Пользователь SMTP' },
  { key: 'smtpServer.password', label: 'Пароль SMTP', type: 'password' },
];

const events: Field[] = [
  { key: 'eventsEnabled', label: 'Хранить события входа', type: 'bool', hint: 'Нужны для «Истории входов» в Безопасности.' },
  { key: 'eventsExpiration', label: 'Срок хранения событий', type: 'seconds' },
  { key: 'adminEventsEnabled', label: 'Хранить действия администраторов', type: 'bool' },
  { key: 'adminEventsDetailsEnabled', label: 'Сохранять тела запросов администраторов', type: 'bool' },
  { key: 'eventsListeners', label: 'Слушатели событий', type: 'list' },
  { key: 'enabledEventTypes', label: 'Сохраняемые типы событий', type: 'lines', hint: 'Пусто — значения по умолчанию.' },
];

function themeField(key: string, label: string, kind: string, info?: KeycloakServerInfo): Field {
  return {
    key,
    label,
    type: 'select',
    options: [{ value: '', label: 'По умолчанию' }, ...(info?.themes?.[kind] ?? []).map((t) => ({ value: t.name, label: t.name }))],
  };
}

// RealmSettings covers the realm representation: common fields on tabs, and
// the whole object as JSON for everything else Keycloak has.
export function RealmSettings() {
  const { value, query, setDraft, dirty, reset, save } = useRepresentation('', realmKey);
  const info = useQuery({ queryKey: ['kc', 'serverinfo'], queryFn: kc.serverInfo, staleTime: 10 * 60_000 });
  const look = useMemo<Field[]>(
    () => [
      themeField('loginTheme', 'Тема страниц входа', 'login', info.data),
      themeField('accountTheme', 'Тема консоли аккаунта', 'account', info.data),
      themeField('adminTheme', 'Тема консоли администратора', 'admin', info.data),
      themeField('emailTheme', 'Тема писем', 'email', info.data),
      { key: 'internationalizationEnabled', label: 'Локализация', type: 'bool' },
      { key: 'supportedLocales', label: 'Языки', type: 'list', hint: 'Например: ru, en.' },
      { key: 'defaultLocale', label: 'Язык по умолчанию' },
    ],
    [info.data],
  );

  if (query.isPending) return <Loading height={420} />;
  if (query.isError || !value) return <ErrorAlert error={query.error} />;

  const tab = (fields: Field[], extra?: React.ReactNode) => (
    <Card flat>
      <SettingsFields fields={fields} value={value} onChange={setDraft} />
      {extra}
      <SaveBar dirty={dirty} save={save} onReset={reset} onSave={() => save.mutate(value)} />
    </Card>
  );

  return (
    <Tabs
      label="Настройки realm"
      items={[
        { value: 'general', label: 'Основные', content: tab(general) },
        { value: 'login', label: 'Вход', content: tab(login) },
        { value: 'sessions', label: 'Сессии', content: tab(sessions) },
        { value: 'tokens', label: 'Токены', content: tab(tokens) },
        { value: 'security', label: 'Защита', content: tab(security) },
        { value: 'otp', label: 'OTP', content: tab(otp) },
        { value: 'email', label: 'Почта', content: tab(email, <SMTPTest smtp={value.smtpServer as Rep | undefined} />) },
        { value: 'look', label: 'Темы и языки', content: tab(look) },
        { value: 'events', label: 'События', content: tab(events) },
        {
          value: 'json',
          label: 'JSON',
          content: (
            <Card flat title="Весь realm" description="Любое поле, которое есть в Keycloak, включая WebAuthn-политики и атрибуты.">
              <JsonEditor key={JSON.stringify(query.data)} value={query.data} onSave={(rep) => save.mutate(rep)} saving={save.isPending} error={save.error} />
            </Card>
          ),
        },
      ]}
    />
  );
}

function SMTPTest({ smtp }: { smtp?: Rep }) {
  const me = useMe();
  const { toast } = useToast();
  const [sent, setSent] = useState(false);
  const test = useMutation({
    mutationFn: () => kc.post('/testSMTPConnection', smtp ?? {}),
    onSuccess: () => {
      setSent(true);
      toast({ tone: 'success', title: 'Тестовое письмо отправлено' });
    },
  });
  return (
    <div className="stack">
      {!me.email && <Alert tone="warning">Keycloak шлёт тестовое письмо на адрес администратора, а у вас email не указан.</Alert>}
      <div className="row">
        <Button onClick={() => test.mutate()} loading={test.isPending} disabled={!smtp?.host}>
          Проверить отправку
        </Button>
        {sent && <span className="hint">Письмо ушло на {me.email}</span>}
      </div>
      <ErrorAlert error={test.error} />
    </div>
  );
}
