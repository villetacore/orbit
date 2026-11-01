import { useQuery } from '@tanstack/react-query';
import {
  BadgeCheck,
  Camera,
  ChevronRight,
  KeyRound,
  LayoutGrid,
  MonitorSmartphone,
  Pencil,
  Smartphone,
  Star,
  UserRound,
  Users,
} from 'lucide-react';
import { Link } from 'react-router';
import { api, errorMessage } from '../api';
import { useMe } from '../auth';
import { useBranding } from '../branding';
import { Avatar } from '../components/Avatar';
import { ServiceCard, servicesQueryKey } from '../components/ServiceCard';
import { EmptyState, Skeleton } from '../components/ui';
import { greeting, plural } from '../lib/format';

export function Dashboard() {
  const me = useMe();
  const branding = useBranding();
  const today = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'long' });
  const services = useQuery({ queryKey: servicesQueryKey, queryFn: api.services });
  const profile = useQuery({ queryKey: ['profile'], queryFn: api.profile });

  const all = services.data?.services ?? [];
  const favorites = all.filter((s) => s.favorite);
  const displayName = me.name || me.username;
  const firstName = profile.data?.firstName || displayName.split(' ')[0];
  const attr = (name: string) => profile.data?.attributes.find((a) => a.name === name)?.value;
  const subtitle = [attr('jobTitle'), attr('department')].filter(Boolean).join(' · ') || me.email;

  return (
    <div className="page">
      <div>
        <section className="poster">
          <div className="poster-top">
            <span>{branding.appName} / корпоративный аккаунт</span>
            <span>{today}</span>
          </div>
          <div className="poster-body">
            <Avatar url={me.avatarUrl} name={displayName} size={104} />
            <div className="poster-title">
              <h1>
                {greeting()},<br />
                <span className="cutout">{firstName}</span>
              </h1>
              <p>{subtitle}</p>
              <div className="poster-actions">
                <Link to="/services" className="btn btn-primary">
                  <LayoutGrid size={15} />
                  Все сервисы
                </Link>
                <Link to="/profile" className="btn">
                  <Pencil size={15} />
                  Профиль
                </Link>
              </div>
            </div>
          </div>
          <div className="stamp" aria-hidden="true">
            один
            <br />
            вход ↗
          </div>
        </section>
        <div className="strip" aria-hidden="true">
          sso / профиль / сервисы / безопасность / один вход для всего / by velessoft
        </div>
      </div>

      <section className="stats">
        <Link to="/services" className="card stat">
          <span className="stat-icon">
            <LayoutGrid size={18} />
          </span>
          <div>
            <div className="stat-value">{services.isSuccess ? all.length : '—'}</div>
            <div className="stat-label">
              {plural(all.length, 'доступный сервис', 'доступных сервиса', 'доступных сервисов')}
            </div>
          </div>
        </Link>
        <Link to="/services?favorites=1" className="card stat">
          <span className="stat-icon">
            <Star size={18} />
          </span>
          <div>
            <div className="stat-value">{services.isSuccess ? favorites.length : '—'}</div>
            <div className="stat-label">в избранном</div>
          </div>
        </Link>
        <Link to="/profile" className="card stat">
          <span className="stat-icon ok">
            <BadgeCheck size={18} />
          </span>
          <div>
            <div className="stat-value">{profile.data?.enabled === false ? 'Отключён' : 'Активен'}</div>
            <div className="stat-label">
              {profile.data?.emailVerified === false ? 'email не подтверждён' : 'аккаунт и email'}
            </div>
          </div>
        </Link>
        <Link to="/profile" className="card stat">
          <span className="stat-icon">
            <Users size={18} />
          </span>
          <div>
            <div className="stat-value">{me.groups.length || '—'}</div>
            <div className="stat-label">{plural(me.groups.length, 'группа', 'группы', 'групп')}</div>
          </div>
        </Link>
      </section>

      <div className="split">
        <section className="section">
          <div className="section-head">
            <h2>Избранные сервисы</h2>
            <Link to="/services">
              Каталог <ChevronRight size={15} />
            </Link>
          </div>
          {services.isPending && (
            <div className="grid">
              <Skeleton height={132} count={2} />
            </div>
          )}
          {services.isError && <p className="form-error">{errorMessage(services.error)}</p>}
          {services.isSuccess && favorites.length === 0 && (
            <EmptyState
              icon={Star}
              title="Пока пусто"
              text="Отметьте звёздочкой сервисы, которыми пользуетесь чаще всего, — они появятся здесь."
              action={
                <Link to="/services" className="btn">
                  Открыть каталог
                </Link>
              }
            />
          )}
          {favorites.length > 0 && (
            <div className="grid">
              {favorites.map((s) => (
                <ServiceCard key={s.id} service={s} />
              ))}
            </div>
          )}
        </section>

        <aside className="section">
          <div className="section-head">
            <h2>Быстрые действия</h2>
          </div>
          <ul className="card quick-list">
            <QuickLink to="/profile" icon={Camera} title="Обновить фото" text="Аватар для всех сервисов" />
            <QuickLink to="/profile" icon={UserRound} title="Личные данные" text="Имя, телефон, должность" />
            <QuickLink to="/people" icon={Users} title="Найти коллегу" text="Контакты и подразделения" />
            <QuickLink to="/security" icon={MonitorSmartphone} title="Сессии и устройства" text="Где выполнен вход" />
            <QuickLink
              href="/auth/action/UPDATE_PASSWORD"
              icon={KeyRound}
              title="Сменить пароль"
              text="Через Keycloak"
            />
            <QuickLink
              href="/auth/action/CONFIGURE_TOTP"
              icon={Smartphone}
              title="Настроить OTP"
              text="Второй фактор входа"
            />
          </ul>
        </aside>
      </div>
    </div>
  );
}

function QuickLink({
  to,
  href,
  icon: Icon,
  title,
  text,
}: {
  to?: string;
  href?: string;
  icon: typeof Camera;
  title: string;
  text: string;
}) {
  const body = (
    <>
      <span className="quick-icon">
        <Icon size={16} />
      </span>
      <span>
        <strong>{title}</strong>
        <small>{text}</small>
      </span>
      <ChevronRight size={16} className="chev" />
    </>
  );
  return <li>{to ? <Link to={to}>{body}</Link> : <a href={href}>{body}</a>}</li>;
}
