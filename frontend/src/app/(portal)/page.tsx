'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, EmptyState, Grid, PageHeader, Stat } from '@villetacore/velessoft-ui';
import { Camera, ChevronRight, KeyRound, LayoutGrid, MonitorSmartphone, Pencil, Smartphone, Star, UserRound, Users } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/api';
import { useMe } from '@/auth';
import { Avatar } from '@/components/Avatar';
import { ServiceCard, servicesQueryKey } from '@/components/ServiceCard';
import { ErrorAlert, LinkButton, Loading } from '@/components/ui';
import { greeting, plural } from '@/lib/format';

const quickLinks = [
  { to: '/profile', icon: Camera, title: 'Обновить фото', text: 'Аватар для всех сервисов' },
  { to: '/profile', icon: UserRound, title: 'Личные данные', text: 'Имя, телефон, должность' },
  { to: '/people', icon: Users, title: 'Найти коллегу', text: 'Контакты и подразделения' },
  { to: '/security', icon: MonitorSmartphone, title: 'Сессии и устройства', text: 'Где выполнен вход' },
  { to: '/security', icon: KeyRound, title: 'Сменить пароль', text: 'Прямо здесь, в Orbit' },
  { to: '/security', icon: Smartphone, title: 'Настроить OTP', text: 'Второй фактор входа' },
];

export default function Dashboard() {
  const me = useMe();
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
      <div className="hello">
        <Avatar url={me.avatarUrl} name={displayName} size={64} />
        <PageHeader
          eyebrow={new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'long' })}
          title={
            <>
              {greeting()}, {firstName}
              <span className="title-mark"> /_</span>
            </>
          }
          description={subtitle}
          actions={
            <>
              <LinkButton to="/services" variant="primary">
                <LayoutGrid size={16} />
                Все сервисы
              </LinkButton>
              <LinkButton to="/profile">
                <Pencil size={16} />
                Профиль
              </LinkButton>
            </>
          }
        />
      </div>

      <Grid min={180}>
        <Stat
          label={plural(all.length, 'доступный сервис', 'доступных сервиса', 'доступных сервисов')}
          value={services.isSuccess ? all.length : '—'}
        />
        <Stat label="в избранном" value={services.isSuccess ? favorites.length : '—'} />
        <Stat
          label="аккаунт"
          value={profile.data?.enabled === false ? 'Отключён' : 'Активен'}
          delta={profile.data?.emailVerified === false ? 'email не подтверждён' : 'email подтверждён'}
          tone={profile.data?.emailVerified === false ? 'warning' : 'success'}
        />
        <Stat label={plural(me.groups.length, 'группа', 'группы', 'групп')} value={me.groups.length || '—'} />
      </Grid>

      <div className="split">
        <section className="section">
          <div className="section-head">
            <h2>Избранные сервисы</h2>
            <Link className="vs-link" href="/services">
              Каталог
            </Link>
          </div>
          {services.isPending && (
            <Grid min={260}>
              <Loading height={132} count={2} />
            </Grid>
          )}
          <ErrorAlert error={services.error} />
          {services.isSuccess && favorites.length === 0 && (
            <EmptyState
              icon={<Star size={20} />}
              title="Пока пусто"
              description="Отметьте звёздочкой сервисы, которыми пользуетесь чаще всего, — они появятся здесь."
              actions={<LinkButton to="/services">Открыть каталог</LinkButton>}
            />
          )}
          {favorites.length > 0 && (
            <Grid min={260}>
              {favorites.map((s) => (
                <ServiceCard key={s.id} service={s} />
              ))}
            </Grid>
          )}
        </section>

        <aside className="section">
          <div className="section-head">
            <h2>Быстрые действия</h2>
          </div>
          <Card flat className="list-card">
            <ul className="link-list">
              {quickLinks.map(({ to, icon: Icon, title, text }) => (
                <li key={title}>
                  <Link href={to}>
                    <Icon size={16} />
                    <span className="row-text">
                      <strong>{title}</strong>
                      <small>{text}</small>
                    </span>
                    <ChevronRight size={16} />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </aside>
      </div>
    </div>
  );
}
