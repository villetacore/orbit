'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, Input, Select, Switch, Table, Tabs, useToast } from '@villetacore/velessoft-ui';
import { Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { kc } from '@/api';
import { ErrorAlert, Loading } from '@/components/ui';
import { formatPolicy, parsePolicy, type PolicyEntry } from '@/lib/settings';
import { realmKey } from './Realm';
import { SaveBar, SettingsFields, useRepresentation, type Field, type Rep } from './shared';

interface RequiredAction extends Rep {
  alias: string;
  name: string;
  enabled: boolean;
  defaultAction: boolean;
}

interface Flow extends Rep {
  id: string;
  alias: string;
  description?: string;
  builtIn: boolean;
  topLevel: boolean;
}

interface Execution extends Rep {
  id: string;
  requirement: string;
  displayName: string;
  level: number;
  requirementChoices: string[];
  authenticationFlow?: boolean;
  configurable?: boolean;
}

const bindings = (flows: Flow[]): Field[] => {
  const options = flows.filter((f) => f.topLevel !== false).map((f) => ({ value: f.alias, label: f.alias }));
  const field = (key: string, label: string, hint?: string): Field => ({ key, label, hint, type: 'select', options });
  return [
    field('browserFlow', 'Вход через браузер'),
    field('directGrantFlow', 'Direct grant', 'Этим потоком идёт вход на странице Orbit.'),
    field('registrationFlow', 'Регистрация'),
    field('resetCredentialsFlow', 'Сброс пароля'),
    field('clientAuthenticationFlow', 'Аутентификация клиентов'),
    field('dockerAuthenticationFlow', 'Docker'),
  ];
};

export function AuthenticationAdmin() {
  return (
    <Tabs
      label="Аутентификация"
      items={[
        { value: 'actions', label: 'Обязательные действия', content: <RequiredActions /> },
        { value: 'policy', label: 'Политика паролей', content: <PasswordPolicy /> },
        { value: 'flows', label: 'Потоки', content: <Flows /> },
      ]}
    />
  );
}

function RequiredActions() {
  const queryClient = useQueryClient();
  const key = ['kc', 'required-actions'];
  const actions = useQuery({ queryKey: key, queryFn: () => kc.get<RequiredAction[]>('/authentication/required-actions') });
  const save = useMutation({
    mutationFn: (a: RequiredAction) => kc.put(`/authentication/required-actions/${encodeURIComponent(a.alias)}`, a),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  return (
    <Card flat title="Обязательные действия" description="«По умолчанию» назначается каждому новому пользователю.">
      {actions.isPending && <Loading height={240} />}
      <ErrorAlert error={actions.error ?? save.error} />
      {actions.isSuccess && (
        <Table
          compact
          rows={actions.data}
          rowKey={(a) => a.alias}
          columns={[
            {
              key: 'name',
              header: 'Действие',
              render: (a) => (
                <span className="row-text">
                  <strong>{a.name}</strong>
                  <small className="mono">{a.alias}</small>
                </span>
              ),
            },
            {
              key: 'enabled',
              header: 'Включено',
              render: (a) => <Switch label={<span className="vs-visually-hidden">Включено: {a.name}</span>} checked={a.enabled} onChange={(e) => save.mutate({ ...a, enabled: e.target.checked })} />,
            },
            {
              key: 'default',
              header: 'По умолчанию',
              render: (a) => (
                <Switch
                  label={<span className="vs-visually-hidden">По умолчанию: {a.name}</span>}
                  checked={a.defaultAction}
                  disabled={!a.enabled}
                  onChange={(e) => save.mutate({ ...a, defaultAction: e.target.checked })}
                />
              ),
            },
          ]}
        />
      )}
    </Card>
  );
}

function PasswordPolicy() {
  const { value, query, save } = useRepresentation('', realmKey);
  const info = useQuery({ queryKey: ['kc', 'serverinfo'], queryFn: kc.serverInfo, staleTime: 10 * 60_000 });
  const [entries, setEntries] = useState<PolicyEntry[] | null>(null);
  const [adding, setAdding] = useState('');
  const current = parsePolicy(value?.passwordPolicy as string | undefined);
  const list = entries ?? current;
  const available = info.data?.passwordPolicies ?? [];
  const labelOf = (id: string) => available.find((p) => p.id === id)?.displayName ?? id;
  const dirty = entries !== null;

  useEffect(() => {
    if (save.isSuccess) setEntries(null);
  }, [save.isSuccess]);

  if (query.isPending) return <Loading height={200} />;
  return (
    <Card flat title="Политика паролей" description="Применяется и к паролям, заданным в Orbit.">
      <ErrorAlert error={query.error ?? info.error} />
      <Table
        compact
        rows={list}
        rowKey={(e) => e.id}
        emptyText="Ограничений нет"
        columns={[
          { key: 'name', header: 'Правило', render: (e) => labelOf(e.id) },
          {
            key: 'value',
            header: 'Значение',
            render: (e) =>
              available.find((p) => p.id === e.id)?.defaultValue === undefined && e.value === '' ? (
                '—'
              ) : (
                <Input
                  label={labelOf(e.id)}
                  className="compact-input"
                  value={e.value}
                  onChange={(ev) => setEntries(list.map((x) => (x.id === e.id ? { ...x, value: ev.target.value } : x)))}
                />
              ),
          },
          {
            key: 'a',
            header: <span className="vs-visually-hidden">Действия</span>,
            align: 'right',
            render: (e) => (
              <Button size="sm" variant="ghost" className="with-icon" onClick={() => setEntries(list.filter((x) => x.id !== e.id))}>
                <Trash2 size={14} />
                Убрать
              </Button>
            ),
          },
        ]}
      />
      <Select
        label="Добавить правило"
        value={adding}
        onChange={(e) => {
          const p = available.find((x) => x.id === e.target.value);
          if (p) setEntries([...list, { id: p.id, value: p.defaultValue ?? '' }]);
          setAdding('');
        }}
      >
        <option value="">Выберите…</option>
        {available
          .filter((p) => !list.some((e) => e.id === p.id))
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName}
            </option>
          ))}
      </Select>
      <SaveBar dirty={dirty} save={save} onReset={() => setEntries(null)} onSave={() => value && save.mutate({ ...value, passwordPolicy: formatPolicy(list) })} />
    </Card>
  );
}

function Flows() {
  const flows = useQuery({ queryKey: ['kc', 'flows'], queryFn: () => kc.get<Flow[]>('/authentication/flows') });
  const { value, query, setDraft, dirty, reset, save } = useRepresentation('', realmKey);
  const [alias, setAlias] = useState('');
  const selected = alias || flows.data?.[0]?.alias || '';

  return (
    <div className="stack">
      <Card flat title="Привязка потоков" description="Какой поток работает в каком сценарии.">
        {(query.isPending || flows.isPending) && <Loading height={160} />}
        <ErrorAlert error={query.error ?? flows.error} />
        {value && flows.data && (
          <>
            <SettingsFields fields={bindings(flows.data)} value={value} onChange={setDraft} />
            <SaveBar dirty={dirty} save={save} onReset={reset} onSave={() => save.mutate(value)} />
          </>
        )}
      </Card>
      {flows.data && (
        <Card flat title="Шаги потока" description="Встроенные потоки Keycloak разрешает менять частично; копию можно сделать в разделе «REST-консоль».">
          <Select label="Поток" value={selected} onChange={(e) => setAlias(e.target.value)}>
            {flows.data.map((f) => (
              <option key={f.id} value={f.alias}>
                {f.alias}
                {f.builtIn ? ' (встроенный)' : ''}
              </option>
            ))}
          </Select>
          {selected && <Executions key={selected} alias={selected} />}
        </Card>
      )}
    </div>
  );
}

function Executions({ alias }: { alias: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const key = ['kc', 'flows', alias];
  const path = `/authentication/flows/${encodeURIComponent(alias)}/executions`;
  const executions = useQuery({ queryKey: key, queryFn: () => kc.get<Execution[]>(path) });
  const update = useMutation({
    mutationFn: (e: Execution) => kc.put(path, e),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: key });
      toast({ tone: 'success', title: 'Шаг обновлён' });
    },
  });
  if (executions.isPending) return <Loading height={160} />;
  return (
    <>
      <ErrorAlert error={executions.error ?? update.error} />
      <Table
        compact
        rows={executions.data ?? []}
        rowKey={(e) => e.id}
        emptyText="В потоке нет шагов"
        columns={[
          {
            key: 'name',
            header: 'Шаг',
            render: (e) => (
              <span style={{ paddingLeft: e.level * 16 }}>
                {e.displayName} {e.authenticationFlow && <Badge>подпоток</Badge>}
              </span>
            ),
          },
          {
            key: 'requirement',
            header: 'Требование',
            render: (e) => (
              <Select label={`Требование: ${e.displayName}`} className="compact-select" value={e.requirement} onChange={(ev) => update.mutate({ ...e, requirement: ev.target.value })}>
                {e.requirementChoices.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            ),
          },
        ]}
      />
    </>
  );
}

