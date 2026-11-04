import { PageHeader } from '@villetacore/velessoft-ui';
import { Navigate, NavLink, useParams } from 'react-router';
import { EventsAdmin, SessionsAdmin } from './Activity';
import { ClientScopesAdmin, FederationAdmin, IdentityProvidersAdmin, KeysAdmin, OrganizationsAdmin, RestConsole } from './Advanced';
import { AuthenticationAdmin } from './Authentication';
import { ClientsAdmin } from './Clients';
import { GroupsAdmin, RolesAdmin } from './Directory';
import { RealmSettings } from './Realm';
import { UsersAdmin } from './Users';

const sections = [
  { id: 'realm', label: 'Realm', element: <RealmSettings /> },
  { id: 'users', label: 'Пользователи', element: <UsersAdmin /> },
  { id: 'groups', label: 'Группы', element: <GroupsAdmin /> },
  { id: 'roles', label: 'Роли', element: <RolesAdmin /> },
  { id: 'clients', label: 'Клиенты', element: <ClientsAdmin /> },
  { id: 'client-scopes', label: 'Client scopes', element: <ClientScopesAdmin /> },
  { id: 'authentication', label: 'Аутентификация', element: <AuthenticationAdmin /> },
  { id: 'identity-providers', label: 'Внешние провайдеры', element: <IdentityProvidersAdmin /> },
  { id: 'federation', label: 'Федерация', element: <FederationAdmin /> },
  { id: 'organizations', label: 'Организации', element: <OrganizationsAdmin /> },
  { id: 'sessions', label: 'Сессии', element: <SessionsAdmin /> },
  { id: 'events', label: 'События', element: <EventsAdmin /> },
  { id: 'keys', label: 'Ключи', element: <KeysAdmin /> },
  { id: 'console', label: 'REST-консоль', element: <RestConsole /> },
];

// KeycloakAdmin replaces the Keycloak admin console for this realm. Everything
// goes through Orbit's backend, which holds the service account credentials.
export function KeycloakAdmin() {
  const { section } = useParams();
  const current = sections.find((s) => s.id === section);
  if (!current) return <Navigate to="/keycloak/realm" replace />;

  return (
    <div className="page">
      <PageHeader eyebrow="Keycloak" title={current.label} description="Изменения сразу применяются в Keycloak и записываются в журнал аудита Orbit." />
      <div className="kc-layout">
        <nav aria-label="Разделы Keycloak" className="kc-nav">
          <ul className="vs-nav-list">
            {sections.map((s) => (
              <li key={s.id}>
                <NavLink to={`/keycloak/${s.id}`}>{s.label}</NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="kc-content" key={current.id}>
          {current.element}
        </div>
      </div>
    </div>
  );
}
