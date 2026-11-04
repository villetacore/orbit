'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CodeBlock, Dialog, Drawer, Input, Select, Table, Tabs, useToast } from '@villetacore/velessoft-ui';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { kc } from '@/api';
import { ErrorAlert, Loading } from '@/components/ui';
import { ConfirmDialog, JsonEditor, SaveBar, SettingsFields, useRepresentation, yesNo, type Field, type Rep } from './shared';

interface KcClient extends Rep {
  id: string;
  clientId: string;
  name?: string;
  enabled?: boolean;
  protocol?: string;
  publicClient?: boolean;
  bearerOnly?: boolean;
}

const clientFields: Field[] = [
  { key: 'clientId', label: 'Client ID' },
  { key: 'name', label: 'Название' },
  { key: 'description', label: 'Описание', type: 'textarea' },
  { key: 'enabled', label: 'Включён', type: 'bool' },
  { key: 'publicClient', label: 'Публичный клиент', type: 'bool', hint: 'Выключено — конфиденциальный, с секретом.' },
  { key: 'standardFlowEnabled', label: 'Authorization Code', type: 'bool' },
  { key: 'directAccessGrantsEnabled', label: 'Direct access grants (вход по паролю)', type: 'bool' },
  { key: 'implicitFlowEnabled', label: 'Implicit flow', type: 'bool' },
  { key: 'serviceAccountsEnabled', label: 'Сервисный аккаунт', type: 'bool' },
  { key: 'consentRequired', label: 'Спрашивать согласие', type: 'bool' },
  { key: 'frontchannelLogout', label: 'Front-channel logout', type: 'bool' },
  { key: 'rootUrl', label: 'Root URL' },
  { key: 'baseUrl', label: 'Home URL' },
  { key: 'adminUrl', label: 'Admin URL' },
  { key: 'redirectUris', label: 'Redirect URI', type: 'lines' },
  { key: 'webOrigins', label: 'Web origins', type: 'lines' },
  { key: 'attributes/post.logout.redirect.uris', label: 'Post logout redirect URI', hint: 'Несколько значений — через ##.' },
  {
    key: 'attributes/pkce.code.challenge.method',
    label: 'PKCE',
    type: 'select',
    options: [
      { value: '', label: 'Не требуется' },
      { value: 'S256', label: 'S256' },
      { value: 'plain', label: 'plain' },
    ],
  },
  { key: 'attributes/access.token.lifespan', label: 'Срок access token', hint: 'Секунды. Пусто — как в realm.' },
];

export function ClientsAdmin() {
  const queryClient = useQueryClient();
  const clients = useQuery({ queryKey: ['kc', 'clients'], queryFn: () => kc.get<KcClient[]>('/clients?max=500') });
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<KcClient | null>(null);
  const [deleting, setDeleting] = useState<KcClient | null>(null);
  const remove = useMutation({
    mutationFn: (c: KcClient) => kc.del(`/clients/${c.id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['kc', 'clients'] });
      setDeleting(null);
    },
  });
  return (
    <Card
      flat
      title="Клиенты"
      description="Приложения, которые входят через этот realm."
      actions={
        <Button size="sm" variant="primary" className="with-icon" onClick={() => setCreating(true)}>
          <Plus size={14} />
          Создать
        </Button>
      }
    >
      {clients.isPending && <Loading height={240} />}
      <ErrorAlert error={clients.error} />
      {clients.isSuccess && (
        <Table
          compact
          rows={clients.data}
          rowKey={(c) => c.id}
          columns={[
            {
              key: 'clientId',
              header: 'Client ID',
              sortValue: (c) => c.clientId,
              render: (c) => (
                <button type="button" className="vs-link text-button mono" onClick={() => setSelected(c)}>
                  {c.clientId}
                </button>
              ),
            },
            { key: 'name', header: 'Название', render: (c) => (c.name?.startsWith('${') ? '—' : c.name || '—') },
            { key: 'protocol', header: 'Протокол', render: (c) => <span className="mono small">{c.protocol ?? '—'}</span> },
            { key: 'kind', header: 'Тип', render: (c) => <Badge>{c.bearerOnly ? 'bearer-only' : c.publicClient ? 'публичный' : 'конфиденциальный'}</Badge> },
            { key: 'enabled', header: 'Состояние', render: (c) => yesNo(c.enabled) },
            {
              key: 'actions',
              header: <span className="vs-visually-hidden">Действия</span>,
              align: 'right',
              render: (c) => (
                <Button size="sm" variant="ghost" onClick={() => setDeleting(c)}>
                  Удалить
                </Button>
              ),
            },
          ]}
        />
      )}
      {creating && <CreateClientDialog onClose={() => setCreating(false)} />}
      {selected && <ClientDrawer key={selected.id} client={selected} onClose={() => setSelected(null)} />}
      {deleting && (
        <ConfirmDialog title={`Удалить клиент ${deleting.clientId}?`} onClose={() => setDeleting(null)} onConfirm={() => remove.mutate(deleting)} pending={remove.isPending} error={remove.error}>
          <p>Приложение перестанет входить через этот realm.</p>
        </ConfirmDialog>
      )}
    </Card>
  );
}

function CreateClientDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [clientId, setClientId] = useState('');
  const [redirect, setRedirect] = useState('');
  const [kind, setKind] = useState('confidential');
  const [protocol, setProtocol] = useState('openid-connect');
  const create = useMutation({
    mutationFn: () =>
      kc.post('/clients', {
        clientId,
        protocol,
        enabled: true,
        publicClient: kind === 'public',
        standardFlowEnabled: true,
        redirectUris: redirect ? [redirect] : [],
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['kc', 'clients'] });
      onClose();
    },
  });
  return (
    <Dialog
      open
      title="Новый клиент"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={() => create.mutate()} disabled={!clientId.trim()} loading={create.isPending}>
            Создать
          </Button>
        </>
      }
    >
      <div className="stack">
        <Input label="Client ID" value={clientId} onChange={(e) => setClientId(e.target.value)} autoFocus />
        <Select label="Протокол" value={protocol} onChange={(e) => setProtocol(e.target.value)}>
          <option value="openid-connect">OpenID Connect</option>
          <option value="saml">SAML</option>
        </Select>
        <Select label="Тип" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="confidential">Конфиденциальный (есть бэкенд)</option>
          <option value="public">Публичный (SPA, мобильное приложение)</option>
        </Select>
        <Input label="Redirect URI" value={redirect} onChange={(e) => setRedirect(e.target.value)} placeholder="https://app.example.com/*" />
        <ErrorAlert error={create.error} />
      </div>
    </Dialog>
  );
}

function ClientDrawer({ client, onClose }: { client: KcClient; onClose: () => void }) {
  const key = ['kc', 'clients', client.id];
  const { value, query, setDraft, dirty, reset, save } = useRepresentation(`/clients/${client.id}`, key);
  return (
    <Drawer open title={client.clientId} onClose={onClose} className="wide-drawer xl-drawer">
      {query.isPending && <Loading height={320} />}
      <ErrorAlert error={query.error} />
      {value && (
        <Tabs
          label="Разделы клиента"
          items={[
            {
              value: 'settings',
              label: 'Настройки',
              content: (
                <div className="stack">
                  <SettingsFields fields={clientFields} value={value} onChange={setDraft} />
                  <SaveBar dirty={dirty} save={save} onReset={reset} onSave={() => save.mutate(value)} />
                </div>
              ),
            },
            { value: 'secret', label: 'Секрет', content: <SecretTab client={value as KcClient} /> },
            { value: 'roles', label: 'Роли', content: <ClientRoles id={client.id} /> },
            { value: 'scopes', label: 'Scopes', content: <ClientScopes id={client.id} /> },
            {
              value: 'json',
              label: 'JSON',
              content: <JsonEditor key={JSON.stringify(query.data)} value={query.data} onSave={(rep) => save.mutate(rep)} saving={save.isPending} error={save.error} label="Включая protocol mappers и все атрибуты" />,
            },
          ]}
        />
      )}
    </Drawer>
  );
}

function SecretTab({ client }: { client: KcClient }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const key = ['kc', 'clients', client.id, 'secret'];
  const secret = useQuery({
    queryKey: key,
    queryFn: () => kc.get<{ value?: string }>(`/clients/${client.id}/client-secret`),
    enabled: !client.publicClient,
  });
  const [confirming, setConfirming] = useState(false);
  const regenerate = useMutation({
    mutationFn: () => kc.post(`/clients/${client.id}/client-secret`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: key });
      setConfirming(false);
      toast({ tone: 'success', title: 'Секрет обновлён' });
    },
  });
  if (client.publicClient) return <p className="hint">У публичного клиента нет секрета.</p>;
  return (
    <div className="stack">
      <ErrorAlert error={secret.error} />
      {secret.data?.value && <CodeBlock code={secret.data.value} label="Секрет клиента" copyLabel="Копировать" copiedLabel="Скопировано" errorLabel="Не удалось" />}
      <div className="row">
        <Button variant="danger" onClick={() => setConfirming(true)}>
          Создать новый секрет
        </Button>
      </div>
      {confirming && (
        <ConfirmDialog title="Заменить секрет?" confirmLabel="Заменить" onClose={() => setConfirming(false)} onConfirm={() => regenerate.mutate()} pending={regenerate.isPending} error={regenerate.error}>
          <p>Приложение перестанет входить, пока в нём не обновят секрет.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function ClientRoles({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const key = ['kc', 'clients', id, 'roles'];
  const roles = useQuery({ queryKey: key, queryFn: () => kc.get<{ id: string; name: string; description?: string }[]>(`/clients/${id}/roles?max=500`) });
  const [name, setName] = useState('');
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const create = useMutation({
    mutationFn: () => kc.post(`/clients/${id}/roles`, { name }),
    onSuccess: async () => {
      setName('');
      await refresh();
    },
  });
  const remove = useMutation({ mutationFn: (role: string) => kc.del(`/clients/${id}/roles/${encodeURIComponent(role)}`), onSuccess: refresh });
  return (
    <div className="stack">
      <ErrorAlert error={roles.error ?? create.error ?? remove.error} />
      <Table
        compact
        rows={roles.data ?? []}
        rowKey={(r) => r.id}
        emptyText="У клиента нет своих ролей"
        columns={[
          { key: 'name', header: 'Роль', render: (r) => <span className="mono">{r.name}</span> },
          { key: 'description', header: 'Описание', render: (r) => r.description || '—' },
          {
            key: 'a',
            header: <span className="vs-visually-hidden">Действия</span>,
            align: 'right',
            render: (r) => (
              <Button size="sm" variant="ghost" onClick={() => remove.mutate(r.name)}>
                Удалить
              </Button>
            ),
          },
        ]}
      />
      <Input
        label="Новая роль"
        value={name}
        onChange={(e) => setName(e.target.value)}
        endAddon={
          <Button onClick={() => create.mutate()} disabled={!name.trim()} loading={create.isPending}>
            Добавить
          </Button>
        }
      />
    </div>
  );
}

interface ScopeRef {
  id: string;
  name: string;
}

function ClientScopes({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const all = useQuery({ queryKey: ['kc', 'client-scopes'], queryFn: () => kc.get<ScopeRef[]>('/client-scopes') });
  const defaults = useQuery({ queryKey: ['kc', 'clients', id, 'default-scopes'], queryFn: () => kc.get<ScopeRef[]>(`/clients/${id}/default-client-scopes`) });
  const optional = useQuery({ queryKey: ['kc', 'clients', id, 'optional-scopes'], queryFn: () => kc.get<ScopeRef[]>(`/clients/${id}/optional-client-scopes`) });
  const assign = useMutation({
    mutationFn: async ({ scope, kind }: { scope: string; kind: string }) => {
      const wasDefault = defaults.data?.some((s) => s.id === scope);
      const wasOptional = optional.data?.some((s) => s.id === scope);
      if (wasDefault && kind !== 'default') await kc.del(`/clients/${id}/default-client-scopes/${scope}`);
      if (wasOptional && kind !== 'optional') await kc.del(`/clients/${id}/optional-client-scopes/${scope}`);
      if (kind === 'default' && !wasDefault) await kc.put(`/clients/${id}/default-client-scopes/${scope}`);
      if (kind === 'optional' && !wasOptional) await kc.put(`/clients/${id}/optional-client-scopes/${scope}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['kc', 'clients', id] }),
  });
  const kindOf = (scope: string) => (defaults.data?.some((s) => s.id === scope) ? 'default' : optional.data?.some((s) => s.id === scope) ? 'optional' : 'none');
  if (all.isPending || defaults.isPending || optional.isPending) return <Loading height={200} />;
  return (
    <div className="stack">
      <ErrorAlert error={all.error ?? assign.error} />
      <Table
        compact
        rows={all.data ?? []}
        rowKey={(s) => s.id}
        columns={[
          { key: 'name', header: 'Scope', render: (s) => <span className="mono">{s.name}</span> },
          {
            key: 'kind',
            header: 'Назначение',
            render: (s) => (
              <Select label="Назначение" className="compact-select" value={kindOf(s.id)} onChange={(e) => assign.mutate({ scope: s.id, kind: e.target.value })}>
                <option value="none">Не назначен</option>
                <option value="default">По умолчанию</option>
                <option value="optional">Опциональный</option>
              </Select>
            ),
          },
        ]}
      />
    </div>
  );
}
