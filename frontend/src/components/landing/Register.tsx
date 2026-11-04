import { useMutation } from '@tanstack/react-query';
import { Alert, Button, Input, Textarea } from '@villetacore/velessoft-ui';
import { ArrowLeft, Send } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api, type RegistrationInput } from '@/api';
import { ErrorAlert, LinkButton } from '@/components/ui';

const empty: RegistrationInput = { username: '', email: '', firstName: '', lastName: '', comment: '', website: '' };

// RegisterForm files a sign-up request; an administrator approves it in
// Администрирование → Заявки, and only then is the Keycloak account created.
export function RegisterForm({ appName }: { appName: string }) {
  const [form, setForm] = useState(empty);
  const submit = useMutation({ mutationFn: () => api.register(form) });
  const set = (k: keyof RegistrationInput) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit.mutate();
  };

  if (submit.isSuccess) {
    return (
      <div className="signin">
        <small className="eyebrow">{appName} / заявка</small>
        <h2>Заявка отправлена</h2>
        <Alert tone="success">
          Администратор рассмотрит её и создаст учётную запись. Инструкция по входу придёт на <strong>{form.email}</strong>{' '}
          или вам передаст её администратор.
        </Alert>
        <LinkButton to="/" variant="ghost">
          <ArrowLeft size={16} />
          На страницу входа
        </LinkButton>
      </div>
    );
  }

  return (
    <form className="signin" onSubmit={onSubmit}>
      <small className="eyebrow">{appName} / регистрация</small>
      <h2>Заявка на аккаунт</h2>
      <p className="hint">Заполните данные — администратор проверит заявку и откроет доступ.</p>
      <div className="form-grid">
        <Input label="Имя" value={form.firstName} onChange={set('firstName')} required maxLength={100} autoComplete="given-name" />
        <Input label="Фамилия" value={form.lastName} onChange={set('lastName')} required maxLength={100} autoComplete="family-name" />
      </div>
      <Input label="Рабочая почта" type="email" value={form.email} onChange={set('email')} required autoComplete="email" />
      <Input
        label="Логин"
        hint="3–32 символа: латиница, цифры, точка, дефис, подчёркивание."
        value={form.username}
        onChange={set('username')}
        required
        pattern="[A-Za-z0-9][A-Za-z0-9._\-]{2,31}"
        autoComplete="username"
        autoCapitalize="none"
      />
      <Textarea
        label="Комментарий для администратора"
        value={form.comment}
        onChange={set('comment')}
        rows={3}
        maxLength={500}
        placeholder="Отдел, руководитель, зачем нужен доступ"
      />
      {/* Honeypot: hidden from people and assistive tech; bots fill it. */}
      <input className="hp" tabIndex={-1} autoComplete="off" aria-hidden="true" value={form.website} onChange={set('website')} />
      <ErrorAlert error={submit.error} />
      <Button type="submit" variant="primary" size="lg" block className="with-icon" loading={submit.isPending}>
        Отправить заявку
        <Send size={16} />
      </Button>
      <LinkButton to="/" variant="ghost">
        <ArrowLeft size={16} />
        Уже есть аккаунт — войти
      </LinkButton>
    </form>
  );
}
