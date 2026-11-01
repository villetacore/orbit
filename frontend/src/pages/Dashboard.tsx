import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api, errorMessage } from '../api';
import { useMe } from '../auth';
import { Avatar } from '../components/Avatar';
import { ServiceCard, servicesQueryKey } from '../components/ServiceCard';

export function Dashboard() {
  const me = useMe();
  const services = useQuery({ queryKey: servicesQueryKey, queryFn: api.services });
  const favorites = services.data?.services.filter((s) => s.favorite) ?? [];
  const firstName = me.name.split(' ')[0] || me.username;

  return (
    <div className="page">
      <section className="hero">
        <Avatar url={me.avatarUrl} name={me.name || me.username} size={72} />
        <div>
          <h1>Здравствуйте, {firstName}</h1>
          <p className="muted">
            {me.email}
            {me.groups.length > 0 && <> · {me.groups.join(', ')}</>}
          </p>
        </div>
        <Link to="/profile" className="btn hero-action">
          Редактировать профиль
        </Link>
      </section>

      <section>
        <div className="section-head">
          <h2>Избранные сервисы</h2>
          <Link to="/services">Все сервисы →</Link>
        </div>
        {services.isPending && <p className="muted">Загрузка…</p>}
        {services.isError && <p className="form-error">{errorMessage(services.error)}</p>}
        {services.isSuccess && favorites.length === 0 && (
          <div className="empty">
            <p>Здесь появятся сервисы, отмеченные звёздочкой.</p>
            <Link to="/services" className="btn">
              Открыть каталог
            </Link>
          </div>
        )}
        <div className="grid">
          {favorites.map((s) => (
            <ServiceCard key={s.id} service={s} />
          ))}
        </div>
      </section>

      <section className="quick">
        <Link to="/security" className="quick-card">
          <h3>Безопасность</h3>
          <p>Пароль, двухфакторная аутентификация и активные сессии.</p>
        </Link>
        <Link to="/profile" className="quick-card">
          <h3>Профиль</h3>
          <p>Имя, контакты и фото, которые видят коллеги и сервисы.</p>
        </Link>
      </section>
    </div>
  );
}
