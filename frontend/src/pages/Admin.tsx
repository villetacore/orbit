import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, Dialog, Drawer, EmptyState, IconButton, Input, NumberInput, PageHeader, Select, Table, Tabs, Textarea, type Tone } from '@villetacore/velessoft-ui';
import { LayoutGrid, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { api, type AdminService, type AuditEvent, type ServiceInput, type ServiceStatus } from '../api';
import { ServiceIcon, StatusBadge, servicesQueryKey } from '../components/ServiceCard';
import { ErrorAlert, Loading } from '../components/ui';
import { formatDateTime, formatRelative } from '../lib/format';
import { BrandingSettings } from './BrandingSettings';
import { Registrations, registrationsKey } from './Registrations';

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
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') === 'registrations' ? 'registrations' : 'catalog');
  const pending = useQuery({
    queryKey: [...registrationsKey, 'pending'],
    queryFn: () => api.admin.registrations('pending'),
  });
  const pendingCount = pending.data?.registrations.length ?? 0;
  const [editing, setEditing] = useState<AdminService | 'new' | null>(null);

  return (
    <div className="page">
      <PageHeader
        title="Администрирование"
        description="Каталог сервисов, заявки на регистрацию, оформление портала и журнал важных действий."
        actions={
          tab === 'catalog' && (
            <Button variant="primary" className="with-icon" onClick={() => setEditing('new')}>
              <Plus size={16} />
              Добавить сервис
            </Button>
          )
        }
      />
      <Tabs
        label="Разделы администрирования"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'catalog', label: 'Каталог', content: <CatalogAdmin editing={editing} setEditing={setEditing} /> },
          {
            value: 'registrations',
            label: pendingCount > 0 ? `Заявки · ${pendingCount}` : 'Заявки',
            content: <Registrations />,
          },
          { value: 'branding', label: 'Оформление', content: tab === 'branding' ? <BrandingSettings /> : null },
          { value: 'audit', label: 'Журнал аудита', content: tab === 'audit' ? <AuditLog /> : null },
        ]}
      />
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
  const [deleting, setDeleting] = useState<AdminService | null>(null);

  if (services.isPending) return <Loading height={320} />;
  if (services.isError) return <ErrorAlert error={services.error} />;

  return (
    <>
      {services.data.services.length === 0 ? (
        <EmptyState
          icon={<LayoutGrid size={20} />}
          title="Каталог пуст"
          description="Добавьте первый сервис — он появится у сотрудников с подходящими ролями."
          actions={
            <Button variant="primary" onClick={() => setEditing('new')}>
              Добавить сервис
            </Button>
          }
        />
      ) : (
        <Table
          rows={services.data.services}
          rowKey={(s) => s.id}
          columns={[
            {
              key: 'name',
              header: 'Сервис',
              sortValue: (s) => s.name,
              render: (s) => (
                <span className="cell-service">
                  <ServiceIcon service={s} size={32} />
                  <span className="row-text">
                    <strong>{s.name}</strong>
                    <small className="mono" title={s.url}>
                      {s.url}
                    </small>
                  </span>
                </span>
              ),
            },
            { key: 'category', header: 'Категория', sortValue: (s) => s.category, render: (s) => s.category || '—' },
            { key: 'status', header: 'Статус', render: (s) => <StatusBadge status={s.status} /> },
            {
              key: 'roles',
              header: 'Доступ',
              render: (s) =>
                s.requiredRoles.length ? (
                  <span className="chips">
                    {s.requiredRoles.map((r) => (
                      <Badge key={r} tone="info">
                        {r}
                      </Badge>
                    ))}
                  </span>
                ) : (
                  'Все сотрудники'
                ),
            },
            {
              key: 'actions',
              header: <span className="vs-visually-hidden">Действия</span>,
              align: 'right',
              render: (s) => (
                <span className="row end">
                  <IconButton size="sm" variant="ghost" label={`Изменить ${s.name}`} onClick={() => setEditing(s)}>
                    <Pencil size={14} />
                  </IconButton>
                  <IconButton size="sm" variant="ghost" label={`Удалить ${s.name}`} onClick={() => setDeleting(s)}>
                    <Trash2 size={14} />
                  </IconButton>
                </span>
              ),
            },
          ]}
        />
      )}
      {deleting && (
        <DeleteServiceDialog
          service={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            invalidate();
          }}
        />
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
    </>
  );
}

// Deleting is confirmed by typing the slug, as the design system requires for
// destructive actions, and the dialog says what will be removed.
function DeleteServiceDialog({ service, onClose, onDeleted }: { service: AdminService; onClose: () => void; onDeleted: () => void }) {
  const [typed, setTyped] = useState('');
  const remove = useMutation({ mutationFn: () => api.admin.deleteService(service.id), onSuccess: onDeleted });
  return (
    <Dialog
      open
      title={`Удалить «${service.name}»?`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={remove.isPending}>
            Отмена
          </Button>
          <Button variant="danger" onClick={() => remove.mutate()} disabled={typed.trim() !== service.slug} loading={remove.isPending}>
            Удалить сервис
          </Button>
        </>
      }
    >
      <div className="stack">
        <p>
          Сервис пропадёт из каталога у всех сотрудников, вместе с отметками «Избранное». Ссылка <code>/go/{service.slug}</code>{' '}
          перестанет работать. Записи в журнале аудита сохранятся.
        </p>
        <Input label={`Введите ${service.slug} для подтверждения`} value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus autoComplete="off" spellCheck={false} />
        <ErrorAlert error={remove.error} />
      </div>
    </Dialog>
  );
}

function ServiceForm({ service, onClose, onSaved }: { service: AdminService | null; onClose: () => void; onSaved: () => void }) {
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
    <Drawer open title={service ? `Сервис «${service.name}»` : 'Новый сервис'} onClose={onClose} className="wide-drawer">
      <form className="stack" onSubmit={onSubmit}>
        <div className="cell-service">
          <ServiceIcon service={{ name: input.name || '?', slug: input.slug || 'new', iconUrl: input.iconUrl }} size={48} />
          <p className="hint">Предпросмотр иконки. Без URL иконки показываются инициалы.</p>
        </div>
        <Input label="Название" value={input.name} onChange={(e) => set('name', e.target.value)} required maxLength={100} />
        <Input
          label="Slug"
          hint={`Адрес перехода: /go/${input.slug || 'slug'}`}
          value={input.slug}
          onChange={(e) => set('slug', e.target.value)}
          required
          pattern="[a-z0-9][a-z0-9\-]{1,49}"
          title="2–50 символов: строчные латинские буквы, цифры, дефис"
        />
        <Input label="URL сервиса" type="url" value={input.url} onChange={(e) => set('url', e.target.value)} required placeholder="https://" />
        <Textarea label="Описание" value={input.description} onChange={(e) => set('description', e.target.value)} maxLength={500} rows={3} />
        <div className="form-grid">
          <Input label="Категория" value={input.category} onChange={(e) => set('category', e.target.value)} maxLength={50} />
          <NumberInput label="Порядок" value={input.sortOrder} onChange={(e) => set('sortOrder', Number(e.target.value))} />
        </div>
        <Input label="Иконка (URL)" type="url" value={input.iconUrl} onChange={(e) => set('iconUrl', e.target.value)} placeholder="https://" />
        <Select label="Статус" value={input.status} onChange={(e) => set('status', e.target.value as ServiceStatus)}>
          {Object.entries(statusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <Input
          label="Роли с доступом"
          hint="Роли realm в Keycloak через запятую; достаточно любой из них. Пусто — доступен всем."
          value={roles}
          onChange={(e) => setRoles(e.target.value)}
        />
        <ErrorAlert error={save.error} />
        <div className="row">
          <Button type="submit" variant="primary" loading={save.isPending}>
            {service ? 'Сохранить' : 'Создать'}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
        </div>
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
  'auth.password.first_change': 'Временный пароль заменён',
  'profile.update': 'Профиль изменён',
  'avatar.upload': 'Фото загружено',
  'avatar.delete': 'Фото удалено',
  'service.launch': 'Переход в сервис',
  'account.password.change': 'Пароль изменён',
  'account.email.change': 'Email изменён',
  'account.totp.add': 'OTP подключён',
  'account.credential.delete': 'Способ входа удалён',
  'admin.service.create': 'Сервис создан',
  'admin.service.update': 'Сервис изменён',
  'admin.service.delete': 'Сервис удалён',
  'admin.branding.update': 'Оформление изменено',
  'admin.branding.favicon': 'Фавикон загружен',
  'admin.branding.logo': 'Логотип загружен',
  'admin.branding.favicon.delete': 'Фавикон удалён',
  'admin.branding.logo.delete': 'Логотип удалён',
  'admin.keycloak.post': 'Keycloak: создание',
  'admin.keycloak.put': 'Keycloak: изменение',
  'admin.keycloak.delete': 'Keycloak: удаление',
};

function actionTone(action: string): Tone {
  if (action.startsWith('admin.')) return 'warning';
  if (action.startsWith('auth.')) return 'info';
  if (action.startsWith('service.')) return 'success';
  return 'neutral';
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

  if (audit.isPending) return <Loading height={360} />;
  if (audit.isError) return <ErrorAlert error={audit.error} />;

  return (
    <Card
      flat
      title="Последние события"
      description="Входы, изменения профиля, переходы в сервисы и действия администраторов."
      actions={
        <Button size="sm" className="with-icon" onClick={() => audit.refetch()} disabled={audit.isFetching}>
          <RefreshCw size={14} />
          Обновить
        </Button>
      }
    >
      <Table
        compact
        rows={events}
        rowKey={(e) => e.id}
        emptyText="Событий пока нет"
        columns={[
          { key: 'when', header: 'Когда', render: (e) => <span title={formatDateTime(e.occurredAt)}>{formatRelative(e.occurredAt)}</span> },
          { key: 'action', header: 'Событие', render: (e) => <Badge tone={actionTone(e.action)} title={e.action}>{actionLabels[e.action] ?? e.action}</Badge> },
          { key: 'target', header: 'Объект', render: (e) => (e.target === e.actorSub ? 'свой аккаунт' : <span className="mono small">{e.target}</span>) },
          { key: 'actor', header: 'Пользователь', render: (e) => <span className="mono" title={e.actorSub}>{e.actorSub.slice(0, 8)}</span> },
          { key: 'ip', header: 'IP', render: (e) => <span className="mono">{e.ip}</span> },
          { key: 'details', header: 'Детали', render: (e) => <small>{formatDetails(e)}</small> },
        ]}
      />
      {audit.hasNextPage && (
        <div className="row center">
          <Button size="sm" onClick={() => audit.fetchNextPage()} loading={audit.isFetchingNextPage}>
            Показать ещё
          </Button>
        </div>
      )}
    </Card>
  );
}
