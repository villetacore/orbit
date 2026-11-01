import type { CatalogService } from '../api';

export interface ServiceFilter {
  query: string;
  category: string; // '' = all
  favoritesOnly: boolean;
}

// filterServices narrows the list the server already authorized; it is a
// convenience for the user, not an access control.
export function filterServices(services: CatalogService[], f: ServiceFilter): CatalogService[] {
  const q = f.query.trim().toLocaleLowerCase('ru');
  return services.filter((s) => {
    if (f.favoritesOnly && !s.favorite) return false;
    if (f.category && s.category !== f.category) return false;
    if (!q) return true;
    return [s.name, s.description, s.category].some((v) => v.toLocaleLowerCase('ru').includes(q));
  });
}
