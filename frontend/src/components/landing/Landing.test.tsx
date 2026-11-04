import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginForm } from './Landing';

function respond(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function setup(...responses: Response[]) {
  const fetchMock = vi.fn(async (..._args: unknown[]) => responses.shift() ?? respond(204));
  vi.stubGlobal('fetch', fetchMock);
  render(
    <QueryClientProvider client={new QueryClient()}>
        <LoginForm appName="Orbit" />
    </QueryClientProvider>,
  );
  const body = (i: number) => JSON.parse((fetchMock.mock.calls[i]![1] as RequestInit).body as string);
  return { fetchMock, body };
}

async function submit(user: ReturnType<typeof userEvent.setup>, password = 'pw') {
  await user.type(screen.getByLabelText(/Логин или email/), 'alice');
  await user.type(screen.getByLabelText(/^Пароль/), password);
  await user.click(screen.getByRole('button', { name: 'Войти' }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('LoginForm', () => {
  it('posts credentials to the backend instead of navigating away', async () => {
    const user = userEvent.setup();
    const { fetchMock, body } = setup(respond(204));
    await submit(user);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]![0]).toBe('/auth/password');
    expect(body(0)).toMatchObject({ username: 'alice', password: 'pw' });
  });

  it('keeps the typed login and offers a code field after a rejection', async () => {
    const user = userEvent.setup();
    const { body } = setup(respond(401, { error: 'invalid_credentials', message: 'x' }), respond(204));
    await submit(user);
    const code = await screen.findByLabelText(/Код подтверждения/);
    expect(screen.getByLabelText(/Логин или email/)).toHaveValue('alice');

    await user.type(code, '123456');
    await user.click(screen.getByRole('button', { name: 'Войти' }));
    await waitFor(() => expect(body(1)).toMatchObject({ otp: '123456' }));
  });

  it('asks for a new password when the current one is temporary', async () => {
    const user = userEvent.setup();
    const { body } = setup(respond(409, { error: 'password_change_required', message: 'x' }), respond(204));
    await submit(user, 'temp');
    await user.type(await screen.findByLabelText(/Новый пароль/), 'Better-123');
    await user.type(screen.getByLabelText(/Повторите пароль/), 'Better-456');
    expect(screen.getByRole('button', { name: 'Сохранить и войти' })).toBeDisabled();

    await user.clear(screen.getByLabelText(/Повторите пароль/));
    await user.type(screen.getByLabelText(/Повторите пароль/), 'Better-123');
    await user.click(screen.getByRole('button', { name: 'Сохранить и войти' }));
    await waitFor(() => expect(body(1)).toMatchObject({ password: 'temp', newPassword: 'Better-123' }));
  });

  it('offers the sign-in page only for what the form cannot do', async () => {
    const user = userEvent.setup();
    setup(respond(409, { error: 'browser_required', message: 'x' }));
    await submit(user);
    expect((await screen.findByRole('link', { name: 'Продолжить' })).getAttribute('href')).toContain('/auth/login');
  });
});
