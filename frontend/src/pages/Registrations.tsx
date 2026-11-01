import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CheckCircle2, Copy, KeyRound, Mail, UserPlus, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { api, errorMessage, type ApproveResult, type Registration, type RegistrationStatus } from '../api';
import { EmptyState, Modal, Skeleton } from '../components/ui';
import { formatDateTime, formatRelative } from '../lib/format';

export const registrationsKey = ['admin', 'registrations'] as const;

const filters: { value: RegistrationStatus; label: string }[] = [
  { value: 'pending', label: 'Ожидают' },
  { value: 'approved', label: 'Одобрены' },
  { value: 'rejected', label: 'Отклонены' },
];

export function Registrations() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<RegistrationStatus>('pending');
  const regs = useQuery({ queryKey: [...registrationsKey, status], queryFn: () => api.admin.registrations(status) });
  const [result, setResult] = useState<ApproveResult | null>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: registrationsKey });
    void queryClient.invalidateQueries({ queryKey: ['users'] });
  };
  const approve = useMutation({
    mutationFn: (r: Registration) => api.admin.approveRegistration(r.id, 'auto'),
    onSuccess: (res) => {
      setResult(res);
      refresh();
    },
  });
  const reject = useMutation({
    mutationFn: (r: Registration) => api.admin.rejectRegistration(r.id),
    onSuccess: refresh,
  });
  const error = approve.error ?? reject.error;

  return (
    <section className="section">
      <div className="section-head">
        <div className="segmented" role="tablist" aria-label="Статус заявок">
          {filters.map((f) => (
            <button key={f.value} role="tab" aria-selected={status === f.value} onClick={() => setStatus(f.value)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <p className="field-hint">
        Одобрение создаёт учётную запись в Keycloak. Пароль пользователь задаёт сам по ссылке из письма; если realm не
        может отправить почту, Orbit покажет временный пароль — передайте его заявителю.
      </p>
      {error && <p className="form-error">{errorMessage(error)}</p>}
      {regs.isPending && <Skeleton height={200} />}
      {regs.isError && <p className="form-error">{errorMessage(regs.error)}</p>}
      {regs.isSuccess && regs.data.registrations.length === 0 && (
        <EmptyState
          icon={UserPlus}
          title={status === 'pending' ? 'Новых заявок нет' : 'Здесь пока пусто'}
          text={
            status === 'pending'
              ? 'Заявки появляются, когда кто-то заполняет форму «Подать заявку» на странице входа.'
              : undefined
          }
        />
      )}
      {regs.isSuccess && regs.data.registrations.length > 0 && (
        <div className="card table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Заявитель</th>
                <th>Логин</th>
                <th>Комментарий</th>
                <th>Подана</th>
                <th>
                  <span className="sr-only">Действия</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {regs.data.registrations.map((r) => {
                const busy =
                  (approve.isPending && approve.variables?.id === r.id) ||
                  (reject.isPending && reject.variables?.id === r.id);
                return (
                  <tr key={r.id}>
                    <td>
                      <div className="cell-service">
                        <div>
                          <strong>
                            {r.firstName} {r.lastName}
                          </strong>
                          <span className="mono">{r.email}</span>
                        </div>
                      </div>
                    </td>
                    <td className="mono">{r.username}</td>
                    <td>{r.comment || <span className="muted">—</span>}</td>
                    <td className="nowrap" title={formatDateTime(r.createdAt)}>
                      {formatRelative(r.createdAt)}
                    </td>
                    <td className="cell-actions">
                      {r.status === 'pending' ? (
                        <span className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                          <button
                            className="btn btn-sm btn-primary"
                            onClick={() => approve.mutate(r)}
                            disabled={busy}
                            aria-busy={busy}
                          >
                            <Check size={15} />
                            Одобрить
                          </button>
                          <button className="btn btn-sm btn-danger" onClick={() => reject.mutate(r)} disabled={busy}>
                            <X size={15} />
                            Отклонить
                          </button>
                        </span>
                      ) : r.status === 'approved' ? (
                        <Link className="btn btn-sm" to={`/people?user=${encodeURIComponent(r.userSub)}`}>
                          Открыть
                        </Link>
                      ) : (
                        <span className="badge badge-danger">Отклонена</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {result && <ApprovedDialog result={result} onClose={() => setResult(null)} />}
    </section>
  );
}

function ApprovedDialog({ result, onClose }: { result: ApproveResult; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const r = result.registration;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.temporaryPassword ?? '');
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Modal
      title="Аккаунт создан"
      onClose={onClose}
      footer={
        <button className="btn btn-primary" onClick={onClose}>
          Готово
        </button>
      }
    >
      <div className="drawer-body form">
        <p>
          Учётная запись <span className="mono">{r.username}</span> для {r.firstName} {r.lastName} создана в Keycloak и
          включена.
        </p>
        {result.delivery === 'email' && (
          <div className="alert alert-ok" role="status">
            <Mail size={16} />
            <span>
              На <strong>{r.email}</strong> отправлено письмо: задать пароль и подтвердить адрес.
            </span>
          </div>
        )}
        {result.delivery === 'password' && (
          <>
            <div className="alert alert-warn" role="status">
              <KeyRound size={16} />
              <span>
                Keycloak не смог отправить письмо. Передайте заявителю временный пароль — при первом входе его нужно
                будет сменить. Пароль показывается только сейчас.
              </span>
            </div>
            <div className="temp-password">
              <code>{result.temporaryPassword}</code>
              <button className="btn btn-sm" onClick={copy}>
                {copied ? <CheckCircle2 size={15} /> : <Copy size={15} />}
                {copied ? 'Скопировано' : 'Копировать'}
              </button>
            </div>
          </>
        )}
        {result.delivery === 'none' && (
          <div className="alert alert-error" role="alert">
            <KeyRound size={16} />
            <span>
              Не удалось ни отправить письмо, ни задать временный пароль. Откройте пользователя в разделе «Люди» и
              отправьте письмо повторно или задайте пароль в консоли Keycloak.
            </span>
          </div>
        )}
      </div>
    </Modal>
  );
}
