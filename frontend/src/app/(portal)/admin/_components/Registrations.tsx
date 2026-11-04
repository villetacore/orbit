import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Button, CodeBlock, Dialog, EmptyState, SegmentedControl, Table } from '@villetacore/velessoft-ui';
import { Check, UserPlus, X } from 'lucide-react';
import { useState } from 'react';
import { api, type ApproveResult, type Registration, type RegistrationStatus } from '@/api';
import { ErrorAlert, LinkButton, Loading } from '@/components/ui';
import { formatDateTime, formatRelative } from '@/lib/format';

export const registrationsKey = ['admin', 'registrations'] as const;

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
  const reject = useMutation({ mutationFn: (r: Registration) => api.admin.rejectRegistration(r.id), onSuccess: refresh });

  return (
    <section className="section">
      <SegmentedControl
        label="Статус заявок"
        value={status}
        onChange={(v) => setStatus(v as RegistrationStatus)}
        options={[
          { value: 'pending', label: 'Ожидают' },
          { value: 'approved', label: 'Одобрены' },
          { value: 'rejected', label: 'Отклонены' },
        ]}
      />
      <p className="hint">
        Одобрение создаёт учётную запись в Keycloak. Пароль пользователь задаёт сам по ссылке из письма; если realm не может
        отправить почту, Orbit покажет временный пароль — передайте его заявителю.
      </p>
      <ErrorAlert error={approve.error ?? reject.error ?? regs.error} />
      {regs.isPending && <Loading height={200} />}
      {regs.isSuccess && regs.data.registrations.length === 0 && (
        <EmptyState
          icon={<UserPlus size={20} />}
          title={status === 'pending' ? 'Новых заявок нет' : 'Здесь пока пусто'}
          description={status === 'pending' ? 'Заявки появляются, когда кто-то заполняет форму на странице входа.' : undefined}
        />
      )}
      {regs.isSuccess && regs.data.registrations.length > 0 && (
        <Table
          rows={regs.data.registrations}
          rowKey={(r) => r.id}
          columns={[
            {
              key: 'who',
              header: 'Заявитель',
              sortValue: (r) => r.lastName,
              render: (r) => (
                <span className="row-text">
                  <strong>
                    {r.firstName} {r.lastName}
                  </strong>
                  <small className="mono">{r.email}</small>
                </span>
              ),
            },
            { key: 'username', header: 'Логин', render: (r) => <span className="mono">{r.username}</span> },
            { key: 'comment', header: 'Комментарий', render: (r) => r.comment || '—' },
            {
              key: 'createdAt',
              header: 'Подана',
              sortValue: (r) => r.createdAt,
              render: (r) => <span title={formatDateTime(r.createdAt)}>{formatRelative(r.createdAt)}</span>,
            },
            {
              key: 'actions',
              header: <span className="vs-visually-hidden">Действия</span>,
              align: 'right',
              render: (r) => {
                if (r.status === 'approved') return <LinkButton size="sm" to={`/people?user=${encodeURIComponent(r.userSub)}`}>Открыть</LinkButton>;
                if (r.status === 'rejected') return <Badge tone="error">Отклонена</Badge>;
                const busy = (approve.isPending && approve.variables?.id === r.id) || (reject.isPending && reject.variables?.id === r.id);
                return (
                  <span className="row end">
                    <Button size="sm" variant="primary" className="with-icon" onClick={() => approve.mutate(r)} disabled={busy}>
                      <Check size={14} />
                      Одобрить
                    </Button>
                    <Button size="sm" variant="danger" className="with-icon" onClick={() => reject.mutate(r)} disabled={busy}>
                      <X size={14} />
                      Отклонить
                    </Button>
                  </span>
                );
              },
            },
          ]}
        />
      )}
      {result && <ApprovedDialog result={result} onClose={() => setResult(null)} />}
    </section>
  );
}

function ApprovedDialog({ result, onClose }: { result: ApproveResult; onClose: () => void }) {
  const r = result.registration;
  return (
    <Dialog
      open
      title="Аккаунт создан"
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={onClose}>
          Готово
        </Button>
      }
    >
      <div className="stack">
        <p>
          Учётная запись <span className="mono">{r.username}</span> для {r.firstName} {r.lastName} создана в Keycloak и включена.
        </p>
        {result.delivery === 'email' && (
          <Alert tone="success">
            На <strong>{r.email}</strong> отправлено письмо: задать пароль и подтвердить адрес.
          </Alert>
        )}
        {result.delivery === 'password' && (
          <>
            <Alert tone="warning">
              Keycloak не смог отправить письмо. Передайте заявителю временный пароль — при первом входе в Orbit его нужно будет
              сменить. Пароль показывается только сейчас.
            </Alert>
            <CodeBlock code={result.temporaryPassword ?? ''} label="Временный пароль" copyLabel="Копировать" copiedLabel="Скопировано" errorLabel="Не удалось" />
          </>
        )}
        {result.delivery === 'none' && (
          <Alert tone="error">
            Не удалось ни отправить письмо, ни задать временный пароль. Задайте пароль в разделе Keycloak → Пользователи.
          </Alert>
        )}
      </div>
    </Dialog>
  );
}
