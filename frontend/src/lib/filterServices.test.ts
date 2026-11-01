import { describe, expect, it } from 'vitest';
import type { CatalogService } from '../api';
import { filterServices } from './filterServices';
import { initials } from './format';

const svc = (over: Partial<CatalogService>): CatalogService => ({
  id: over.slug ?? 'x',
  slug: 'x',
  name: 'X',
  description: '',
  iconUrl: '',
  category: '',
  status: 'active',
  favorite: false,
  launchUrl: '/go/x',
  ...over,
});

const services = [
  svc({ slug: 'wiki', name: 'База знаний', description: 'Регламенты', category: 'Документы', favorite: true }),
  svc({ slug: 'git', name: 'Git', description: 'Репозитории', category: 'Разработка' }),
  svc({ slug: 'hr', name: 'HR-портал', description: 'Отпуска', category: 'Сотрудникам' }),
];

describe('filterServices', () => {
  const none = { query: '', category: '', favoritesOnly: false };

  it('returns everything without filters', () => {
    expect(filterServices(services, none)).toHaveLength(3);
  });

  it('searches name, description and category case-insensitively', () => {
    expect(filterServices(services, { ...none, query: 'РЕГЛАМ' }).map((s) => s.slug)).toEqual(['wiki']);
    expect(filterServices(services, { ...none, query: 'разраб' }).map((s) => s.slug)).toEqual(['git']);
  });

  it('combines category and favorites filters', () => {
    expect(filterServices(services, { ...none, category: 'Разработка' }).map((s) => s.slug)).toEqual(['git']);
    expect(filterServices(services, { ...none, favoritesOnly: true }).map((s) => s.slug)).toEqual(['wiki']);
    expect(filterServices(services, { query: '', category: 'Разработка', favoritesOnly: true })).toEqual([]);
  });
});

describe('initials', () => {
  it('uses first letters of two words or two letters of one', () => {
    expect(initials('Алиса Иванова')).toBe('АИ');
    expect(initials('alice')).toBe('AL');
    expect(initials('  ')).toBe('?');
  });
});
