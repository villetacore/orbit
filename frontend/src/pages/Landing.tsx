import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Input, PasswordInput } from '@villetacore/velessoft-ui';
import { LifeBuoy, UserPlus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useLocation } from 'react-router';
import { ApiError, api, errorMessage, safeReturnTo, ssoLoginUrl } from '../api';
import { useBranding } from '../branding';
import { meQueryKey } from '../auth';
import { Brand, LinkButton, Signature } from '../components/ui';
import { RegisterForm } from './Register';

// LoginForm signs in right here: the credentials go to Orbit's backend, which
// checks them with Keycloak. The browser never leaves the page.
export function LoginForm({ appName }: { appName: string }) {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  // Keycloak answers identically for a wrong password and a missing code, so the
  // code field appears after any rejection instead of revealing who has 2FA.
  const [askOtp, setAskOtp] = useState(false);
  const [mustChange, setMustChange] = useState(false);
  const [browserRequired, setBrowserRequired] = useState(false);
  const returnTo = safeReturnTo(new URLSearchParams(window.location.search).get('return_to'));

  const login = useMutation({
    mutationFn: () => api.login({ username, password, otp, newPassword: mustChange ? newPassword : undefined }),
    onSuccess: () => {
      if (returnTo) window.location.assign(returnTo);
      else void queryClient.invalidateQueries({ queryKey: meQueryKey });
    },
    onError: (err) => {
      if (!(err instanceof ApiError)) return;
      if (err.code === 'invalid_credentials') {
        setAskOtp(true);
        setOtp('');
      } else if (err.code === 'password_change_required') {
        setMustChange(true);
      } else if (err.code === 'browser_required') {
        setBrowserRequired(true);
      }
    },
  });

  const mismatch = mustChange && repeat !== '' && repeat !== newPassword;
  const invalid = login.error instanceof ApiError && login.error.code === 'invalid_credentials';
  const asked = login.error instanceof ApiError && login.error.code === 'password_change_required';

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (mismatch) return;
    login.mutate();
  }

  return (
    <form className="signin" onSubmit={onSubmit}>
      <h2>Вход в {appName}</h2>
      {new URLSearchParams(window.location.search).get('error') === 'login_failed' && !login.isError && (
        <Alert tone="error">Не удалось выполнить вход. Попробуйте ещё раз.</Alert>
      )}
      {login.isError && !browserRequired && !asked && (
        <Alert tone="error">
          {invalid
            ? 'Неверный логин, пароль или код. Если у вас включена двухфакторная защита, введите и код из приложения.'
            : errorMessage(login.error)}
        </Alert>
      )}
      {browserRequired && (
        <Alert
          tone="warning"
          title="Нужно завершить настройку аккаунта"
          actions={
            <a className="vs-button vs-primary vs-sm" href={ssoLoginUrl(returnTo ?? '/')}>
              Продолжить
            </a>
          }
        >
          Администратор запросил действие, которое выполняется на странице единого входа.
        </Alert>
      )}
      {mustChange ? (
        <>
          <Alert tone="info" title="Задайте постоянный пароль">
            Вы вошли с временным паролем. Придумайте новый — он заменит временный.
          </Alert>
          <PasswordInput
            label="Новый пароль"
            showLabel="Показать"
            hideLabel="Скрыть"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            autoFocus
            required
          />
          <PasswordInput
            label="Повторите пароль"
            showLabel="Показать"
            hideLabel="Скрыть"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            autoComplete="new-password"
            error={mismatch ? 'Пароли не совпадают' : undefined}
            required
          />
        </>
      ) : (
        <>
          <Input
            label="Логин или email"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            required
          />
          <PasswordInput
            label="Пароль"
            showLabel="Показать"
            hideLabel="Скрыть"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {askOtp && (
            <Input
              label="Код подтверждения"
              hint="6 цифр из приложения-аутентификатора. Если 2FA не включена, оставьте пустым."
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
            />
          )}
        </>
      )}
      <Button type="submit" variant="primary" size="lg" block loading={login.isPending} disabled={mismatch}>
        {mustChange ? 'Сохранить и войти' : 'Войти'}
      </Button>
      <a className="vs-link signin-alt" href={ssoLoginUrl(returnTo ?? '/')}>
        Другой способ: passkey или внешний провайдер
      </a>
    </form>
  );
}

export function Landing() {
  const branding = useBranding();
  const support = branding.supportUrl || (branding.supportEmail && `mailto:${branding.supportEmail}`);
  const config = useQuery({ queryKey: ['config'], queryFn: api.config, staleTime: Infinity });
  const canRegister = config.data?.registrationEnabled === true;
  const registering = useLocation().pathname === '/register' && canRegister;

  return (
    <div className="landing">
      <section className="landing-art" data-theme="dark">
        <div className="brand">
          <Brand />
        </div>
        <div>
          <small className="eyebrow">{branding.appName} / единый вход</small>
          <h1>
            {branding.landingTitle || (
              <>
                Один вход. Все сервисы<span className="title-mark"> /_</span>
              </>
            )}
          </h1>
          <p>
            {branding.landingSubtitle ||
              'Профиль, коллеги, доступ к сервисам компании и безопасность аккаунта — без отдельных паролей и панелей.'}
          </p>
        </div>
        <Signature />
      </section>

      <section className="landing-form">
        <div className="landing-form-inner">
          {registering ? <RegisterForm appName={branding.appName} /> : <LoginForm appName={branding.appName} />}
          {!registering && (canRegister || support) && (
            <div className="row">
              {canRegister && (
                <LinkButton to="/register" variant="ghost">
                  <UserPlus size={16} />
                  Подать заявку на аккаунт
                </LinkButton>
              )}
              {support && (
                <a className="vs-button vs-ghost with-icon" href={support} target="_blank" rel="noopener noreferrer">
                  <LifeBuoy size={16} />
                  Помощь со входом
                </a>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
