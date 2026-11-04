import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, Input, Select, Table, Tabs, useToast, type Tone } from '@villetacore/velessoft-ui';
import { LogOut, Send } from 'lucide-react';
import { useState } from 'react';
import { kc } from '../../api';
import { ErrorAlert, Loading } from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import { ConfirmDialog } from './shared';

interface Stat {
  id: string;
  clientId: string;
  active: string;
  offline: string;
}

export function SessionsAdmin() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const stats = useQuery({ queryKey: ['kc', 'session-stats'], queryFn: () => kc.get<Stat[]>('/client-session-stats') });
  const [confirmAll, setConfirmAll] = useState(false);
  const logoutAll = useMutation({
    mutationFn: () => kc.post('/logout-all'),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['kc', 'session-stats'] });
      setConfirmAll(false);
      toast({ tone: 'success', title: 'Все сессии завершены' });
    },
  });
  const push = useMutation({
    mutationFn: () => kc.post('/push-revocation'),
    onSuccess: () => toast({ tone: 'success', title: 'Политика отзыва разослана клиентам' }),
  });
  return (
    <Card
      flat
      title="Активные сессии"
      description="Сессии по клиентам. Сессии конкретного человека — в карточке пользователя."
      actions={
        <div className="row">
          <Button size="sm" className="with-icon" onClick={() => push.mutate()} loading={push.isPending}>
            <Send size={14} />
            Разослать отзыв
          </Button>
          <Button size="sm" variant="danger" className="with-icon" onClick={() => setConfirmAll(true)}>
            <LogOut size={14} />
            Завершить все
          </Button>
        </div>
      }
    >
      {stats.isPending && <Loading height={160} />}
      <ErrorAlert error={stats.error ?? push.error} />
      {stats.isSuccess && (
        <Table
          compact
          rows={stats.data}
          rowKey={(s) => s.id}
          emptyText="Активных сессий нет"
          columns={[
            { key: 'client', header: 'Клиент', render: (s) => <span className="mono">{s.clientId}</span> },
            { key: 'active', header: 'Активных', align: 'right', render: (s) => s.active },
            { key: 'offline', header: 'Offline', align: 'right', render: (s) => s.offline },
          ]}
        />
      )}
      {confirmAll && (
        <ConfirmDialog title="Завершить все сессии realm?" confirmLabel="Завершить" onClose={() => setConfirmAll(false)} onConfirm={() => logoutAll.mutate()} pending={logoutAll.isPending} error={logoutAll.error}>
          <p>Все пользователи, включая вас, выйдут из всех сервисов.</p>
        </ConfirmDialog>
      )}
    </Card>
  );
}

const PAGE = 50;

interface LoginEvent {
  id?: string;
  time: number;
  type: string;
  clientId?: string;
  userId?: string;
  ipAddress?: string;
  error?: string;
  details?: Record<string, string>;
}

interface AdminEvent {
  id?: string;
  time: number;
  operationType: string;
  resourceType: string;
  resourcePath: string;
  authDetails?: { userId?: string; ipAddress?: string; clientId?: string };
  error?: string;
}

export function EventsAdmin() {
  return (
    <Tabs
      label="События"
      items={[
        { value: 'login', label: 'Входы', content: <LoginEvents /> },
        { value: 'admin', label: 'Действия администраторов', content: <AdminEvents /> },
      ]}
    />
  );
}

function when(ms: number) {
  return formatDateTime(new Date(ms).toISOString());
}

function LoginEvents() {
  const queryClient = useQueryClient();
  const [type, setType] = useState('');
  const [user, setUser] = useState('');
  const [confirm, setConfirm] = useState(false);
  const params = new URLSearchParams();
  if (type) params.set('type', type);
  if (user.trim()) params.set('user', user.trim());
  const events = useInfiniteQuery({
    queryKey: ['kc', 'events', type, user.trim()],
    queryFn: ({ pageParam }) => kc.get<LoginEvent[]>(`/events?first=${pageParam * PAGE}&max=${PAGE}&${params}`),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.length === PAGE ? pages.length : undefined),
  });
  const clear = useMutation({
    mutationFn: () => kc.del('/events'),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['kc', 'events'] });
      setConfirm(false);
    },
  });
  const tone = (t: string): Tone => (t.endsWith('_ERROR') ? 'error' : t === 'LOGIN' ? 'success' : 'neutral');
  return (
    <Card
      flat
      title="События входа"
      description="Хранение и срок включаются в разделе Realm → События."
      actions={
        <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>
          Очистить
        </Button>
      }
    >
      <div className="form-grid">
        <Select label="Тип" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Все</option>
          {['LOGIN', 'LOGIN_ERROR', 'LOGOUT', 'UPDATE_PASSWORD', 'UPDATE_CREDENTIAL', 'REMOVE_CREDENTIAL', 'REGISTER', 'CODE_TO_TOKEN', 'REFRESH_TOKEN'].map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
        <Input label="ID пользователя" value={user} onChange={(e) => setUser(e.target.value)} />
      </div>
      {events.isPending && <Loading height={240} />}
      <ErrorAlert error={events.error} />
      {events.isSuccess && (
        <Table
          compact
          rows={events.data.pages.flat()}
          rowKey={(e, i) => e.id ?? i}
          emptyText="Событий нет"
          columns={[
            { key: 'time', header: 'Когда', render: (e) => when(e.time) },
            { key: 'type', header: 'Тип', render: (e) => <Badge tone={tone(e.type)}>{e.type}</Badge> },
            { key: 'user', header: 'Пользователь', render: (e) => <span className="mono small">{e.details?.username ?? e.userId ?? '—'}</span> },
            { key: 'client', header: 'Клиент', render: (e) => <span className="mono small">{e.clientId ?? '—'}</span> },
            { key: 'ip', header: 'IP', render: (e) => <span className="mono small">{e.ipAddress ?? '—'}</span> },
            { key: 'error', header: 'Ошибка', render: (e) => e.error ?? '—' },
          ]}
        />
      )}
      {events.hasNextPage && (
        <div className="row center">
          <Button size="sm" onClick={() => events.fetchNextPage()} loading={events.isFetchingNextPage}>
            Показать ещё
          </Button>
        </div>
      )}
      {confirm && (
        <ConfirmDialog title="Очистить события входа?" confirmLabel="Очистить" onClose={() => setConfirm(false)} onConfirm={() => clear.mutate()} pending={clear.isPending} error={clear.error}>
          <p>Вся история входов, включая «Историю входов» у пользователей, будет удалена.</p>
        </ConfirmDialog>
      )}
    </Card>
  );
}

function AdminEvents() {
  const queryClient = useQueryClient();
  const [operation, setOperation] = useState('');
  const [confirm, setConfirm] = useState(false);
  const events = useInfiniteQuery({
    queryKey: ['kc', 'admin-events', operation],
    queryFn: ({ pageParam }) => kc.get<AdminEvent[]>(`/admin-events?first=${pageParam * PAGE}&max=${PAGE}${operation ? `&operationTypes=${operation}` : ''}`),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.length === PAGE ? pages.length : undefined),
  });
  const clear = useMutation({
    mutationFn: () => kc.del('/admin-events'),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['kc', 'admin-events'] });
      setConfirm(false);
    },
  });
  return (
    <Card
      flat
      title="Действия администраторов"
      description="Настройки, изменённые через Orbit, выполняются от сервисного аккаунта; кто именно их сделал — в журнале аудита Orbit."
      actions={
        <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>
          Очистить
        </Button>
      }
    >
      <Select label="Операция" value={operation} onChange={(e) => setOperation(e.target.value)}>
        <option value="">Все</option>
        {['CREATE', 'UPDATE', 'DELETE', 'ACTION'].map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </Select>
      {events.isPending && <Loading height={240} />}
      <ErrorAlert error={events.error} />
      {events.isSuccess && (
        <Table
          compact
          rows={events.data.pages.flat()}
          rowKey={(e, i) => e.id ?? i}
          emptyText="Событий нет"
          columns={[
            { key: 'time', header: 'Когда', render: (e) => when(e.time) },
            { key: 'op', header: 'Операция', render: (e) => <Badge>{e.operationType}</Badge> },
            { key: 'type', header: 'Объект', render: (e) => e.resourceType },
            { key: 'path', header: 'Путь', render: (e) => <span className="mono small">{e.resourcePath}</span> },
            { key: 'ip', header: 'IP', render: (e) => <span className="mono small">{e.authDetails?.ipAddress ?? '—'}</span> },
          ]}
        />
      )}
      {events.hasNextPage && (
        <div className="row center">
          <Button size="sm" onClick={() => events.fetchNextPage()} loading={events.isFetchingNextPage}>
            Показать ещё
          </Button>
        </div>
      )}
      {confirm && (
        <ConfirmDialog title="Очистить действия администраторов?" confirmLabel="Очистить" onClose={() => setConfirm(false)} onConfirm={() => clear.mutate()} pending={clear.isPending} error={clear.error}>
          <p>История будет удалена из Keycloak. Журнал аудита Orbit не изменится.</p>
        </ConfirmDialog>
      )}
    </Card>
  );
}
