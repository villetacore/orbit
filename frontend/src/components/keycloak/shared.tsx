import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  Dialog,
  Drawer,
  EmptyState,
  Input,
  MultiSelect,
  NumberInput,
  SearchInput,
  Select,
  Switch,
  Table,
  Textarea,
  useToast,
  type TableColumn,
} from '@villetacore/velessoft-ui';
import { Inbox, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { kc } from '@/api';
import { ErrorAlert, Loading } from '@/components/ui';
import { getPath, parseJSON, setPath } from '@/lib/settings';

export type Rep = Record<string, unknown>;

// --- Declarative settings fields ------------------------------------------

export type FieldType = 'text' | 'textarea' | 'password' | 'number' | 'seconds' | 'bool' | 'boolString' | 'select' | 'list' | 'lines';

export interface Field {
  key: string;
  label: string;
  type?: FieldType;
  hint?: string;
  options?: { value: string; label: string }[];
}

const durationHint = (seconds: unknown) => {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return 'секунды';
  if (n % 86400 === 0) return `секунды · ${n / 86400} сут.`;
  if (n % 3600 === 0) return `секунды · ${n / 3600} ч`;
  if (n % 60 === 0) return `секунды · ${n / 60} мин`;
  return 'секунды';
};

// SettingsFields renders a list of fields bound to one representation.
export function SettingsFields({ fields, value, onChange }: { fields: Field[]; value: Rep; onChange: (next: Rep) => void }) {
  const set = (key: string, v: unknown) => onChange(setPath(value, key, v));
  return (
    <div className="settings-fields">
      {fields.map((f) => {
        const v = getPath(value, f.key);
        switch (f.type ?? 'text') {
          case 'bool':
            return <Switch key={f.key} label={<FieldLabel field={f} />} checked={v === true} onChange={(e) => set(f.key, e.target.checked)} />;
          case 'boolString':
            return <Switch key={f.key} label={<FieldLabel field={f} />} checked={v === 'true'} onChange={(e) => set(f.key, String(e.target.checked))} />;
          case 'number':
            return <NumberInput key={f.key} label={f.label} hint={f.hint} value={numberValue(v)} onChange={(e) => set(f.key, toNumber(e.target.value))} />;
          case 'seconds':
            return <NumberInput key={f.key} label={f.label} hint={f.hint ?? durationHint(v)} min={0} value={numberValue(v)} onChange={(e) => set(f.key, toNumber(e.target.value))} />;
          case 'select':
            return (
              <Select key={f.key} label={f.label} hint={f.hint} value={String(v ?? '')} onChange={(e) => set(f.key, e.target.value)}>
                {!f.options?.some((o) => o.value === String(v ?? '')) && <option value={String(v ?? '')}>{String(v ?? '') || '—'}</option>}
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            );
          case 'textarea':
            return <Textarea key={f.key} label={f.label} hint={f.hint} rows={3} value={String(v ?? '')} onChange={(e) => set(f.key, e.target.value)} />;
          case 'password':
            return <Input key={f.key} label={f.label} hint={f.hint} type="password" autoComplete="new-password" value={String(v ?? '')} onChange={(e) => set(f.key, e.target.value)} />;
          case 'list':
            return (
              <Input
                key={f.key}
                label={f.label}
                hint={f.hint ?? 'Через запятую.'}
                value={Array.isArray(v) ? v.join(', ') : ''}
                onChange={(e) => set(f.key, splitList(e.target.value, /,/))}
              />
            );
          case 'lines':
            return (
              <Textarea
                key={f.key}
                label={f.label}
                hint={f.hint ?? 'Каждое значение с новой строки.'}
                rows={3}
                value={Array.isArray(v) ? v.join('\n') : ''}
                onChange={(e) => set(f.key, splitList(e.target.value, /\n/))}
              />
            );
          default:
            return <Input key={f.key} label={f.label} hint={f.hint} value={String(v ?? '')} onChange={(e) => set(f.key, e.target.value)} />;
        }
      })}
    </div>
  );
}

function FieldLabel({ field }: { field: Field }) {
  return (
    <span className="switch-label">
      {field.label}
      {field.hint && <small>{field.hint}</small>}
    </span>
  );
}

const numberValue = (v: unknown) => (v === undefined || v === null ? '' : String(v));
const toNumber = (s: string) => (s === '' ? undefined : Number(s));
// Keeps trailing separators out of the stored list while typing stays natural
// enough: an empty last item is dropped only on the way to Keycloak.
const splitList = (s: string, sep: RegExp) => s.split(sep).map((x) => x.trim()).filter((x, i, all) => x !== '' || i === all.length - 1);
const cleanLists = (rep: Rep): Rep =>
  Object.fromEntries(
    Object.entries(rep).map(([k, v]) => [
      k,
      Array.isArray(v) ? v.filter((x) => x !== '') : v !== null && typeof v === 'object' ? cleanLists(v as Rep) : v,
    ]),
  );

// useRepresentation loads a Keycloak object into an editable draft.
export function useRepresentation(path: string, queryKey: unknown[]) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const query = useQuery({ queryKey, queryFn: () => kc.get<Rep>(path) });
  const [draft, setDraft] = useState<Rep | null>(null);
  const value = draft ?? query.data ?? null;
  const save = useMutation({
    mutationFn: (rep: Rep) => kc.put(path, cleanLists(rep)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
      setDraft(null);
      toast({ tone: 'success', title: 'Сохранено в Keycloak' });
    },
  });
  return { query, value, setDraft, dirty: draft !== null, reset: () => setDraft(null), save };
}

export function SaveBar({ dirty, save, onSave, onReset }: { dirty: boolean; save: { isPending: boolean; error: unknown }; onSave: () => void; onReset: () => void }) {
  return (
    <>
      <ErrorAlert error={save.error} />
      <div className="save-bar">
        <Button variant="primary" onClick={onSave} disabled={!dirty} loading={save.isPending}>
          Сохранить
        </Button>
        {dirty && (
          <Button variant="ghost" onClick={onReset}>
            Отменить изменения
          </Button>
        )}
      </div>
    </>
  );
}

// --- JSON editing: the way to reach every field Keycloak has ---------------

export function JsonEditor({
  value,
  onSave,
  saving,
  error,
  readOnly,
  label = 'Представление Keycloak (JSON)',
  saveLabel = 'Сохранить',
}: {
  value: unknown;
  onSave?: (next: Rep) => void;
  saving?: boolean;
  error?: unknown;
  readOnly?: boolean;
  label?: string;
  saveLabel?: string;
}) {
  const initial = useMemo(() => JSON.stringify(value, null, 2), [value]);
  const [text, setText] = useState(initial);
  const parsed = parseJSON(text);
  return (
    <div className="stack">
      <Textarea
        className="json-editor"
        label={label}
        value={text}
        rows={18}
        spellCheck={false}
        readOnly={readOnly}
        onChange={(e) => setText(e.target.value)}
        error={parsed.ok ? undefined : parsed.error}
      />
      <ErrorAlert error={error} />
      {!readOnly && onSave && (
        <div className="row">
          <Button variant="primary" loading={saving} disabled={!parsed.ok || text === initial} onClick={() => parsed.ok && onSave(parsed.value as Rep)}>
            {saveLabel}
          </Button>
        </div>
      )}
    </div>
  );
}

// --- Confirmation ---------------------------------------------------------

export function ConfirmDialog({
  title,
  children,
  confirmLabel = 'Удалить',
  onConfirm,
  onClose,
  pending,
  error,
}: {
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
  pending?: boolean;
  error?: unknown;
}) {
  return (
    <Dialog
      open
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Отмена
          </Button>
          <Button variant="danger" onClick={onConfirm} loading={pending}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="stack">
        {children}
        <ErrorAlert error={error} />
      </div>
    </Dialog>
  );
}

// --- Role mappings for users and groups -----------------------------------

interface Role {
  id: string;
  name: string;
  description?: string;
  composite?: boolean;
  clientRole?: boolean;
  containerId?: string;
}

interface ClientRef {
  id: string;
  clientId: string;
}

function diff(current: Role[], wanted: string[], available: Role[]) {
  const have = new Set(current.map((r) => r.id));
  return {
    add: available.filter((r) => wanted.includes(r.id) && !have.has(r.id)),
    remove: current.filter((r) => !wanted.includes(r.id)),
  };
}

function RolePicker({ label, listPath, mappingPath, queryPrefix }: { label: string; listPath: string; mappingPath: string; queryPrefix: unknown[] }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const roles = useQuery({ queryKey: ['kc', listPath, 'all'], queryFn: () => kc.get<Role[]>(`${listPath}?max=500`) });
  const assigned = useQuery({ queryKey: [...queryPrefix, mappingPath], queryFn: () => kc.get<Role[]>(mappingPath) });
  const [wanted, setWanted] = useState<string[] | null>(null);
  const current = assigned.data ?? [];
  const selected = wanted ?? current.map((r) => r.id);
  const options = useMemo(() => {
    const byId = new Map<string, Role>();
    for (const r of [...(roles.data ?? []), ...current]) byId.set(r.id, r);
    return [...byId.values()].map((r) => ({ value: r.id, label: r.description ? `${r.name} — ${r.description}` : r.name }));
  }, [roles.data, current]);

  const save = useMutation({
    mutationFn: async () => {
      const { add, remove } = diff(current, selected, roles.data ?? []);
      if (add.length) await kc.post(mappingPath, add);
      if (remove.length) await kc.del(mappingPath, remove);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryPrefix });
      setWanted(null);
      toast({ tone: 'success', title: 'Роли обновлены' });
    },
  });

  if (roles.isPending || assigned.isPending) return <Loading height={160} />;
  return (
    <div className="stack">
      <ErrorAlert error={roles.error ?? assigned.error} />
      <MultiSelect label={label} searchLabel="Найти роль" emptyText="Ролей нет" options={options} value={selected} onValueChange={setWanted} />
      <ErrorAlert error={save.error} />
      <div className="row">
        <Button variant="primary" disabled={wanted === null} loading={save.isPending} onClick={() => save.mutate()}>
          Применить
        </Button>
      </div>
    </div>
  );
}

// RoleMapping assigns realm and client roles to a user or group at basePath.
export function RoleMapping({ basePath }: { basePath: string }) {
  const clients = useQuery({ queryKey: ['kc', 'clients', 'refs'], queryFn: () => kc.get<ClientRef[]>('/clients?max=500') });
  const [client, setClient] = useState('');
  const prefix = ['kc', basePath, 'roles'];
  return (
    <div className="stack">
      <RolePicker label="Роли realm" listPath="/roles" mappingPath={`${basePath}/role-mappings/realm`} queryPrefix={prefix} />
      <Select label="Роли клиента" value={client} onChange={(e) => setClient(e.target.value)}>
        <option value="">Выберите клиента…</option>
        {clients.data?.map((c) => (
          <option key={c.id} value={c.id}>
            {c.clientId}
          </option>
        ))}
      </Select>
      {client && (
        <RolePicker key={client} label="Назначенные роли клиента" listPath={`/clients/${client}/roles`} mappingPath={`${basePath}/role-mappings/clients/${client}`} queryPrefix={prefix} />
      )}
    </div>
  );
}

// --- Generic resource list: list, create, edit as JSON, delete --------------

export interface ResourceConfig<T extends Rep> {
  title: string;
  description?: string;
  listPath: string;
  /** Path of one item, relative to the realm. */
  itemPath: (row: T) => string;
  createPath?: string;
  rowKey: (row: T) => string;
  columns: TableColumn<T>[];
  template?: Rep;
  search?: (row: T) => string;
  deleteLabel?: (row: T) => string;
  readOnly?: boolean;
  emptyText?: string;
  notice?: ReactNode;
}

export function ResourceList<T extends Rep>({ config }: { config: ResourceConfig<T> }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const key = ['kc', config.listPath];
  const list = useQuery({ queryKey: key, queryFn: () => kc.get<T[]>(config.listPath) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const [editing, setEditing] = useState<T | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<T | null>(null);
  const [query, setQuery] = useState('');

  const save = useMutation({
    mutationFn: (rep: Rep) => kc.put(config.itemPath(editing!), rep),
    onSuccess: async () => {
      await refresh();
      setEditing(null);
      toast({ tone: 'success', title: 'Сохранено в Keycloak' });
    },
  });
  const create = useMutation({
    mutationFn: (rep: Rep) => kc.post(config.createPath ?? config.listPath, rep),
    onSuccess: async () => {
      await refresh();
      setCreating(false);
      toast({ tone: 'success', title: 'Создано в Keycloak' });
    },
  });
  const remove = useMutation({
    mutationFn: (row: T) => kc.del(config.itemPath(row)),
    onSuccess: async () => {
      await refresh();
      setDeleting(null);
    },
  });

  const rows = (list.data ?? []).filter((r) => !query || !config.search || config.search(r).toLowerCase().includes(query.toLowerCase()));

  return (
    <Card
      flat
      title={config.title}
      description={config.description}
      actions={
        !config.readOnly && config.template ? (
          <Button size="sm" variant="primary" className="with-icon" onClick={() => setCreating(true)}>
            <Plus size={14} />
            Создать
          </Button>
        ) : undefined
      }
    >
      {config.notice}
      {config.search && <SearchInput label="Поиск" clearLabel="Очистить" value={query} onValueChange={setQuery} />}
      {list.isPending && <Loading height={200} />}
      <ErrorAlert error={list.error} />
      {list.isSuccess && rows.length === 0 && <EmptyState icon={<Inbox size={20} />} title={config.emptyText ?? 'Пусто'} />}
      {rows.length > 0 && (
        <Table
          compact
          rows={rows}
          rowKey={config.rowKey}
          columns={[
            ...config.columns,
            {
              key: '__actions',
              header: <span className="vs-visually-hidden">Действия</span>,
              align: 'right',
              render: (row) => (
                <span className="row end">
                  <Button size="sm" variant="ghost" className="with-icon" onClick={() => setEditing(row)}>
                    <Pencil size={14} />
                    {config.readOnly ? 'Открыть' : 'Изменить'}
                  </Button>
                  {!config.readOnly && (
                    <Button size="sm" variant="ghost" className="with-icon" onClick={() => setDeleting(row)}>
                      <Trash2 size={14} />
                      Удалить
                    </Button>
                  )}
                </span>
              ),
            },
          ]}
        />
      )}
      {editing && (
        <Drawer open title={config.deleteLabel?.(editing) ?? 'Объект'} onClose={() => setEditing(null)} className="wide-drawer">
          <JsonEditor value={editing} readOnly={config.readOnly} onSave={(rep) => save.mutate(rep)} saving={save.isPending} error={save.error} />
        </Drawer>
      )}
      {creating && config.template && (
        <Drawer open title={`Новый объект: ${config.title}`} onClose={() => setCreating(false)} className="wide-drawer">
          <JsonEditor value={config.template} saveLabel="Создать" onSave={(rep) => create.mutate(rep)} saving={create.isPending} error={create.error} />
        </Drawer>
      )}
      {deleting && (
        <ConfirmDialog
          title={`Удалить «${config.deleteLabel?.(deleting) ?? config.rowKey(deleting)}»?`}
          onClose={() => setDeleting(null)}
          onConfirm={() => remove.mutate(deleting)}
          pending={remove.isPending}
          error={remove.error}
        >
          <p>Действие сразу применится в Keycloak и не отменяется.</p>
        </ConfirmDialog>
      )}
    </Card>
  );
}

export const yesNo = (v: unknown, yes = 'Включён', no = 'Выключен') => (
  <Badge tone={v === false ? 'neutral' : 'success'} dot>
    {v === false ? no : yes}
  </Badge>
);

