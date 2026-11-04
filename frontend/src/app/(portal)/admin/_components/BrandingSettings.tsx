import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, IconButton, Input, Textarea, useToast } from '@villetacore/velessoft-ui';
import { ImageUp, RotateCcw, Trash2 } from 'lucide-react';
import { useRef, useState, type ChangeEvent, type CSSProperties, type FormEvent } from 'react';
import { api, type Branding, type BrandingAsset, type BrandingInput } from '@/api';
import { brandingQueryKey, defaultBranding } from '@/branding';
import { BrandMark, ErrorAlert, Loading } from '@/components/ui';
import { contrastRatio, isHexColor, readableOn } from '@/lib/color';

const adminBrandingKey = ['admin', 'branding'] as const;

function toInput(b: Branding): BrandingInput {
  const { appName, landingTitle, landingSubtitle, primaryColor, accentColor, supportEmail, supportUrl } = b;
  return { appName, landingTitle, landingSubtitle, primaryColor, accentColor, supportEmail, supportUrl };
}

export function BrandingSettings() {
  const branding = useQuery({ queryKey: adminBrandingKey, queryFn: api.admin.branding });
  if (branding.isPending) return <Loading height={520} />;
  if (branding.isError) return <ErrorAlert error={branding.error} />;
  // Remount when the saved version changes so the form starts from it.
  return <BrandingForm key={JSON.stringify(toInput(branding.data))} saved={branding.data} />;
}

function BrandingForm({ saved }: { saved: Branding }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [input, setInput] = useState<BrandingInput>(() => toInput(saved));

  const onSaved = (b: Branding) => {
    queryClient.setQueryData(adminBrandingKey, b);
    queryClient.setQueryData(brandingQueryKey, b);
  };

  const save = useMutation({
    mutationFn: api.admin.updateBranding,
    onSuccess: (b) => {
      onSaved(b);
      toast({ tone: 'success', title: 'Применено для всех пользователей' });
    },
  });

  const dirty = JSON.stringify(input) !== JSON.stringify(toInput(saved));

  function set<K extends keyof BrandingInput>(key: K, value: BrandingInput[K]) {
    setInput((prev) => ({ ...prev, [key]: value }));
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate(input);
  }

  const colorsValid = isHexColor(input.primaryColor) && isHexColor(input.accentColor);

  return (
    <div className="settings-grid">
      <form className="stack" onSubmit={onSubmit}>
        <Card flat title="Название и тексты" description="Показываются в меню, заголовке вкладки и на странице входа.">
          <div className="stack">
            <Input label="Название портала" value={input.appName} onChange={(e) => set('appName', e.target.value)} required maxLength={40} />
            <Input
              label="Заголовок страницы входа"
              value={input.landingTitle}
              onChange={(e) => set('landingTitle', e.target.value)}
              maxLength={120}
              placeholder="Корпоративный аккаунт. Всё в одном месте."
            />
            <Textarea
              label="Подзаголовок"
              hint="Пустые поля — текст по умолчанию."
              value={input.landingSubtitle}
              onChange={(e) => set('landingSubtitle', e.target.value)}
              maxLength={300}
              rows={2}
            />
          </div>
        </Card>

        <Card
          flat
          title="Цвета"
          description="Основной — ссылки, выделение и фокус. Акцент — главные кнопки."
          actions={
            <Button
              size="sm"
              variant="ghost"
              className="with-icon"
              onClick={() => {
                set('primaryColor', defaultBranding.primaryColor);
                set('accentColor', defaultBranding.accentColor);
              }}
            >
              <RotateCcw size={14} />
              Палитра velessoft
            </Button>
          }
        >
          <div className="form-grid">
            <ColorField label="Основной цвет" value={input.primaryColor} onChange={(v) => set('primaryColor', v)} />
            <ColorField label="Акцентный цвет" value={input.accentColor} onChange={(v) => set('accentColor', v)} contrast />
          </div>
        </Card>

        <Card flat title="Поддержка" description="Ссылка «Поддержка» в меню и «Помощь со входом» на странице входа.">
          <div className="form-grid">
            <Input label="Email" type="email" value={input.supportEmail} onChange={(e) => set('supportEmail', e.target.value)} placeholder="help@company.ru" />
            <Input label="Ссылка (приоритетнее email)" type="url" value={input.supportUrl} onChange={(e) => set('supportUrl', e.target.value)} placeholder="https://" />
          </div>
        </Card>

        <Card flat title="Файлы" description="PNG, JPEG или WebP. Изображения пересохраняются в PNG; SVG не принимается.">
          <ul className="rows">
            <AssetField asset="favicon" title="Фавикон" hint="Квадрат, от 16×16 px. Будет приведён к 256×256." url={saved.faviconUrl} onChange={onSaved} />
            <AssetField asset="logo" title="Логотип" hint="Горизонтальный, до 480×160 px." url={saved.logoUrl} onChange={onSaved} wide />
          </ul>
        </Card>

        <ErrorAlert error={save.error} />
        <div className="row">
          <Button type="submit" variant="primary" disabled={!dirty || !colorsValid} loading={save.isPending}>
            Сохранить оформление
          </Button>
          {dirty && (
            <Button variant="ghost" onClick={() => setInput(toInput(saved))}>
              Отменить
            </Button>
          )}
        </div>
      </form>

      <aside className="settings-preview">
        <Preview input={input} logoUrl={saved.logoUrl} />
      </aside>
    </div>
  );
}

function ColorField({ label, value, onChange, contrast }: { label: string; value: string; onChange: (v: string) => void; contrast?: boolean }) {
  const valid = isHexColor(value);
  const ratio = valid && contrast ? contrastRatio(value, readableOn(value)) : null;
  return (
    <div className="stack">
      <Input
        label={label}
        value={value}
        onChange={(e) => onChange(e.target.value.trim())}
        maxLength={7}
        error={valid ? undefined : 'Формат #RRGGBB'}
        startAddon={
          <input
            type="color"
            className="color-swatch"
            value={valid ? value.toLowerCase() : '#000000'}
            onChange={(e) => onChange(e.target.value.toUpperCase())}
            aria-label={`${label}: палитра`}
          />
        }
      />
      {ratio !== null && ratio < 4.5 && (
        <Alert tone="warning">Контраст текста на кнопке {ratio.toFixed(1)}:1 — меньше рекомендуемых 4.5:1</Alert>
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
  const upload = useMutation({ mutationFn: (file: File) => api.admin.uploadBrandingAsset(asset, file), onSuccess: onChange });
  const remove = useMutation({ mutationFn: () => api.admin.deleteBrandingAsset(asset), onSuccess: onChange });

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) upload.mutate(file);
  }

  return (
    <li>
      <span className={`asset-preview${wide ? ' wide' : ''}`}>
        {url ? <img src={url} alt="" /> : wide ? <small>Нет логотипа</small> : <BrandMark size={20} />}
      </span>
      <span className="row-text">
        <strong>{title}</strong>
        <small>{hint}</small>
        <ErrorAlert error={upload.error ?? remove.error} />
      </span>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onFile} />
      <Button size="sm" className="with-icon" onClick={() => inputRef.current?.click()} loading={upload.isPending}>
        <ImageUp size={14} />
        {url ? 'Заменить' : 'Загрузить'}
      </Button>
      {url && (
        <IconButton size="sm" variant="ghost" label={`Удалить: ${title}`} onClick={() => remove.mutate()} disabled={remove.isPending}>
          <Trash2 size={14} />
        </IconButton>
      )}
    </li>
  );
}

// Preview shows the unsaved colors on real components by overriding the design
// tokens for this subtree only.
function Preview({ input, logoUrl }: { input: BrandingInput; logoUrl: string }) {
  const primary = isHexColor(input.primaryColor) ? input.primaryColor : defaultBranding.primaryColor;
  const accent = isHexColor(input.accentColor) ? input.accentColor : defaultBranding.accentColor;
  const style = {
    '--vs-accent': primary,
    '--vs-link': primary,
    '--vs-primary': accent,
    '--vs-on-primary': readableOn(accent),
  } as CSSProperties;

  return (
    <Card flat title="Предпросмотр" style={style}>
      <div className="stack">
        <div className="brand">{logoUrl ? <img className="brand-logo" src={logoUrl} alt="" /> : <><BrandMark />{input.appName || 'Orbit'}</>}</div>
        <strong>{input.landingTitle || 'Один вход. Все сервисы /_'}</strong>
        <a className="vs-link" href="#preview" onClick={(e) => e.preventDefault()}>
          Ссылка в тексте
        </a>
        <ul className="vs-nav-list">
          <li>
            <a href="#preview" aria-current="page" onClick={(e) => e.preventDefault()}>
              Активный пункт
            </a>
          </li>
        </ul>
        <Button variant="primary">Главная кнопка</Button>
      </div>
    </Card>
  );
}
