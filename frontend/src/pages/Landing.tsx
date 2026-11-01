import { AlertCircle, ArrowUpRight, LayoutGrid, LifeBuoy, Lock, ShieldCheck, UserRound } from 'lucide-react';
import { loginUrl } from '../api';
import { useBranding } from '../branding';
import { Brand, Signature } from '../components/ui';

function Orbits() {
  return (
    <svg className="landing-orbits" viewBox="0 0 560 560" aria-hidden="true">
      <g fill="none" strokeWidth="1.4">
        <ellipse cx="280" cy="280" rx="250" ry="105" transform="rotate(-28 280 280)" stroke="rgba(247,248,245,0.14)" />
        <ellipse cx="280" cy="280" rx="190" ry="78" transform="rotate(-28 280 280)" stroke="var(--brand-primary)" strokeOpacity="0.55" />
        <ellipse cx="280" cy="280" rx="130" ry="52" transform="rotate(-28 280 280)" stroke="var(--brand-accent)" strokeOpacity="0.55" />
      </g>
      <circle cx="280" cy="280" r="70" fill="var(--brand-primary)" fillOpacity="0.16" />
      <circle cx="280" cy="280" r="44" fill="var(--brand-accent)" />
      <circle cx="502" cy="165" r="10" fill="var(--brand-primary)" />
      <circle cx="122" cy="352" r="7" fill="var(--brand-accent)" />
      <circle cx="420" cy="312" r="5" fill="#F7F8F5" />
    </svg>
  );
}

export function Landing() {
  const branding = useBranding();
  const failed = new URLSearchParams(window.location.search).get('error') === 'login_failed';
  // After a failed login, retry from the home page rather than the error URL.
  const target = failed ? loginUrl('/') : loginUrl();
  const support = branding.supportUrl || (branding.supportEmail && `mailto:${branding.supportEmail}`);

  return (
    <div className="landing">
      <section className="landing-art">
        <Orbits />
        <div className="brand">
          <Brand />
        </div>
        <div className="landing-pitch">
          {branding.landingTitle ? (
            <h1>{branding.landingTitle}</h1>
          ) : (
            <h1>
              Корпоративный аккаунт.
              <em>Всё в одном месте.</em>
            </h1>
          )}
          <p>
            {branding.landingSubtitle ||
              'Профиль, доступ к сервисам компании и настройки безопасности — без отдельных паролей и панелей.'}
          </p>
        </div>
        <div className="section" style={{ position: 'relative', gap: 28 }}>
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
          <div className="landing-kicker">Один вход для всех сервисов</div>
        </div>
      </section>

      <section className="landing-form">
        <div className="signin">
          <h2>Вход в {branding.appName}</h2>
          <p>
            Используйте корпоративную учётную запись. Если вы уже вошли в другой сервис компании, вход произойдёт
            автоматически.
          </p>
          {failed && (
            <div className="alert alert-error" role="alert">
              <AlertCircle size={16} />
              Не удалось выполнить вход. Попробуйте ещё раз.
            </div>
          )}
          <a className="btn btn-primary btn-lg btn-block" href={target}>
            Войти через корпоративный аккаунт
            <ArrowUpRight size={18} />
          </a>
          <div className="signin-note">
            <Lock size={14} />
            <span>Вход выполняется через единый сервис идентификации. {branding.appName} не хранит ваш пароль.</span>
          </div>
          {support && (
            <a className="btn btn-ghost" href={support} target="_blank" rel="noopener noreferrer">
              <LifeBuoy size={16} />
              Нужна помощь со входом
            </a>
          )}
          <Signature />
        </div>
      </section>
    </div>
  );
}
