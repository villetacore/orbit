import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { api, errorMessage } from '../api';
import { ServiceCard, servicesQueryKey } from '../components/ServiceCard';
import { filterServices } from '../lib/filterServices';

export function Services() {
  const [params, setParams] = useSearchParams();
  const services = useQuery({ queryKey: servicesQueryKey, queryFn: api.services });
  const [query, setQuery] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const category = params.get('category') ?? '';
  const unavailable = params.get('unavailable');

  function setCategory(c: string) {
    const next = new URLSearchParams(params);
    if (c) next.set('category', c);
    else next.delete('category');
    next.delete('unavailable');
    setParams(next, { replace: true });
  }

  const visible = services.data ? filterServices(services.data.services, { query, category, favoritesOnly }) : [];

  return (
    <div className="page">
      <h1>Сервисы</h1>
      {unavailable && (
        <p className="banner banner-warn" role="status">
          Сервис «{unavailable}» недоступен для вашей учётной записи или отключён.
        </p>
      )}

      <div className="toolbar">
        <input
          className="search"
          type="search"
          placeholder="Поиск по названию или описанию"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Поиск сервисов"
        />
        <label className="toggle">
          <input type="checkbox" checked={favoritesOnly} onChange={(e) => setFavoritesOnly(e.target.checked)} />
          Только избранное
        </label>
      </div>

      {services.data && services.data.categories.length > 0 && (
        <div className="chips" role="group" aria-label="Категории">
          <button className={`chip${category === '' ? ' chip-on' : ''}`} onClick={() => setCategory('')}>
            Все
          </button>
          {services.data.categories.map((c) => (
            <button key={c} className={`chip${category === c ? ' chip-on' : ''}`} onClick={() => setCategory(c)}>
              {c}
            </button>
          ))}
        </div>
      )}

      {services.isPending && <p className="muted">Загрузка…</p>}
      {services.isError && <p className="form-error">{errorMessage(services.error)}</p>}
      {services.isSuccess && visible.length === 0 && <p className="empty">Ничего не найдено.</p>}
      <div className="grid">
        {visible.map((s) => (
          <ServiceCard key={s.id} service={s} />
        ))}
      </div>
    </div>
  );
}
