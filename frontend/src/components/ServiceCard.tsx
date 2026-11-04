import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge, Card, IconButton } from '@villetacore/velessoft-ui';
import { ArrowUpRight, Star } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { api, type CatalogService } from '@/api';
import { hueFor, initials } from '@/lib/format';

export const servicesQueryKey = ['services'] as const;

type IconSource = Pick<CatalogService, 'iconUrl' | 'name' | 'slug'>;

export function ServiceIcon({ service, size = 40 }: { service: IconSource; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (service.iconUrl && !broken) {
    return (
      <img
        className="tile"
        src={service.iconUrl}
        alt=""
        style={{ width: size, height: size }}
        onError={() => setBroken(true)}
        referrerPolicy="no-referrer"
      />
    );
  }
  const style = { width: size, height: size, fontSize: size * 0.34, '--hue': hueFor(service.slug) } as CSSProperties;
  return (
    <span className="tile tile-empty" style={style} aria-hidden="true">
      {initials(service.name)}
    </span>
  );
}

export function StatusBadge({ status }: { status: CatalogService['status'] }) {
  if (status === 'maintenance') {
    return (
      <Badge tone="warning" dot>
        Техработы
      </Badge>
    );
  }
  if (status === 'hidden') return <Badge dot>Скрыт</Badge>;
  return (
    <Badge tone="success" dot>
      Активен
    </Badge>
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
    <Card flat className="svc">
      <a className="svc-main" href={service.launchUrl} target="_blank" rel="noopener noreferrer">
        <ServiceIcon service={service} />
        <span className="svc-text">
          <strong>
            {service.name}
            <ArrowUpRight size={14} />
          </strong>
          {service.description && <small className="clamp-2">{service.description}</small>}
        </span>
      </a>
      <div className="svc-foot">
        <span className="chips">
          {service.category && <Badge>{service.category}</Badge>}
          {service.status === 'maintenance' && <StatusBadge status="maintenance" />}
        </span>
        <IconButton
          size="sm"
          variant="ghost"
          label={service.favorite ? 'Убрать из избранного' : 'Добавить в избранное'}
          aria-pressed={service.favorite}
          className={service.favorite ? 'star-on' : undefined}
          onClick={() => favorite.mutate(!service.favorite)}
        >
          <Star size={16} />
        </IconButton>
      </div>
    </Card>
  );
}
