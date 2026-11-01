import { loginUrl } from '../api';
import { OrbitMark } from '../components/Layout';

export function Landing() {
  const failed = new URLSearchParams(window.location.search).get('error') === 'login_failed';
  // After a failed login, retry from the home page rather than the error URL.
  const target = failed ? loginUrl('/') : loginUrl();

  return (
    <div className="landing">
      <div className="landing-card">
        <div className="landing-mark">
          <OrbitMark size={48} />
        </div>
        <h1>Orbit</h1>
        <p className="lead">Корпоративный аккаунт, сервисы и подключения в одном месте.</p>
        {failed && (
          <p className="form-error" role="alert">
            Не удалось выполнить вход. Попробуйте ещё раз.
          </p>
        )}
        <a className="btn btn-primary btn-lg" href={target}>
          Войти через корпоративный аккаунт
        </a>
        <p className="hint">Вход выполняется через единый сервис идентификации (Keycloak). Orbit не хранит ваш пароль.</p>
      </div>
    </div>
  );
}
