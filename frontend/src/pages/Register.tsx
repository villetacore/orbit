import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Send } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api, errorMessage, type RegistrationInput } from '../api';

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
        <div className="eyebrow">{appName} / заявка</div>
        <h2>Заявка отправлена</h2>
        <div className="alert alert-ok" role="status">
          <CheckCircle2 size={16} />
          <span>
            Администратор рассмотрит её и создаст учётную запись. Инструкция по входу придёт на{' '}
            <strong>{form.email}</strong> или вам передаст её администратор.
          </span>
        </div>
        <Link className="btn btn-ghost" to="/">
          <ArrowLeft size={16} />
          На страницу входа
        </Link>
      </div>
    );
  }

  return (
    <form className="signin" onSubmit={onSubmit}>
      <div className="eyebrow">{appName} / регистрация</div>
      <h2>Заявка на аккаунт</h2>
      <p>Заполните данные — администратор проверит заявку и откроет доступ. Пароль вы зададите сами после одобрения.</p>
      <div className="form-row">
        <label className="field">
          <span>Имя</span>
          <input
            value={form.firstName}
            onChange={set('firstName')}
            required
            maxLength={100}
            autoComplete="given-name"
          />
        </label>
        <label className="field">
          <span>Фамилия</span>
          <input value={form.lastName} onChange={set('lastName')} required maxLength={100} autoComplete="family-name" />
        </label>
      </div>
      <label className="field">
        <span>Рабочая почта</span>
        <input type="email" value={form.email} onChange={set('email')} required autoComplete="email" />
      </label>
      <label className="field">
        <span>Логин</span>
        <input
          className="mono"
          value={form.username}
          onChange={set('username')}
          required
          pattern="[A-Za-z0-9][A-Za-z0-9._\-]{2,31}"
          autoComplete="username"
          autoCapitalize="none"
        />
        <span className="field-hint">3–32 символа: латиница, цифры, точка, дефис, подчёркивание.</span>
      </label>
      <label className="field">
        <span>Комментарий для администратора</span>
        <textarea
          value={form.comment}
          onChange={set('comment')}
          rows={3}
          maxLength={500}
          placeholder="Отдел, руководитель, зачем нужен доступ"
        />
      </label>
      {/* Honeypot: hidden from people and assistive tech; bots fill it. */}
      <input
        className="hp"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        value={form.website}
        onChange={set('website')}
      />
      {submit.isError && <p className="form-error">{errorMessage(submit.error)}</p>}
      <button className="btn btn-primary btn-lg btn-block" disabled={submit.isPending} aria-busy={submit.isPending}>
        Отправить заявку
        <Send size={18} />
      </button>
      <Link className="btn btn-ghost" to="/">
        <ArrowLeft size={16} />
        Уже есть аккаунт — войти
      </Link>
    </form>
  );
}
