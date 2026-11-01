import { Moon, Sun, SunMoon, X, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
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
    <button
      type="button"
      className="theme-switch"
      onClick={() => {
        const next = themeOrder[(themeOrder.indexOf(theme) + 1) % themeOrder.length]!;
        setTheme(next);
        setChoice(next);
      }}
      aria-label={`${label}. Переключить`}
    >
      <Icon size={18} />
      {label}
    </button>
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

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions}
    </header>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  text,
  action,
}: {
  icon: LucideIcon;
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={20} />
      </span>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ height, count = 1 }: { height: number; count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton" style={{ height }} aria-hidden="true" />
      ))}
    </>
  );
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
}

interface OverlayProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

function OverlayHead({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="overlay-head">
      <h2>{title}</h2>
      <button className="icon-btn" onClick={onClose} aria-label="Закрыть" type="button">
        <X size={18} />
      </button>
    </div>
  );
}

export function Modal({ title, onClose, children, footer }: OverlayProps) {
  useEscape(onClose);
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <OverlayHead title={title} onClose={onClose} />
        {children}
        {footer && <div className="overlay-foot">{footer}</div>}
      </div>
    </>
  );
}

export function Drawer({ title, onClose, children, footer }: OverlayProps) {
  useEscape(onClose);
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <OverlayHead title={title} onClose={onClose} />
        <div className="drawer-body">{children}</div>
        {footer && <div className="overlay-foot">{footer}</div>}
      </aside>
    </>
  );
}
