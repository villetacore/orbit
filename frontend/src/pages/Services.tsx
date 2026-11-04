import { useQuery } from '@tanstack/react-query';
import { Alert, Button, EmptyState, Grid, PageHeader, SearchInput, SegmentedControl, Toggle } from '@villetacore/velessoft-ui';
import { RotateCcw, SearchX, Star } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { api } from '../api';
import { ServiceCard, servicesQueryKey } from '../components/ServiceCard';
import { ErrorAlert, Loading } from '../components/ui';
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
            ? `${all.length} ${plural(all.length, 'сервис доступен', 'сервиса доступно', 'сервисов доступно')} вашей учётной записи.`
            : 'Корпоративные приложения с единым входом.'
        }
      />

      {unavailable && <Alert tone="warning">Сервис «{unavailable}» недоступен для вашей учётной записи или отключён.</Alert>}

      <div className="filters">
        <SearchInput
          label="Поиск сервисов"
          clearLabel="Очистить поиск"
          placeholder="Название, описание или категория"
          value={query}
          onValueChange={setQuery}
        />
        <SegmentedControl
          label="Показывать"
          value={favoritesOnly ? 'favorites' : 'all'}
          onChange={(v) => setParam('favorites', v === 'favorites' ? '1' : '')}
          options={[
            { value: 'all', label: 'Все' },
            { value: 'favorites', label: 'Избранное' },
          ]}
        />
      </div>

      {services.data && services.data.categories.length > 1 && (
        <div className="chips" role="group" aria-label="Категории">
          <Toggle size="sm" pressed={category === ''} onPressedChange={() => setParam('category', '')}>
            Все категории
          </Toggle>
          {services.data.categories.map((c) => (
            <Toggle key={c} size="sm" pressed={category === c} onPressedChange={() => setParam('category', category === c ? '' : c)}>
              {c} · {counts.get(c)}
            </Toggle>
          ))}
        </div>
      )}

      {services.isPending && (
        <Grid min={260}>
          <Loading height={140} count={6} />
        </Grid>
      )}
      <ErrorAlert error={services.error} />
      {services.isSuccess && visible.length === 0 && (
        <EmptyState
          icon={favoritesOnly && !query ? <Star size={20} /> : <SearchX size={20} />}
          title={favoritesOnly && !query ? 'В избранном пока ничего нет' : 'Ничего не найдено'}
          description={
            favoritesOnly && !query
              ? 'Нажмите на звёздочку у сервиса, чтобы закрепить его здесь и на главной.'
              : query
                ? `По запросу «${query}» ничего нет. Измените запрос или сбросьте фильтры.`
                : 'В этой подборке нет сервисов.'
          }
          actions={
            <Button
              className="with-icon"
              onClick={() => {
                setQuery('');
                setParams(new URLSearchParams(), { replace: true });
              }}
            >
              <RotateCcw size={16} />
              Сбросить фильтры
            </Button>
          }
        />
      )}

      {visible.length > 0 && (
        <Grid min={260}>
          {visible.map((s) => (
            <ServiceCard key={s.id} service={s} />
          ))}
        </Grid>
      )}
    </div>
  );
}
