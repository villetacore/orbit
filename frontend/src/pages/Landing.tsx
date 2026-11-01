import { useQuery } from '@tanstack/react-query';
import { AlertCircle, ArrowUpRight, LifeBuoy, Lock, UserPlus } from 'lucide-react';
import { Link, useLocation } from 'react-router';
import { api, loginUrl } from '../api';
import { useBranding } from '../branding';
import { Brand, Signature } from '../components/ui';
import { RegisterForm } from './Register';

export function Landing() {
  const branding = useBranding();
  const failed = new URLSearchParams(window.location.search).get('error') === 'login_failed';
  // After a failed login, retry from the home page rather than the error URL.
  const target = failed ? loginUrl('/') : loginUrl();
  const support = branding.supportUrl || (branding.supportEmail && `mailto:${branding.supportEmail}`);
  const config = useQuery({ queryKey: ['config'], queryFn: api.config, staleTime: Infinity });
  const canRegister = config.data?.registrationEnabled === true;
  const registering = useLocation().pathname === '/register' && canRegister;

  return (
    <div className="landing">
      <section className="landing-art">
        <div className="landing-top">
          <div className="brand">
            <Brand />
          </div>
          <span className="mono">Единый вход / always on</span>
        </div>
        <div>
          {branding.landingTitle ? (
            <h1 className="landing-custom-title">{branding.landingTitle}</h1>
          ) : (
            <h1 className="riot-title" aria-label="Один вход. Все сервисы.">
              <span aria-hidden="true">Один</span>
              <span aria-hidden="true">
                вход<span className="asterisk">✳</span>
              </span>
              <span aria-hidden="true">все</span>
              <span aria-hidden="true">
                сервисы<span className="period">_</span>
              </span>
            </h1>
          )}
        </div>
        <p className="landing-pitch">
          {branding.landingSubtitle ||
            'Профиль, коллеги, доступ к сервисам компании и безопасность аккаунта — без отдельных паролей и панелей.'}
        </p>
        <div className="landing-bottom">
          <ul className="landing-features">
            <li>[ профиль и фото ]</li>
            <li>[ каталог сервисов ]</li>
            <li>[ люди и контакты ]</li>
            <li>[ пароль, OTP, ключи ]</li>
          </ul>
          <div className="stamp" aria-hidden="true">
            sign
            <br />
            in ↗
          </div>
        </div>
        <div className="strip" aria-hidden="true">
          log in. open. build. repeat. / {branding.appName} / log in. open. build. repeat.
        </div>
      </section>

      <section className="landing-form">
        {registering ? (
          <RegisterForm appName={branding.appName} />
        ) : (
          <div className="signin">
            <div className="eyebrow">{branding.appName} / вход</div>
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
            {canRegister && (
              <Link className="btn btn-block" to="/register">
                <UserPlus size={16} />
                Нет аккаунта? Подать заявку
              </Link>
            )}
            {support && (
              <a className="btn btn-ghost" href={support} target="_blank" rel="noopener noreferrer">
                <LifeBuoy size={16} />
                Нужна помощь со входом
              </a>
            )}
            <Signature />
          </div>
        )}
      </section>
    </div>
  );
}
