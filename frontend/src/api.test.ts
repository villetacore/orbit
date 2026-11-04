import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, request, safeReturnTo, setCsrfToken } from './api';

function mockFetch(status: number, body?: unknown) {
  const fn = vi.fn(async () =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken('');
});

describe('request', () => {
  it('sends the CSRF token only on state-changing requests', async () => {
    setCsrfToken('tok');
    const fetch = mockFetch(200, { ok: true });

    await request('GET', '/api/me');
    await request('PATCH', '/api/profile', { firstName: 'A' });

    const headersOf = (i: number) => (fetch.mock.calls[i] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headersOf(0)['X-CSRF-Token']).toBeUndefined();
    expect(headersOf(1)['X-CSRF-Token']).toBe('tok');
    expect(headersOf(1)['Content-Type']).toBe('application/json');
  });

  it('does not set Content-Type for multipart uploads', async () => {
    const fetch = mockFetch(200, {});
    await request('PUT', '/api/profile/avatar', new FormData());
    const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });

  it('turns error responses into ApiError', async () => {
    mockFetch(422, { error: 'validation', message: 'lastName: обязательное поле' });
    const err = await request('PATCH', '/api/profile', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 422, code: 'validation', message: 'lastName: обязательное поле' });
  });

  it('returns undefined for 204', async () => {
    mockFetch(204);
    await expect(request('DELETE', '/api/profile/avatar')).resolves.toBeUndefined();
  });
});

describe('safeReturnTo', () => {
  it('only allows paths on this origin', () => {
    expect(safeReturnTo('/go/wiki')).toBe('/go/wiki');
    for (const bad of ['https://evil.test', '//evil.test', '/\\evil.test', null, '']) {
      expect(safeReturnTo(bad)).toBeNull();
    }
  });
});
