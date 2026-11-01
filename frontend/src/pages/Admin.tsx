import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutGrid, Pencil, Plus, RefreshCw, ScrollText, Trash2 } from 'lucide-react';
import { useCallback, useState, type FormEvent } from 'react';
import { api, errorMessage, type AdminService, type AuditEvent, type ServiceInput, type ServiceStatus } from '../api';
import { ServiceIcon, StatusBadge, servicesQueryKey } from '../components/ServiceCard';
import { Drawer, EmptyState, PageHeader, Skeleton } from '../components/ui';
import { formatDateTime, formatRelative } from '../lib/format';

const adminServicesKey = ['admin', 'services'] as const;

const statusLabels: Record<ServiceStatus, string> = {
  active: 'Активен',
  maintenance: 'Технические работы',
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
  const [editing, setEditing] = useState<AdminService | 'new' | null>(null);

  return (
    <div className="page">
      <PageHeader
        title="Администрирование"
        description="Каталог корпоративных сервисов и журнал важных действий."
        actions={
          tab === 'catalog' && (
            <button className="btn btn-primary" onClick={() => setEditing('new')}>
              <Plus size={16} />
              Добавить сервис
            </button>
          )
        }
      />
      <div className="segmented" role="tablist" style={{ alignSelf: 'flex-start' }}>
        <button role="tab" aria-selected={tab === 'catalog'} onClick={() => setTab('catalog')}>
          <LayoutGrid size={15} />
          Каталог
        </button>
        <button role="tab" aria-selected={tab === 'audit'} onClick={() => setTab('audit')}>
          <ScrollText size={15} />
          Журнал аудита
        </button>
      </div>
      {tab === 'catalog' ? <CatalogAdmin editing={editing} setEditing={setEditing} /> : <AuditLog />}
    </div>
  );
}

function CatalogAdmin({
  editing,
  setEditing,
}: {
  editing: AdminService | 'new' | null;
  setEditing: (v: AdminService | 'new' | null) => void;
}) {
  const queryClient = useQueryClient();
  const services = useQuery({ queryKey: adminServicesKey, queryFn: api.admin.services });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: adminServicesKey });
    void queryClient.invalidateQueries({ queryKey: servicesQueryKey });
  };

  const remove = useMutation({
    mutationFn: (id: string) => api.admin.deleteService(id),
    onSuccess: invalidate,
  });
  const close = useCallback(() => setEditing(null), [setEditing]);

  if (services.isPending) return <Skeleton height={320} />;
  if (services.isError) return <p className="form-error">{errorMessage(services.error)}</p>;

  return (
    <>
      {remove.isError && <p className="form-error">{errorMessage(remove.error)}</p>}
      {services.data.services.length === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          title="Каталог пуст"
          text="Добавьте первый сервис — он появится у сотрудников с подходящими ролями."
          action={
            <button className="btn btn-primary" onClick={() => setEditing('new')}>
              Добавить сервис
            </button>
          }
        />
      ) : (
        <div className="card table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Сервис</th>
                <th>Категория</th>
                <th>Статус</th>
                <th>Доступ</th>
                <th>
                  <span className="sr-only">Действия</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {services.data.services.map((s) => (
                <tr key={s.id}>
                  <td>
                    <div className="cell-service">
                      <ServiceIcon service={s} size={36} />
                      <div>
                        <strong>{s.name}</strong>
                        <span title={s.url}>{s.url}</span>
                      </div>
                    </div>
                  </td>
                  <td>{s.category || <span className="muted">—</span>}</td>
                  <td>
                    <StatusBadge status={s.status} />
                  </td>
                  <td>
                    {s.requiredRoles.length ? (
                      <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {s.requiredRoles.map((r) => (
                          <span key={r} className="badge badge-accent">
                            {r}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="muted">Все сотрудники</span>
                    )}
                  </td>
                  <td className="cell-actions">
                    <button className="icon-btn" onClick={() => setEditing(s)} aria-label={`Изменить ${s.name}`} title="Изменить">
                      <Pencil size={16} />
                    </button>
                    <button
                      className="icon-btn danger"
                      aria-label={`Удалить ${s.name}`}
                      title="Удалить"
                      onClick={() => {
                        if (window.confirm(`Удалить сервис «${s.name}»? Он пропадёт из каталога у всех сотрудников.`)) {
                          remove.mutate(s.id);
                        }
                      }}
                    >
                      <Trash2 size={16} />
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
          onClose={close}
          onSaved={() => {
            close();
            invalidate();
          }}
        />
      )}
    </>
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
  const [input, setInput] = useState<ServiceInput>(() => (service ? pickInput(service) : emptyInput));
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
    <Drawer
      title={service ? `Сервис «${service.name}»` : 'Новый сервис'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" form="service-form" className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? 'Сохранение…' : service ? 'Сохранить' : 'Создать'}
          </button>
        </>
      }
    >
      <form id="service-form" className="form" onSubmit={onSubmit}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <ServiceIcon service={{ name: input.name || '?', slug: input.slug || 'new', iconUrl: input.iconUrl }} size={52} />
          <div className="muted small">Предпросмотр иконки. Без URL иконки показываются инициалы.</div>
        </div>
        <label className="field">
          <span>Название</span>
          <input value={input.name} onChange={(e) => set('name', e.target.value)} required maxLength={100} />
        </label>
        <label className="field">
          <span>Slug</span>
          <input
            value={input.slug}
            onChange={(e) => set('slug', e.target.value)}
            required
            pattern="[a-z0-9][a-z0-9\-]{1,49}"
            title="2–50 символов: строчные латинские буквы, цифры, дефис"
          />
          <span className="field-hint">Адрес перехода: /go/{input.slug || 'slug'}</span>
        </label>
        <label className="field">
          <span>URL сервиса</span>
          <input type="url" value={input.url} onChange={(e) => set('url', e.target.value)} required placeholder="https://" />
        </label>
        <label className="field">
          <span>Описание</span>
          <textarea value={input.description} onChange={(e) => set('description', e.target.value)} maxLength={500} rows={3} />
        </label>
        <div className="form-row">
          <label className="field">
            <span>Категория</span>
            <input value={input.category} onChange={(e) => set('category', e.target.value)} maxLength={50} />
          </label>
          <label className="field">
            <span>Порядок</span>
            <input type="number" value={input.sortOrder} onChange={(e) => set('sortOrder', Number(e.target.value))} />
          </label>
        </div>
        <label className="field">
          <span>Иконка (URL)</span>
          <input type="url" value={input.iconUrl} onChange={(e) => set('iconUrl', e.target.value)} placeholder="https://" />
        </label>
        <label className="field">
          <span>Статус</span>
          <select value={input.status} onChange={(e) => set('status', e.target.value as ServiceStatus)}>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Роли с доступом</span>
          <input value={roles} onChange={(e) => setRoles(e.target.value)} placeholder="Пусто — доступен всем сотрудникам" />
          <span className="field-hint">Роли realm в Keycloak через запятую; достаточно любой из них.</span>
        </label>
        {save.isError && (
          <p className="form-error" role="alert">
            {errorMessage(save.error)}
          </p>
        )}
      </form>
    </Drawer>
  );
}

function pickInput(s: AdminService): ServiceInput {
  const { slug, name, description, url, iconUrl, category, status, requiredRoles, sortOrder } = s;
  return { slug, name, description, url, iconUrl, category, status, requiredRoles, sortOrder };
}

const actionLabels: Record<string, string> = {
  'auth.login': 'Вход',
  'auth.logout': 'Выход',
  'profile.update': 'Профиль изменён',
  'avatar.upload': 'Фото загружено',
  'avatar.delete': 'Фото удалено',
  'service.launch': 'Переход в сервис',
  'admin.service.create': 'Сервис создан',
  'admin.service.update': 'Сервис изменён',
  'admin.service.delete': 'Сервис удалён',
};

function actionBadge(action: string): string {
  if (action.startsWith('admin.')) return 'badge-warn';
  if (action.startsWith('auth.')) return 'badge-info';
  if (action.startsWith('service.')) return 'badge-ok';
  return 'badge-accent';
}

function formatDetails(e: AuditEvent): string {
  return Object.entries(e.details)
    .filter(([k]) => k !== 'id')
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`)
    .join(' · ');
}

function AuditLog() {
  const audit = useInfiniteQuery({
    queryKey: ['admin', 'audit'],
    queryFn: ({ pageParam }) => api.admin.audit(pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.events.length === 50 ? last.events[last.events.length - 1]!.id : undefined),
  });
  const events = audit.data?.pages.flatMap((p) => p.events) ?? [];

  if (audit.isPending) return <Skeleton height={360} />;
  if (audit.isError) return <p className="form-error">{errorMessage(audit.error)}</p>;

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Последние события</h2>
          <p>Входы, изменения профиля, переходы в сервисы и действия администраторов.</p>
        </div>
        <button className="btn btn-sm" onClick={() => audit.refetch()} disabled={audit.isFetching}>
          <RefreshCw size={14} />
          Обновить
        </button>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Когда</th>
              <th>Событие</th>
              <th>Объект</th>
              <th>Пользователь</th>
              <th>IP</th>
              <th>Детали</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td className="nowrap" title={formatDateTime(e.occurredAt)}>
                  {formatRelative(e.occurredAt)}
                </td>
                <td>
                  <span className={`badge ${actionBadge(e.action)}`} title={e.action}>
                    {actionLabels[e.action] ?? e.action}
                  </span>
                </td>
                <td>{e.target === e.actorSub ? <span className="muted">свой аккаунт</span> : e.target}</td>
                <td>
                  <span className="mono" title={e.actorSub}>
                    {e.actorSub.slice(0, 8)}
                  </span>
                </td>
                <td className="mono">{e.ip}</td>
                <td className="small muted">{formatDetails(e)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {audit.hasNextPage && (
        <div className="table-foot">
          <button className="btn btn-sm" onClick={() => audit.fetchNextPage()} disabled={audit.isFetchingNextPage}>
            Показать ещё
          </button>
        </div>
      )}
    </div>
  );
}
