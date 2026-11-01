import { useMutation, useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard,
  LayoutGrid,
  LifeBuoy,
  LogOut,
  Menu,
  Settings2,
  ShieldCheck,
  UserRound,
  Users,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { api } from '../api';
import { useMe } from '../auth';
import { useBranding } from '../branding';
import { Avatar } from './Avatar';
import { Brand, Signature, ThemeSwitch } from './ui';

export function Layout() {
  const me = useMe();
  const branding = useBranding();
  const support = branding.supportUrl || (branding.supportEmail && `mailto:${branding.supportEmail}`);
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: ({ redirectUrl }) => window.location.assign(redirectUrl),
  });

  useEffect(() => setOpen(false), [pathname]);
  const pending = useQuery({
    queryKey: ['admin', 'registrations', 'pending'],
    queryFn: () => api.admin.registrations('pending'),
    enabled: me.isAdmin,
    refetchInterval: 60_000,
  });
  const pendingCount = pending.data?.registrations.length ?? 0;

  const displayName = me.name || me.username;
  const links = [
    { to: '/', label: 'Главная', icon: LayoutDashboard, end: true },
    { to: '/services', label: 'Сервисы', icon: LayoutGrid },
    { to: '/people', label: 'Люди', icon: Users },
    { to: '/profile', label: 'Профиль', icon: UserRound },
    { to: '/security', label: 'Безопасность', icon: ShieldCheck },
  ];

  return (
    <div className="app">
      <aside className={`sidebar${open ? ' open' : ''}`}>
        <NavLink to="/" className="brand" aria-label={`${branding.appName} — на главную`}>
          <Brand />
        </NavLink>
        <nav className="nav" aria-label="Основная навигация">
          {links.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className="nav-link">
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
          {me.isAdmin && (
            <>
              <div className="nav-section eyebrow">Управление</div>
              <NavLink to="/admin" className="nav-link">
                <Settings2 size={18} />
                Администрирование
                {pendingCount > 0 && (
                  <span className="count" title={`Заявок на регистрацию: ${pendingCount}`}>
                    {pendingCount}
                  </span>
                )}
              </NavLink>
            </>
          )}
        </nav>
        <div className="sidebar-foot">
          <ThemeSwitch />
          {support && (
            <a className="support-link" href={support} target="_blank" rel="noopener noreferrer">
              <LifeBuoy size={16} />
              Поддержка
            </a>
          )}
          <div className="user-card">
            <NavLink to="/profile" className="user-card-link">
              <Avatar url={me.avatarUrl} name={displayName} size={36} />
              <span className="user-card-text">
                <strong>{displayName}</strong>
                <span>{me.email || me.username}</span>
              </span>
            </NavLink>
            <button
              className="icon-btn"
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
              aria-label="Выйти"
              title="Выйти"
            >
              <LogOut size={18} />
            </button>
          </div>
          <Signature />
        </div>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}

      <div className="main">
        <header className="mobilebar">
          <button className="icon-btn" onClick={() => setOpen(true)} aria-label="Открыть меню">
            <Menu size={20} />
          </button>
          <NavLink to="/" className="brand">
            <Brand markSize={16} />
          </NavLink>
          <NavLink to="/profile" aria-label="Профиль">
            <Avatar url={me.avatarUrl} name={displayName} size={30} />
          </NavLink>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
