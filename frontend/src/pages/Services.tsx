import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Search, SearchX, Star } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api, errorMessage } from '../api';
import { ServiceCard, servicesQueryKey } from '../components/ServiceCard';
import { EmptyState, PageHeader, Skeleton } from '../components/ui';
import { filterServices } from '../lib/filterServices';
import { plural } from '../lib/format';

export function Services() {
  const [params, setParams] = useSearchParams();
  const services = useQuery({ queryKey: servicesQueryKey, queryFn: api.services });
  const [query, setQuery] = useState('');
  const category = params.get('category') ?? '';
  const favoritesOnly = params.get('favorites') === '1';
  const unavailable = params.get('unavailable');

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('unavailable');
    setParams(next, { replace: true });
  }

  const all = services.data?.services ?? [];
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of all) m.set(s.category, (m.get(s.category) ?? 0) + 1);
    return m;
  }, [all]);
  const visible = filterServices(all, { query, category, favoritesOnly });

  return (
    <div className="page">
      <PageHeader
        title="Сервисы"
        description={
          services.isSuccess
            ? `${all.length} ${plural(all.length, 'сервис доступен', 'сервиса доступно', 'сервисов доступно')} вашей учётной записи. Вход — автоматически, через единый аккаунт.`
            : 'Корпоративные приложения с единым входом.'
        }
      />

      {unavailable && (
        <div className="alert alert-warn" role="status">
          <AlertTriangle size={16} />
          <span>Сервис «{unavailable}» недоступен для вашей учётной записи или отключён.</span>
        </div>
      )}

      <div className="section">
        <div className="toolbar">
          <label className="input-icon">
            <Search size={16} />
            <input
              type="search"
              placeholder="Поиск по названию, описанию или категории"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Поиск сервисов"
            />
          </label>
          <div className="segmented" role="group" aria-label="Фильтр">
            <button aria-pressed={!favoritesOnly} onClick={() => setParam('favorites', '')}>
              Все
            </button>
            <button aria-pressed={favoritesOnly} onClick={() => setParam('favorites', '1')}>
              <Star size={14} />
              Избранное
            </button>
          </div>
        </div>

        {services.data && services.data.categories.length > 1 && (
          <div className="chips" role="group" aria-label="Категории">
            <button className={`chip${category === '' ? ' chip-on' : ''}`} onClick={() => setParam('category', '')}>
              Все категории
            </button>
            {services.data.categories.map((c) => (
              <button
                key={c}
                className={`chip${category === c ? ' chip-on' : ''}`}
                onClick={() => setParam('category', category === c ? '' : c)}
              >
                {c}
                <span className="chip-count">{counts.get(c)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {services.isPending && (
        <div className="grid">
          <Skeleton height={140} count={6} />
        </div>
      )}
      {services.isError && <p className="form-error">{errorMessage(services.error)}</p>}
      {services.isSuccess && visible.length === 0 && (
        <EmptyState
          icon={favoritesOnly && !query ? Star : SearchX}
          title={favoritesOnly && !query ? 'В избранном пока ничего нет' : 'Ничего не найдено'}
          text={
            favoritesOnly && !query
              ? 'Нажмите на звёздочку у сервиса, чтобы закрепить его здесь и на главной.'
              : 'Попробуйте изменить запрос или выбрать другую категорию.'
          }
        />
      )}

      {visible.length > 0 && (
        <div className="grid">
          {visible.map((s) => (
            <ServiceCard key={s.id} service={s} />
          ))}
        </div>
      )}
    </div>
  );
}
