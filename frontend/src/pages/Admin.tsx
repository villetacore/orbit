import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api, errorMessage, type AdminService, type ServiceInput, type ServiceStatus } from '../api';
import { ServiceIcon, servicesQueryKey } from '../components/ServiceCard';
import { formatDateTime } from '../lib/format';

const adminServicesKey = ['admin', 'services'] as const;

const statusLabels: Record<ServiceStatus, string> = {
  active: 'Активен',
  maintenance: 'Техработы',
  hidden: 'Скрыт',
};

const emptyInput: ServiceInput = {
  slug: '',
  name: '',
  description: '',
  url: '',
  iconUrl: '',
  category: '',
  status: 'active',
  requiredRoles: [],
  sortOrder: 0,
};

export function Admin() {
  const [tab, setTab] = useState<'catalog' | 'audit'>('catalog');
  return (
    <div className="page">
      <h1>Администрирование</h1>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'catalog'} className="tab" onClick={() => setTab('catalog')}>
          Каталог сервисов
        </button>
        <button role="tab" aria-selected={tab === 'audit'} className="tab" onClick={() => setTab('audit')}>
          Журнал аудита
        </button>
      </div>
      {tab === 'catalog' ? <CatalogAdmin /> : <AuditLog />}
    </div>
  );
}

function CatalogAdmin() {
  const queryClient = useQueryClient();
  const services = useQuery({ queryKey: adminServicesKey, queryFn: api.admin.services });
  const [editing, setEditing] = useState<AdminService | 'new' | null>(null);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: adminServicesKey });
    void queryClient.invalidateQueries({ queryKey: servicesQueryKey });
  };

  const remove = useMutation({
    mutationFn: (id: string) => api.admin.deleteService(id),
    onSuccess: invalidate,
  });

  return (
    <section className="card">
      <div className="section-head">
        <h2>Сервисы</h2>
        <button className="btn btn-primary" onClick={() => setEditing('new')}>
          Добавить сервис
        </button>
      </div>
      {services.isPending && <p className="muted">Загрузка…</p>}
      {services.isError && <p className="form-error">{errorMessage(services.error)}</p>}
      {remove.isError && <p className="form-error">{errorMessage(remove.error)}</p>}
      {services.data && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Сервис</th>
                <th>Категория</th>
                <th>Статус</th>
                <th>Доступ</th>
                <th aria-label="Действия" />
              </tr>
            </thead>
            <tbody>
              {services.data.services.map((s) => (
                <tr key={s.id}>
                  <td>
                    <div className="cell-service">
                      <ServiceIcon service={s} size={28} />
                      <div>
                        <strong>{s.name}</strong>
                        <div className="muted small">{s.url}</div>
                      </div>
                    </div>
                  </td>
                  <td>{s.category || '—'}</td>
                  <td>
                    <span className={`tag ${s.status === 'active' ? 'tag-ok' : 'tag-warn'}`}>{statusLabels[s.status]}</span>
                  </td>
                  <td>{s.requiredRoles.length ? s.requiredRoles.join(', ') : 'Все сотрудники'}</td>
                  <td className="cell-actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditing(s)}>
                      Изменить
                    </button>
                    <button
                      className="btn btn-ghost btn-sm btn-danger"
                      onClick={() => {
                        if (window.confirm(`Удалить сервис «${s.name}»?`)) remove.mutate(s.id);
                      }}
                    >
                      Удалить
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <ServiceForm
          service={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            invalidate();
          }}
        />
      )}
    </section>
  );
}

function ServiceForm({
  service,
  onClose,
  onSaved,
}: {
  service: AdminService | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [input, setInput] = useState<ServiceInput>(() => (service ? { ...emptyInput, ...pickInput(service) } : emptyInput));
  const [roles, setRoles] = useState(input.requiredRoles.join(', '));

  const save = useMutation({
    mutationFn: (data: ServiceInput) => (service ? api.admin.updateService(service.id, data) : api.admin.createService(data)),
    onSuccess: onSaved,
  });

  function set<K extends keyof ServiceInput>(key: K, value: ServiceInput[K]) {
    setInput((prev) => ({ ...prev, [key]: value }));
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const requiredRoles = roles
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);
    save.mutate({ ...input, requiredRoles });
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Сервис">
      <form className="modal form" onSubmit={onSubmit}>
        <h2>{service ? 'Изменить сервис' : 'Новый сервис'}</h2>
        <div className="form-row">
          <label>
            Название
            <input value={input.name} onChange={(e) => set('name', e.target.value)} required maxLength={100} />
          </label>
          <label>
            Slug
            <input
              value={input.slug}
              onChange={(e) => set('slug', e.target.value)}
              required
              pattern="[a-z0-9][a-z0-9\-]{1,49}"
              title="2–50 символов: строчные латинские буквы, цифры, дефис"
            />
          </label>
        </div>
        <label>
          URL
          <input type="url" value={input.url} onChange={(e) => set('url', e.target.value)} required placeholder="https://" />
        </label>
        <label>
          Описание
          <textarea value={input.description} onChange={(e) => set('description', e.target.value)} maxLength={500} rows={3} />
        </label>
        <div className="form-row">
          <label>
            Категория
            <input value={input.category} onChange={(e) => set('category', e.target.value)} maxLength={50} />
          </label>
          <label>
            Иконка (URL)
            <input type="url" value={input.iconUrl} onChange={(e) => set('iconUrl', e.target.value)} placeholder="https://" />
          </label>
        </div>
        <div className="form-row">
          <label>
            Статус
            <select value={input.status} onChange={(e) => set('status', e.target.value as ServiceStatus)}>
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Порядок
            <input type="number" value={input.sortOrder} onChange={(e) => set('sortOrder', Number(e.target.value))} />
          </label>
        </div>
        <label>
          Роли с доступом
          <input value={roles} onChange={(e) => setRoles(e.target.value)} placeholder="Пусто — доступен всем сотрудникам" />
          <span className="hint">Роли realm в Keycloak через запятую; достаточно любой из них.</span>
        </label>
        {save.isError && (
          <p className="form-error" role="alert" style={{ whiteSpace: 'pre-line' }}>
            {errorMessage(save.error)}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </form>
    </div>
  );
}

function pickInput(s: AdminService): ServiceInput {
  const { slug, name, description, url, iconUrl, category, status, requiredRoles, sortOrder } = s;
  return { slug, name, description, url, iconUrl, category, status, requiredRoles, sortOrder };
}

function AuditLog() {
  const audit = useInfiniteQuery({
    queryKey: ['admin', 'audit'],
    queryFn: ({ pageParam }) => api.admin.audit(pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.events.length === 50 ? last.events[last.events.length - 1]!.id : undefined),
  });
  const events = audit.data?.pages.flatMap((p) => p.events) ?? [];

  return (
    <section className="card">
      <div className="section-head">
        <h2>Последние события</h2>
        <button className="btn btn-ghost" onClick={() => audit.refetch()}>
          Обновить
        </button>
      </div>
      {audit.isPending && <p className="muted">Загрузка…</p>}
      {audit.isError && <p className="form-error">{errorMessage(audit.error)}</p>}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Время</th>
              <th>Действие</th>
              <th>Объект</th>
              <th>Пользователь</th>
              <th>IP</th>
              <th>Детали</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td className="nowrap">{formatDateTime(e.occurredAt)}</td>
                <td>
                  <code>{e.action}</code>
                </td>
                <td>{e.target}</td>
                <td className="small">
                  <code>{e.actorSub}</code>
                </td>
                <td>{e.ip}</td>
                <td className="small">{Object.keys(e.details).length ? JSON.stringify(e.details) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {audit.hasNextPage && (
        <button className="btn" onClick={() => audit.fetchNextPage()} disabled={audit.isFetchingNextPage}>
          Показать ещё
        </button>
      )}
    </section>
  );
}
