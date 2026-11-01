export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0]![0], parts[1]![0]] : [...(parts[0] ?? '?')].slice(0, 2);
  return letters.join('').toUpperCase();
}

// hueFor maps a string to a stable hue so monograms keep their color.
export function hueFor(key: string): number {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return h % 360;
}

const attributeLabels: Record<string, string> = {
  phoneNumber: 'Телефон',
  jobTitle: 'Должность',
  department: 'Подразделение',
};

export function attributeLabel(name: string): string {
  return attributeLabels[name] ?? name;
}

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return 'Доброй ночи';
  if (h < 12) return 'Доброе утро';
  if (h < 18) return 'Добрый день';
  return 'Добрый вечер';
}

const dateFormat = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long' });
const dateTimeFormat = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });
const relative = new Intl.RelativeTimeFormat('ru-RU', { numeric: 'auto' });

export function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return dateTimeFormat.format(new Date(iso));
}

export function formatRelative(iso: string, now = Date.now()): string {
  const diff = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return 'только что';
  if (abs < 3600) return relative.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return relative.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 7) return relative.format(Math.round(diff / 86400), 'day');
  return formatDateTime(iso);
}

export function plural(n: number, one: string, few: string, many: string): string {
  const r10 = n % 10;
  const r100 = n % 100;
  if (r10 === 1 && r100 !== 11) return one;
  if (r10 >= 2 && r10 <= 4 && (r100 < 12 || r100 > 14)) return few;
  return many;
}
