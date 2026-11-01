import { useMutation } from '@tanstack/react-query';
import { LayoutDashboard, LayoutGrid, LogOut, Menu, Settings2, ShieldCheck, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { api } from '../api';
import { useMe } from '../auth';
import { Avatar } from './Avatar';
import { BrandMark } from './ui';

export function Layout() {
  const me = useMe();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: ({ redirectUrl }) => window.location.assign(redirectUrl),
  });

  useEffect(() => setOpen(false), [pathname]);

  const displayName = me.name || me.username;
  const links = [
    { to: '/', label: 'Главная', icon: LayoutDashboard, end: true },
    { to: '/services', label: 'Сервисы', icon: LayoutGrid },
    { to: '/profile', label: 'Профиль', icon: UserRound },
    { to: '/security', label: 'Безопасность', icon: ShieldCheck },
  ];

  return (
    <div className="app">
      <aside className={`sidebar${open ? ' open' : ''}`}>
        <NavLink to="/" className="brand" aria-label="Orbit — на главную">
          <BrandMark />
          Orbit
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
              <div className="nav-section">Управление</div>
              <NavLink to="/admin" className="nav-link">
                <Settings2 size={18} />
                Администрирование
              </NavLink>
            </>
          )}
        </nav>
        <div className="sidebar-foot">
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
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}

      <div className="main">
        <header className="mobilebar">
          <button className="icon-btn" onClick={() => setOpen(true)} aria-label="Открыть меню">
            <Menu size={20} />
          </button>
          <NavLink to="/" className="brand">
            <BrandMark size={16} />
            Orbit
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
