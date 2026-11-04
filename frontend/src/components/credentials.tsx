import { Badge, Button } from '@villetacore/velessoft-ui';
import { Fingerprint, KeyRound, MonitorSmartphone, ShieldQuestion, Smartphone, type LucideIcon } from 'lucide-react';
import type { AccountSession, Credential } from '@/api';
import { formatDateTime, formatRelative } from '@/lib/format';

// Labels for Keycloak credential types.
const credentialInfo: Record<string, { title: string; icon: LucideIcon }> = {
  password: { title: 'Пароль', icon: KeyRound },
  otp: { title: 'Приложение-аутентификатор', icon: Smartphone },
  webauthn: { title: 'Ключ безопасности', icon: Fingerprint },
  'webauthn-passwordless': { title: 'Passkey', icon: Fingerprint },
};

export function credentialTitle(c: Credential) {
  return credentialInfo[c.type] ?? { title: c.type, icon: ShieldQuestion };
}

export function SessionRow({ session: s, onEnd, busy }: { session: AccountSession; onEnd?: () => void; busy?: boolean }) {
  return (
    <li>
      <MonitorSmartphone size={18} />
      <span className="row-text">
        <strong>
          <span className="mono">{s.ipAddress || 'IP неизвестен'}</span>{' '}
          {s.current && (
            <Badge tone="info" variant="solid">
              Эта сессия
            </Badge>
          )}
        </strong>
        <small>
          {s.clients.length > 0 ? <span className="mono">{s.clients.join(', ')}</span> : 'без приложений'} · активна{' '}
          {formatRelative(s.lastAccess)} · вход {formatDateTime(s.started)}
        </small>
      </span>
      {!s.current && onEnd && (
        <Button size="sm" variant="danger" onClick={onEnd} loading={busy}>
          Завершить
        </Button>
      )}
    </li>
  );
}
