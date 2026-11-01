import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { api, errorMessage } from '../api';
import { meQueryKey } from '../auth';
import { cropImage } from '../lib/cropImage';
import { Avatar } from './Avatar';

const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_SOURCE_BYTES = 15 * 1024 * 1024;

interface Props {
  url: string;
  name: string;
}

export function AvatarEditor({ url, name }: Props) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [error, setError] = useState('');

  useEffect(() => () => {
    if (source) URL.revokeObjectURL(source);
  }, [source]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: meQueryKey });
    void queryClient.invalidateQueries({ queryKey: ['profile'] });
  };

  const upload = useMutation({
    mutationFn: async () => {
      if (!source || !area) throw new Error('Выберите область');
      return api.uploadAvatar(await cropImage(source, area));
    },
    onSuccess: () => {
      setSource(null);
      refresh();
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: api.deleteAvatar,
    onSuccess: refresh,
    onError: (err) => setError(errorMessage(err)),
  });

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    setError('');
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) {
      setError('Поддерживаются PNG, JPEG и WebP');
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      setError('Файл больше 15 МБ');
      return;
    }
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setSource(URL.createObjectURL(file));
  }

  return (
    <div className="avatar-editor">
      <Avatar url={url} name={name} size={112} />
      <div className="avatar-actions">
        <input ref={inputRef} type="file" accept={ACCEPTED.join(',')} hidden onChange={onFile} />
        <button className="btn" onClick={() => inputRef.current?.click()}>
          {url ? 'Заменить фото' : 'Загрузить фото'}
        </button>
        {url && (
          <button className="btn btn-ghost" onClick={() => remove.mutate()} disabled={remove.isPending}>
            Удалить
          </button>
        )}
        <p className="hint">PNG, JPEG или WebP, от 64×64 px. Фото увидят другие корпоративные сервисы.</p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>

      {source && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Кадрирование фото">
          <div className="modal">
            <h2>Кадрирование</h2>
            <div className="cropper">
              <Cropper
                image={source}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_, pixels) => setArea(pixels)}
              />
            </div>
            <label className="zoom">
              Масштаб
              <input
                type="range"
                min={1}
                max={3}
                step={0.01}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
              />
            </label>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setSource(null)} disabled={upload.isPending}>
                Отмена
              </button>
              <button className="btn btn-primary" onClick={() => upload.mutate()} disabled={upload.isPending || !area}>
                {upload.isPending ? 'Сохранение…' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
