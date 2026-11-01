export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0]![0], parts[1]![0]] : [...(parts[0] ?? '?')].slice(0, 2);
  return letters.join('').toUpperCase();
}

const attributeLabels: Record<string, string> = {
  phoneNumber: 'Телефон',
  jobTitle: 'Должность',
  department: 'Подразделение',
};

export function attributeLabel(name: string): string {
  return attributeLabels[name] ?? name;
}

const dateFormat = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long' });
const dateTimeFormat = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'medium' });

export function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return dateTimeFormat.format(new Date(iso));
}
