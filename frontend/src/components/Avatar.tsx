import { initials } from '../lib/format';

interface Props {
  url: string;
  name: string;
  size?: number;
}

export function Avatar({ url, name, size = 40 }: Props) {
  const style = { width: size, height: size, fontSize: size * 0.4 };
  if (url) {
    return <img className="avatar" src={url} alt="" width={size} height={size} style={style} />;
  }
  return (
    <span className="avatar avatar-fallback" style={style} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
