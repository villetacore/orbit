import { Alert, Button, Input, PasswordInput, Skeleton, type ButtonVariant } from '@villetacore/velessoft-ui';
import { Moon, Sun, SunMoon, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { errorMessage } from '../api';
import { useBranding } from '../branding';
import { getTheme, setTheme, type ThemeChoice } from '../lib/theme';

export function BrandMark({ size = 18 }: { size?: number }) {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 32 32">
        <circle cx="16" cy="16" r="6" fill="currentColor" />
        <ellipse
          cx="16"
          cy="16"
          rx="14"
          ry="6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          transform="rotate(-30 16 16)"
        />
      </svg>
    </span>
  );
}

// VelessoftMark is the studio's VS sign from the velessoft design system.
export function VelessoftMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={(size * 100) / 120} viewBox="0 0 120 100" fill="none" aria-hidden="true">
      <path d="M6 22 31 88H45L79 9H61L37 67 23 22Z" fill="currentColor" />
      <path
        d="M88 10C104 9 115 18 116 30H100C99 25 94 23 87 25ZM83 39C96 43 116 46 116 64C116 83 98 94 76 88L64 82 71 67C82 76 99 75 99 66C99 60 88 59 76 54Z"
        fill="currentColor"
      />
    </svg>
  );
}

// Signature links a product to the studio ("by velessoft").
export function Signature() {
  return (
    <span className="signature">
      <VelessoftMark size={18} />
      by velessoft
    </span>
  );
}

const themeOrder: ThemeChoice[] = ['system', 'light', 'dark'];
const themeInfo: Record<ThemeChoice, { label: string; icon: LucideIcon }> = {
  system: { label: 'Тема: как в системе', icon: SunMoon },
  light: { label: 'Тема: светлая', icon: Sun },
  dark: { label: 'Тема: тёмная', icon: Moon },
};

export function ThemeSwitch() {
  const [theme, setChoice] = useState<ThemeChoice>(getTheme);
  const { label, icon: Icon } = themeInfo[theme];
  return (
    <Button
      variant="ghost"
      size="sm"
      block
      className="with-icon"
      onClick={() => {
        const next = themeOrder[(themeOrder.indexOf(theme) + 1) % themeOrder.length]!;
        setTheme(next);
        setChoice(next);
      }}
      aria-label={`${label}. Переключить`}
    >
      <Icon size={16} />
      {label}
    </Button>
  );
}

// Brand renders the uploaded logo, or the mark with the portal name.
export function Brand({ markSize }: { markSize?: number }) {
  const { appName, logoUrl } = useBranding();
  if (logoUrl) {
    return <img className="brand-logo" src={logoUrl} alt={appName} />;
  }
  return (
    <>
      <BrandMark size={markSize} />
      {appName}
    </>
  );
}

// LinkButton is a router link that looks like the design system's Button.
export function LinkButton({
  to,
  variant = 'secondary',
  size,
  children,
}: {
  to: string;
  variant?: ButtonVariant;
  size?: 'sm' | 'lg';
  children: ReactNode;
}) {
  return (
    <Link to={to} className={`vs-button vs-${variant}${size ? ` vs-${size}` : ''} with-icon`}>
      {children}
    </Link>
  );
}

export function ErrorAlert({ error, title }: { error: unknown; title?: string }) {
  if (error === null || error === undefined) return null;
  return (
    <Alert tone="error" title={title}>
      {errorMessage(error)}
    </Alert>
  );
}

export function Loading({ height = 200, count = 1 }: { height?: number; count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} height={height} />
      ))}
    </>
  );
}

// ReauthFields ask for the current password (and one-time code, if the user has
// one) before a sensitive change.
export function ReauthFields({
  password,
  otp,
  onPassword,
  onOtp,
  hasOtp,
}: {
  password: string;
  otp: string;
  onPassword: (v: string) => void;
  onOtp: (v: string) => void;
  hasOtp: boolean;
}) {
  return (
    <>
      <PasswordInput
        label="Текущий пароль"
        showLabel="Показать"
        hideLabel="Скрыть"
        value={password}
        onChange={(e) => onPassword(e.target.value)}
        autoComplete="current-password"
        required
      />
      {hasOtp && (
        <Input
          label="Код подтверждения"
          value={otp}
          onChange={(e) => onOtp(e.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          hint="Из приложения-аутентификатора."
          required
        />
      )}
    </>
  );
}
