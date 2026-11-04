import { useMutation, useQuery } from '@tanstack/react-query';
import { Badge, Drawer, IconButton } from '@villetacore/velessoft-ui';
import {
  KeyRound,
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
import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { api } from '@/api';
import { useMe } from '@/auth';
import { useBranding } from '@/branding';
import { Avatar } from './Avatar';
import { NavLink } from './NavLink';
import { Brand, Signature, ThemeSwitch } from './ui';

function Navigation({ pendingCount }: { pendingCount: number }) {
  const me = useMe();
  const links = [
    { to: '/', label: 'Главная', icon: LayoutDashboard, end: true },
    { to: '/services', label: 'Сервисы', icon: LayoutGrid },
    { to: '/people', label: 'Люди', icon: Users },
    { to: '/profile', label: 'Профиль', icon: UserRound },
    { to: '/security', label: 'Безопасность', icon: ShieldCheck },
  ];
  return (
    <nav aria-label="Основная навигация">
      <ul className="vs-nav-list">
        {links.map(({ to, label, icon: Icon, end }) => (
          <li key={to}>
            <NavLink href={to} exact={end} className="nav-link">
              <Icon size={16} />
              <span>{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
      {me.isAdmin && (
        <>
          <div className="nav-section">/ управление</div>
          <ul className="vs-nav-list">
            <li>
              <NavLink href="/admin" className="nav-link">
                <Settings2 size={16} />
                <span>Администрирование</span>
                {pendingCount > 0 && (
                  <Badge tone="warning" variant="solid" title={`Заявок на регистрацию: ${pendingCount}`}>
                    {pendingCount}
                  </Badge>
                )}
              </NavLink>
            </li>
            <li>
              <NavLink href="/keycloak" className="nav-link">
                <KeyRound size={16} />
                <span>Keycloak</span>
              </NavLink>
            </li>
          </ul>
        </>
      )}
    </nav>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const me = useMe();
  const branding = useBranding();
  const support = branding.supportUrl || (branding.supportEmail && `mailto:${branding.supportEmail}`);
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const logout = useMutation({
    mutationFn: api.logout,
    // A full reload drops everything cached for this user.
    onSuccess: () => window.location.assign('/'),
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

  const foot = (
    <div className="sidebar-foot">
      <ThemeSwitch />
      {support && (
        <a className="vs-button vs-ghost vs-sm vs-block with-icon" href={support} target="_blank" rel="noopener noreferrer">
          <LifeBuoy size={16} />
          Поддержка
        </a>
      )}
      <div className="user-card">
        <Link href="/profile" className="user-card-link">
          <Avatar url={me.avatarUrl} name={displayName} size={36} />
          <span className="user-card-text">
            <strong>{displayName}</strong>
            <small>{me.email || me.username}</small>
          </span>
        </Link>
        <IconButton label="Выйти" variant="ghost" onClick={() => logout.mutate()} disabled={logout.isPending}>
          <LogOut size={16} />
        </IconButton>
      </div>
      <Signature />
    </div>
  );

  return (
    <div className="app">
      <aside className="sidebar">
        <Link href="/" className="brand" aria-label={`${branding.appName} — на главную`}>
          <Brand />
        </Link>
        <Navigation pendingCount={pendingCount} />
        {foot}
      </aside>

      <Drawer open={open} onClose={() => setOpen(false)} title={branding.appName} side="left" className="nav-drawer">
        <Navigation pendingCount={pendingCount} />
        {foot}
      </Drawer>

      <div className="main">
        <header className="mobilebar vs-glass">
          <IconButton label="Открыть меню" variant="ghost" onClick={() => setOpen(true)}>
            <Menu size={18} />
          </IconButton>
          <Link href="/" className="brand">
            <Brand markSize={16} />
          </Link>
          <Link href="/profile" aria-label="Профиль">
            <Avatar url={me.avatarUrl} name={displayName} size={30} />
          </Link>
        </header>
        <main className="content">
          {children}
        </main>
      </div>
    </div>
  );
}
