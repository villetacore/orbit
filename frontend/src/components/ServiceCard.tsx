import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Star } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { api, type CatalogService } from '../api';
import { hueFor, initials } from '../lib/format';

export const servicesQueryKey = ['services'] as const;

type IconSource = Pick<CatalogService, 'iconUrl' | 'name' | 'slug'>;

export function ServiceIcon({ service, size = 44 }: { service: IconSource; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (service.iconUrl && !broken) {
    return (
      <img
        className="tile"
        src={service.iconUrl}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size }}
        onError={() => setBroken(true)}
        referrerPolicy="no-referrer"
      />
    );
  }
  const style = {
    width: size,
    height: size,
    fontSize: size * 0.34,
    '--hue': hueFor(service.slug),
  } as CSSProperties;
  return (
    <span className="tile" style={style} aria-hidden="true">
      {initials(service.name)}
    </span>
  );
}

export function StatusBadge({ status }: { status: CatalogService['status'] }) {
  if (status === 'maintenance') {
    return (
      <span className="badge badge-warn">
        <span className="dot" />
        Техработы
      </span>
    );
  }
  if (status === 'hidden') {
    return (
      <span className="badge">
        <span className="dot" />
        Скрыт
      </span>
    );
  }
  return (
    <span className="badge badge-ok">
      <span className="dot" />
      Активен
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
  const label = service.favorite ? 'Убрать из избранного' : 'Добавить в избранное';

  return (
    <article className="svc">
      <a className="svc-main" href={service.launchUrl} target="_blank" rel="noopener noreferrer">
        <ServiceIcon service={service} />
        <div>
          <div className="svc-title">
            {service.name}
            <ArrowUpRight size={15} className="svc-ext" />
          </div>
          {service.description && <p className="svc-desc clamp-2">{service.description}</p>}
        </div>
      </a>
      <div className="svc-foot">
        {service.category && <span className="badge">{service.category}</span>}
        {service.status === 'maintenance' && <StatusBadge status="maintenance" />}
      </div>
      <button
        className={`star${service.favorite ? ' star-on' : ''}`}
        aria-pressed={service.favorite}
        aria-label={label}
        title={label}
        onClick={() => favorite.mutate(!service.favorite)}
      >
        <Star size={18} />
      </button>
    </article>
  );
}
