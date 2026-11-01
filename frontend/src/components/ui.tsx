import { X, type LucideIcon } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';

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
