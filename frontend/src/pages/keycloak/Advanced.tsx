import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, CodeBlock, Input, Select, Textarea } from '@villetacore/velessoft-ui';
import { useState, type FormEvent } from 'react';
import { ApiError, kc, request } from '../../api';
import { ErrorAlert, Loading } from '../../components/ui';
import { parseJSON } from '../../lib/settings';
import { ResourceList, yesNo, type Rep, type ResourceConfig } from './shared';

type ScopeRow = Rep & { id: string; name: string; protocol?: string; description?: string };
const clientScopes: ResourceConfig<ScopeRow> = {
  title: 'Client scopes',
  description: 'Наборы claim-ов и protocol mapper-ов для клиентов.',
  listPath: '/client-scopes',
  itemPath: (r) => `/client-scopes/${r.id}`,
  rowKey: (r) => r.id,
  deleteLabel: (r) => r.name,
  search: (r) => r.name,
  template: { name: 'new-scope', protocol: 'openid-connect', attributes: { 'include.in.token.scope': 'true' } },
  columns: [
    { key: 'name', header: 'Название', sortValue: (r) => r.name, render: (r) => <span className="mono">{r.name}</span> },
    { key: 'protocol', header: 'Протокол', render: (r) => r.protocol ?? '—' },
    { key: 'description', header: 'Описание', render: (r) => r.description || '—' },
  ],
};

type IdpRow = Rep & { alias: string; providerId: string; displayName?: string; enabled?: boolean };
const identityProviders: ResourceConfig<IdpRow> = {
  title: 'Внешние провайдеры',
  description: 'Вход через Google, GitHub, корпоративный OIDC или SAML.',
  listPath: '/identity-provider/instances',
  itemPath: (r) => `/identity-provider/instances/${encodeURIComponent(r.alias)}`,
  rowKey: (r) => r.alias,
  deleteLabel: (r) => r.alias,
  emptyText: 'Провайдеры не настроены',
  template: {
    alias: 'corporate-oidc',
    displayName: 'Корпоративный вход',
    providerId: 'oidc',
    enabled: true,
    trustEmail: false,
    config: { clientId: '', clientSecret: '', authorizationUrl: '', tokenUrl: '', userInfoUrl: '', defaultScope: 'openid profile email' },
  },
  columns: [
    { key: 'alias', header: 'Alias', render: (r) => <span className="mono">{r.alias}</span> },
    { key: 'name', header: 'Название', render: (r) => r.displayName || '—' },
    { key: 'provider', header: 'Тип', render: (r) => <Badge>{r.providerId}</Badge> },
    { key: 'enabled', header: 'Состояние', render: (r) => yesNo(r.enabled) },
  ],
};

type ComponentRow = Rep & { id: string; name: string; providerId?: string };
const federation: ResourceConfig<ComponentRow> = {
  title: 'Федерация пользователей',
  description: 'Каталоги LDAP и Kerberos.',
  listPath: '/components?type=org.keycloak.storage.UserStorageProvider',
  createPath: '/components',
  itemPath: (r) => `/components/${r.id}`,
  rowKey: (r) => r.id,
  deleteLabel: (r) => r.name,
  emptyText: 'Каталоги не подключены',
  template: {
    name: 'ldap',
    providerId: 'ldap',
    providerType: 'org.keycloak.storage.UserStorageProvider',
    config: {
      enabled: ['true'],
      vendor: ['other'],
      connectionUrl: ['ldap://ldap.example.com:389'],
      usersDn: ['ou=people,dc=example,dc=com'],
      bindDn: ['cn=reader,dc=example,dc=com'],
      bindCredential: [''],
      editMode: ['READ_ONLY'],
      usernameLDAPAttribute: ['uid'],
      rdnLDAPAttribute: ['uid'],
      uuidLDAPAttribute: ['entryUUID'],
      userObjectClasses: ['inetOrgPerson'],
    },
  },
  columns: [
    { key: 'name', header: 'Название', render: (r) => r.name },
    { key: 'provider', header: 'Тип', render: (r) => <Badge>{r.providerId}</Badge> },
  ],
};

type OrgRow = Rep & { id: string; name: string; alias?: string; enabled?: boolean };
const organizations: ResourceConfig<OrgRow> = {
  title: 'Организации',
  description: 'Включаются в разделе Realm → Основные.',
  listPath: '/organizations',
  itemPath: (r) => `/organizations/${r.id}`,
  rowKey: (r) => r.id,
  deleteLabel: (r) => r.name,
  search: (r) => r.name,
  emptyText: 'Организаций нет',
  template: { name: 'Новая организация', alias: 'new-org', enabled: true, domains: [{ name: 'example.com', verified: false }] },
  columns: [
    { key: 'name', header: 'Название', render: (r) => r.name },
    { key: 'alias', header: 'Alias', render: (r) => <span className="mono">{r.alias ?? '—'}</span> },
    { key: 'enabled', header: 'Состояние', render: (r) => yesNo(r.enabled) },
  ],
};

export function ClientScopesAdmin() {
  return <ResourceList config={clientScopes} />;
}
export function IdentityProvidersAdmin() {
  return <ResourceList config={identityProviders} />;
}
export function FederationAdmin() {
  return <ResourceList config={federation} />;
}
export function OrganizationsAdmin() {
  return <ResourceList config={organizations} />;
}

interface KeyRow {
  kid: string;
  providerId: string;
  algorithm: string;
  type: string;
  status: string;
  use?: string;
  validTo?: number;
}

export function KeysAdmin() {
  const keys = useQuery({ queryKey: ['kc', 'keys'], queryFn: () => kc.get<{ keys: KeyRow[] }>('/keys') });
  return (
    <div className="stack">
      <Card flat title="Активные ключи" description="Ключи подписи и шифрования realm. Смена ключей — через провайдеров ниже.">
        {keys.isPending && <Loading height={160} />}
        <ErrorAlert error={keys.error} />
        {keys.data && (
          <ul className="rows">
            {keys.data.keys.map((k) => (
              <li key={k.kid}>
                <span className="row-text">
                  <strong className="mono small">{k.kid}</strong>
                  <small>
                    {k.algorithm} · {k.type} · {k.use ?? '—'} · {k.providerId}
                  </small>
                </span>
                <Badge tone={k.status === 'ACTIVE' ? 'success' : 'neutral'}>{k.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <ResourceList
        config={{
          title: 'Провайдеры ключей',
          listPath: '/components?type=org.keycloak.keys.KeyProvider',
          createPath: '/components',
          itemPath: (r: ComponentRow) => `/components/${r.id}`,
          rowKey: (r: ComponentRow) => r.id,
          deleteLabel: (r: ComponentRow) => r.name,
          template: { name: 'rsa-generated', providerId: 'rsa-generated', providerType: 'org.keycloak.keys.KeyProvider', config: { priority: ['100'], enabled: ['true'], active: ['true'] } },
          columns: [
            { key: 'name', header: 'Название', render: (r: ComponentRow) => r.name },
            { key: 'provider', header: 'Тип', render: (r: ComponentRow) => <Badge>{r.providerId}</Badge> },
          ],
        }}
      />
    </div>
  );
}

// RestConsole reaches anything the screens above do not: any path of the realm's
// Admin REST API, through the same checks and audit as the rest of Orbit.
export function RestConsole() {
  const [method, setMethod] = useState('GET');
  const [path, setPath] = useState('/users/count');
  const [body, setBody] = useState('');
  const parsed = body.trim() ? parseJSON(body) : ({ ok: true, value: undefined } as const);
  const call = useMutation({
    mutationFn: () => request<unknown>(method, `/api/admin/keycloak${path.startsWith('/') ? path : `/${path}`}`, parsed.ok ? parsed.value : undefined),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (parsed.ok) call.mutate();
  }

  return (
    <Card flat title="REST-консоль" description="Любой метод Admin REST API этого realm: то, для чего нет отдельного экрана. Запись попадает в журнал аудита.">
      <form className="stack" onSubmit={onSubmit}>
        <div className="console-line">
          <Select label="Метод" value={method} onChange={(e) => setMethod(e.target.value)}>
            {['GET', 'POST', 'PUT', 'DELETE'].map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
          <Input label="Путь от /admin/realms/{realm}" value={path} onChange={(e) => setPath(e.target.value)} spellCheck={false} required />
        </div>
        {method !== 'GET' && (
          <Textarea className="json-editor" label="Тело (JSON)" rows={8} spellCheck={false} value={body} onChange={(e) => setBody(e.target.value)} error={parsed.ok ? undefined : parsed.error} />
        )}
        {method !== 'GET' && <Alert tone="warning">Запрос выполнится сразу, без дополнительного подтверждения.</Alert>}
        <div className="row">
          <Button type="submit" variant="primary" loading={call.isPending} disabled={!parsed.ok}>
            Выполнить
          </Button>
        </div>
      </form>
      {call.isError && <Alert tone="error" title={call.error instanceof ApiError ? `HTTP ${call.error.status}` : 'Ошибка'}>{call.error.message}</Alert>}
      {call.isSuccess && (
        <CodeBlock
          code={call.data === undefined ? 'Выполнено, ответ пустой' : JSON.stringify(call.data, null, 2)}
          label="Ответ"
          copyLabel="Копировать"
          copiedLabel="Скопировано"
          errorLabel="Не удалось"
        />
      )}
    </Card>
  );
}
