import { useMutation } from '@tanstack/react-query';
import { NavLink, Outlet } from 'react-router';
import { api } from '../api';
import { useMe } from '../auth';
import { Avatar } from './Avatar';

export function Layout() {
  const me = useMe();
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: ({ redirectUrl }) => window.location.assign(redirectUrl),
  });

  const links = [
    { to: '/', label: 'Главная', end: true },
    { to: '/services', label: 'Сервисы' },
    { to: '/profile', label: 'Профиль' },
    { to: '/security', label: 'Безопасность' },
    ...(me.isAdmin ? [{ to: '/admin', label: 'Администрирование' }] : []),
  ];

  return (
    <div className="shell">
      <header className="topbar">
        <NavLink to="/" className="brand" aria-label="Orbit — на главную">
          <OrbitMark />
          <span>Orbit</span>
        </NavLink>
        <nav className="nav" aria-label="Основная навигация">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className="nav-link">
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="account">
          <NavLink to="/profile" className="account-chip">
            <Avatar url={me.avatarUrl} name={me.name || me.username} size={32} />
            <span className="account-name">{me.name || me.username}</span>
          </NavLink>
          <button className="btn btn-ghost" onClick={() => logout.mutate()} disabled={logout.isPending}>
            Выйти
          </button>
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}

export function OrbitMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="6" fill="currentColor" />
      <ellipse
        cx="16"
        cy="16"
        rx="14"
        ry="6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        transform="rotate(-30 16 16)"
      />
    </svg>
  );
}
