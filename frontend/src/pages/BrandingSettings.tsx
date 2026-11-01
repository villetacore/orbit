import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, ImageUp, LayoutDashboard, LayoutGrid, RotateCcw, Trash2 } from 'lucide-react';
import { useRef, useState, type ChangeEvent, type CSSProperties, type FormEvent } from 'react';
import { api, errorMessage, type Branding, type BrandingAsset, type BrandingInput } from '../api';
import { brandingQueryKey, defaultBranding } from '../branding';
import { BrandMark, Skeleton } from '../components/ui';
import { contrastRatio, isHexColor, readableOn } from '../lib/color';

const adminBrandingKey = ['admin', 'branding'] as const;

function toInput(b: Branding): BrandingInput {
  const { appName, landingTitle, landingSubtitle, primaryColor, accentColor, supportEmail, supportUrl } = b;
  return { appName, landingTitle, landingSubtitle, primaryColor, accentColor, supportEmail, supportUrl };
}

export function BrandingSettings() {
  const branding = useQuery({ queryKey: adminBrandingKey, queryFn: api.admin.branding });
  // Lives here, not in BrandingForm, because the form remounts after a save.
  const [done, setDone] = useState(false);
  if (branding.isPending) return <Skeleton height={520} />;
  if (branding.isError) return <p className="form-error">{errorMessage(branding.error)}</p>;
  // Remount when the saved version changes so the form starts from it.
  return <BrandingForm key={JSON.stringify(toInput(branding.data))} saved={branding.data} done={done} setDone={setDone} />;
}

interface BrandingFormProps {
  saved: Branding;
  done: boolean;
  setDone: (done: boolean) => void;
}

function BrandingForm({ saved, done, setDone }: BrandingFormProps) {
  const queryClient = useQueryClient();
  const [input, setInput] = useState<BrandingInput>(() => toInput(saved));

  const onSaved = (b: Branding) => {
    queryClient.setQueryData(adminBrandingKey, b);
    queryClient.setQueryData(brandingQueryKey, b);
  };

  const save = useMutation({
    mutationFn: api.admin.updateBranding,
    onSuccess: (b) => {
      onSaved(b);
      setDone(true);
    },
  });

  const dirty = JSON.stringify(input) !== JSON.stringify(toInput(saved));

  function set<K extends keyof BrandingInput>(key: K, value: BrandingInput[K]) {
    setDone(false);
    setInput((prev) => ({ ...prev, [key]: value }));
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate(input);
  }

  const colorsValid = isHexColor(input.primaryColor) && isHexColor(input.accentColor);

  return (
    <div className="settings-grid">
      <form className="page" style={{ gap: 20 }} onSubmit={onSubmit}>
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Название и тексты</h2>
              <p>Показываются в меню, заголовке вкладки и на странице входа.</p>
            </div>
          </div>
          <div className="card-body form">
            <label className="field">
              <span>Название портала</span>
              <input value={input.appName} onChange={(e) => set('appName', e.target.value)} required maxLength={40} />
            </label>
            <label className="field">
              <span>Заголовок страницы входа</span>
              <input
                value={input.landingTitle}
                onChange={(e) => set('landingTitle', e.target.value)}
                maxLength={120}
                placeholder="Корпоративный аккаунт. Всё в одном месте."
              />
            </label>
            <label className="field">
              <span>Подзаголовок</span>
              <textarea
                value={input.landingSubtitle}
                onChange={(e) => set('landingSubtitle', e.target.value)}
                maxLength={300}
                rows={2}
                placeholder="Профиль, доступ к сервисам компании и настройки безопасности…"
              />
              <span className="field-hint">Пустые поля — текст по умолчанию.</span>
            </label>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h2>Цвета</h2>
              <p>Основной — ссылки, активные элементы, бейджи. Акцент — главные кнопки.</p>
            </div>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => {
                set('primaryColor', defaultBranding.primaryColor);
                set('accentColor', defaultBranding.accentColor);
              }}
            >
              <RotateCcw size={14} />
              Палитра velessoft
            </button>
          </div>
          <div className="card-body form">
            <div className="form-row">
              <ColorField label="Основной цвет" value={input.primaryColor} onChange={(v) => set('primaryColor', v)} />
              <ColorField label="Акцентный цвет" value={input.accentColor} onChange={(v) => set('accentColor', v)} contrast />
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h2>Поддержка</h2>
              <p>Ссылка «Поддержка» в меню и «Нужна помощь со входом» на странице входа.</p>
            </div>
          </div>
          <div className="card-body form-row">
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                value={input.supportEmail}
                onChange={(e) => set('supportEmail', e.target.value)}
                placeholder="help@company.ru"
              />
            </label>
            <label className="field">
              <span>Ссылка (приоритетнее email)</span>
              <input
                type="url"
                value={input.supportUrl}
                onChange={(e) => set('supportUrl', e.target.value)}
                placeholder="https://"
              />
            </label>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h2>Файлы</h2>
              <p>PNG, JPEG или WebP. Изображения пересохраняются в PNG; SVG не принимается.</p>
            </div>
          </div>
          <div className="card-body asset-list">
            <AssetField
              asset="favicon"
              title="Фавикон"
              hint="Квадрат, от 16×16 px. Будет приведён к 256×256."
              url={saved.faviconUrl}
              onChange={onSaved}
            />
            <AssetField
              asset="logo"
              title="Логотип"
              hint="Горизонтальный, светлый — меню тёмное. До 480×160 px."
              url={saved.logoUrl}
              onChange={onSaved}
              wide
            />
          </div>
        </section>

        <div className="form-actions sticky-actions">
          <button className="btn btn-primary" type="submit" disabled={!dirty || !colorsValid || save.isPending}>
            {save.isPending ? 'Сохранение…' : 'Сохранить оформление'}
          </button>
          {dirty && (
            <button type="button" className="btn btn-ghost" onClick={() => setInput(toInput(saved))}>
              Отменить
            </button>
          )}
          {done && !dirty && (
            <span className="saved" role="status">
              <Check size={16} />
              Применено для всех пользователей
            </span>
          )}
          {save.isError && (
            <p className="form-error" role="alert">
              {errorMessage(save.error)}
            </p>
          )}
        </div>
      </form>

      <aside className="settings-preview">
        <h3 className="muted small" style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Предпросмотр
        </h3>
        <Preview input={input} logoUrl={saved.logoUrl} faviconUrl={saved.faviconUrl} />
      </aside>
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
  contrast,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  contrast?: boolean;
}) {
  const valid = isHexColor(value);
  const ratio = valid && contrast ? contrastRatio(value, readableOn(value)) : null;
  return (
    <div className="field">
      <span>{label}</span>
      <div className="color-input">
        <input
          type="color"
          value={valid ? value.toLowerCase() : '#000000'}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          aria-label={`${label}: палитра`}
        />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
          maxLength={7}
          pattern="#[0-9A-Fa-f]{6}"
          aria-label={`${label}: HEX`}
          className="mono"
        />
      </div>
      {!valid && <span className="form-error small">Формат #RRGGBB</span>}
      {ratio !== null && ratio < 4.5 && (
        <span className="field-hint" style={{ color: 'var(--warn)', display: 'flex', gap: 6, alignItems: 'center' }}>
          <AlertTriangle size={13} />
          Контраст текста на кнопке {ratio.toFixed(1)}:1 — меньше рекомендуемых 4.5:1
        </span>
      )}
    </div>
  );
}

function AssetField({
  asset,
  title,
  hint,
  url,
  onChange,
  wide,
}: {
  asset: BrandingAsset;
  title: string;
  hint: string;
  url: string;
  onChange: (b: Branding) => void;
  wide?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: (file: File) => api.admin.uploadBrandingAsset(asset, file),
    onSuccess: onChange,
  });
  const remove = useMutation({
    mutationFn: () => api.admin.deleteBrandingAsset(asset),
    onSuccess: onChange,
  });
  const error = upload.error ?? remove.error;

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) upload.mutate(file);
  }

  return (
    <div className="asset-row">
      <div className={`asset-preview${wide ? ' wide' : ''}`}>
        {url ? <img src={url} alt="" /> : wide ? <span className="muted small">Нет логотипа</span> : <BrandMark size={22} />}
      </div>
      <div className="asset-text">
        <strong>{title}</strong>
        <span className="field-hint">{hint}</span>
        {error && <span className="form-error small">{errorMessage(error)}</span>}
      </div>
      <div className="asset-actions">
        <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onFile} />
        <button type="button" className="btn btn-sm" onClick={() => inputRef.current?.click()} disabled={upload.isPending}>
          <ImageUp size={14} />
          {upload.isPending ? 'Загрузка…' : url ? 'Заменить' : 'Загрузить'}
        </button>
        {url && (
          <button
            type="button"
            className="icon-btn danger"
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
            aria-label={`Удалить: ${title}`}
            title="Удалить"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

// Preview renders a miniature of the portal with the unsaved colors. It uses
// the brand variables directly because derived theme variables are resolved
// at :root and would not pick up a scoped override.
function Preview({ input, logoUrl, faviconUrl }: { input: BrandingInput; logoUrl: string; faviconUrl: string }) {
  const primary = isHexColor(input.primaryColor) ? input.primaryColor : defaultBranding.primaryColor;
  const accent = isHexColor(input.accentColor) ? input.accentColor : defaultBranding.accentColor;
  const style = {
    '--p': primary,
    '--a': accent,
    '--on-a': readableOn(accent),
  } as CSSProperties;

  return (
    <div className="preview" style={style}>
      <div className="preview-tab">
        {faviconUrl ? <img src={faviconUrl} alt="" width={14} height={14} /> : <img src="/favicon.svg" alt="" width={14} height={14} />}
        <span>{input.appName || 'Orbit'}</span>
      </div>
      <div className="preview-app">
        <div className="preview-side">
          <div className="preview-brand">
            {logoUrl ? (
              <img src={logoUrl} alt="" />
            ) : (
              <>
                <span className="preview-mark" />
                {input.appName || 'Orbit'}
              </>
            )}
          </div>
          <div className="preview-nav active">
            <LayoutDashboard size={12} />
            Главная
          </div>
          <div className="preview-nav">
            <LayoutGrid size={12} />
            Сервисы
          </div>
        </div>
        <div className="preview-main">
          <div className="preview-cover" />
          <div className="preview-title">Добрый день, Алиса</div>
          <div className="preview-badges">
            <span className="preview-badge">orbit-admin</span>
            <a className="preview-link">Каталог →</a>
          </div>
          <span className="preview-btn">Все сервисы</span>
        </div>
      </div>
      <div className="preview-landing">
        <div className="preview-landing-title">
          {input.landingTitle || (
            <>
              Корпоративный аккаунт. <em>Всё в одном месте.</em>
            </>
          )}
        </div>
        <span className="preview-btn">Войти</span>
      </div>
    </div>
  );
}
