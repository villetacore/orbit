import type { CSSProperties } from 'react';
import { hueFor, initials } from '../lib/format';

interface Props {
  url: string;
  name: string;
  size?: number;
}

export function Avatar({ url, name, size = 40 }: Props) {
  if (url) {
    return <img className="avatar" src={url} alt="" width={size} height={size} style={{ width: size, height: size }} />;
  }
  const style = { width: size, height: size, fontSize: size * 0.38, '--hue': hueFor(name) } as CSSProperties;
  return (
    <span className="avatar avatar-fallback" style={style} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
