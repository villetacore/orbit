import { AlertCircle, LayoutGrid, Lock, ShieldCheck, UserRound } from 'lucide-react';
import { loginUrl } from '../api';
import { BrandMark } from '../components/ui';

function Orbits() {
  return (
    <svg className="landing-orbits" viewBox="0 0 560 560" aria-hidden="true">
      <g fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="1.2">
        <ellipse cx="280" cy="280" rx="250" ry="105" transform="rotate(-28 280 280)" />
        <ellipse cx="280" cy="280" rx="190" ry="78" transform="rotate(-28 280 280)" />
        <ellipse cx="280" cy="280" rx="130" ry="52" transform="rotate(-28 280 280)" />
      </g>
      <circle cx="280" cy="280" r="46" fill="rgba(255,255,255,0.9)" />
      <circle cx="280" cy="280" r="70" fill="rgba(255,255,255,0.12)" />
      <circle cx="502" cy="165" r="10" fill="#ffd28a" />
      <circle cx="122" cy="352" r="7" fill="#ffffff" />
      <circle cx="420" cy="312" r="6" fill="#ffb3a7" />
    </svg>
  );
}

export function Landing() {
  const failed = new URLSearchParams(window.location.search).get('error') === 'login_failed';
  // After a failed login, retry from the home page rather than the error URL.
  const target = failed ? loginUrl('/') : loginUrl();

  return (
    <div className="landing">
      <section className="landing-art">
        <Orbits />
        <div className="brand">
          <BrandMark />
          Orbit
        </div>
        <div className="landing-pitch">
          <h1>Ваш корпоративный аккаунт в одном месте</h1>
          <p>Профиль, доступ к сервисам компании и настройки безопасности — без отдельных паролей и панелей.</p>
        </div>
        <ul className="landing-features">
          <li>
            <span>
              <UserRound size={16} />
            </span>
            Профиль и фото, которые видят коллеги
          </li>
          <li>
            <span>
              <LayoutGrid size={16} />
            </span>
            Каталог сервисов с единым входом
          </li>
          <li>
            <span>
              <ShieldCheck size={16} />
            </span>
            Пароль, OTP и ключи безопасности
          </li>
        </ul>
      </section>

      <section className="landing-form">
        <div className="signin">
          <div>
            <h2>Вход в Orbit</h2>
          </div>
          <p>Используйте корпоративную учётную запись. Если вы уже вошли в другой сервис компании, вход произойдёт автоматически.</p>
          {failed && (
            <div className="alert alert-error" role="alert">
              <AlertCircle size={16} />
              Не удалось выполнить вход. Попробуйте ещё раз.
            </div>
          )}
          <a className="btn btn-primary btn-lg btn-block" href={target}>
            Войти через корпоративный аккаунт
          </a>
          <div className="signin-note">
            <Lock size={14} />
            <span>Вход выполняется через единый сервис идентификации. Orbit не хранит ваш пароль.</span>
          </div>
        </div>
      </section>
    </div>
  );
}
