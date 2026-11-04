import { hueFor, initials } from '../lib/format';
import type { CSSProperties } from 'react';

interface Props {
  url: string;
  name: string;
  size?: number;
}

// The design system's Avatar has three fixed sizes; profile screens need larger
// ones, so this keeps its look with a free size and a stable per-person hue.
export function Avatar({ url, name, size = 40 }: Props) {
  const style = { width: size, height: size, fontSize: size * 0.38, '--hue': hueFor(name) } as CSSProperties;
  if (url) {
    return <img className="vs-avatar person-avatar" src={url} alt="" style={style} />;
  }
  return (
    <span className="vs-avatar person-avatar person-avatar-empty" style={style} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
