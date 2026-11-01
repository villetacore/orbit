// Typed client for the Orbit API. The browser never sees OIDC tokens: it holds
// an HttpOnly session cookie, and state-changing requests carry the CSRF token
// handed out by /api/me.

export interface Me {
  sub: string;
  username: string;
  name: string;
  email: string;
  roles: string[];
  groups: string[];
  isAdmin: boolean;
  avatarUrl: string;
  csrfToken: string;
}

export interface PublicConfig {
  accountConsoleUrl: string;
  securityLinks: Record<'signingIn' | 'deviceActivity' | 'linkedAccounts' | 'applications', string>;
  actions: string[];
  registrationEnabled: boolean;
}

export interface ProfileAttribute {
  name: string;
  value: string;
  editable: boolean;
}

export interface Profile {
  sub: string;
  username: string;
  email: string;
  emailVerified: boolean;
  firstName: string;
  lastName: string;
  enabled: boolean;
  createdAt: string | null;
  attributes: ProfileAttribute[];
  groups: string[];
  roles: string[];
  avatarUrl: string;
}

export interface ProfileUpdate {
  firstName?: string;
  lastName?: string;
  attributes?: Record<string, string>;
}

export type ServiceStatus = 'active' | 'maintenance' | 'hidden';

export interface CatalogService {
  id: string;
  slug: string;
  name: string;
  description: string;
  iconUrl: string;
  category: string;
  status: ServiceStatus;
  favorite: boolean;
  launchUrl: string;
}

export interface ServiceInput {
  slug: string;
  name: string;
  description: string;
  url: string;
  iconUrl: string;
  category: string;
  status: ServiceStatus;
  requiredRoles: string[];
  sortOrder: number;
}

export interface AdminService extends ServiceInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEvent {
  id: number;
  occurredAt: string;
  actorSub: string;
  action: string;
  target: string;
  ip: string;
  userAgent: string;
  details: Record<string, unknown>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let csrfToken = '';

export function setCsrfToken(token: string) {
  csrfToken = token;
}

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (method !== 'GET' && method !== 'HEAD') {
    headers['X-CSRF-Token'] = csrfToken;
  }

  const res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin' });
  if (!res.ok) {
    let data: { error?: string; message?: string } = {};
    try {
      data = await res.json();
    } catch {
      // non-JSON error body
    }
    throw new ApiError(res.status, data.error ?? 'error', data.message ?? res.statusText);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

export const api = {
  me: () => request<Me>('GET', '/api/me'),
  config: () => request<PublicConfig>('GET', '/api/config'),
  logout: () => request<{ redirectUrl: string }>('POST', '/auth/logout'),

  profile: () => request<Profile>('GET', '/api/profile'),
  updateProfile: (input: ProfileUpdate) => request<Profile>('PATCH', '/api/profile', input),
  uploadAvatar: (file: Blob) => {
    const form = new FormData();
    form.append('file', file, 'avatar');
    return request<{ avatarUrl: string }>('PUT', '/api/profile/avatar', form);
  },
  deleteAvatar: () => request<void>('DELETE', '/api/profile/avatar'),

  services: () => request<{ services: CatalogService[]; categories: string[] }>('GET', '/api/services'),
  setFavorite: (id: string, favorite: boolean) =>
    request<void>('PUT', `/api/services/${encodeURIComponent(id)}/favorite`, { favorite }),

  admin: {
    services: () => request<{ services: AdminService[] }>('GET', '/api/admin/services'),
    createService: (input: ServiceInput) => request<AdminService>('POST', '/api/admin/services', input),
    updateService: (id: string, input: ServiceInput) =>
      request<AdminService>('PUT', `/api/admin/services/${encodeURIComponent(id)}`, input),
    deleteService: (id: string) => request<void>('DELETE', `/api/admin/services/${encodeURIComponent(id)}`),
    audit: (before?: number) =>
      request<{ events: AuditEvent[] }>('GET', `/api/admin/audit?limit=50${before ? `&before=${before}` : ''}`),
  },
};

export function loginUrl(returnTo = window.location.pathname + window.location.search): string {
  return `/auth/login?return_to=${encodeURIComponent(returnTo)}`;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError || err instanceof Error) return err.message;
  return 'Неизвестная ошибка';
}
