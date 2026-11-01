import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type CatalogService } from '../api';
import { initials } from '../lib/format';

export const servicesQueryKey = ['services'] as const;

export function ServiceIcon({ service, size = 44 }: { service: Pick<CatalogService, 'iconUrl' | 'name'>; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (service.iconUrl && !broken) {
    return (
      <img
        className="service-icon"
        src={service.iconUrl}
        alt=""
        width={size}
        height={size}
        onError={() => setBroken(true)}
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <span className="service-icon service-icon-fallback" style={{ width: size, height: size }} aria-hidden="true">
      {initials(service.name)}
    </span>
  );
}

export function ServiceCard({ service }: { service: CatalogService }) {
  const queryClient = useQueryClient();
  const favorite = useMutation({
    mutationFn: (value: boolean) => api.setFavorite(service.id, value),
    onMutate: async (value) => {
      await queryClient.cancelQueries({ queryKey: servicesQueryKey });
      queryClient.setQueryData<{ services: CatalogService[]; categories: string[] }>(servicesQueryKey, (old) =>
        old && { ...old, services: old.services.map((s) => (s.id === service.id ? { ...s, favorite: value } : s)) },
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: servicesQueryKey }),
  });

  return (
    <article className="service-card">
      <a className="service-link" href={service.launchUrl} target="_blank" rel="noopener noreferrer">
        <ServiceIcon service={service} />
        <div className="service-body">
          <h3>{service.name}</h3>
          {service.description && <p>{service.description}</p>}
          <div className="service-meta">
            {service.category && <span className="tag">{service.category}</span>}
            {service.status === 'maintenance' && <span className="tag tag-warn">Технические работы</span>}
          </div>
        </div>
      </a>
      <button
        className={`star${service.favorite ? ' star-on' : ''}`}
        aria-pressed={service.favorite}
        aria-label={service.favorite ? 'Убрать из избранного' : 'Добавить в избранное'}
        title={service.favorite ? 'Убрать из избранного' : 'Добавить в избранное'}
        onClick={() => favorite.mutate(!service.favorite)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
        </svg>
      </button>
    </article>
  );
}
