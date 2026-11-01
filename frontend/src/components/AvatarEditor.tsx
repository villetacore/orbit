import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera, Trash2, ZoomIn } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { api, errorMessage } from '../api';
import { meQueryKey } from '../auth';
import { cropImage } from '../lib/cropImage';
import { Avatar } from './Avatar';
import { Modal } from './ui';

const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_SOURCE_BYTES = 15 * 1024 * 1024;

interface Props {
  url: string;
  name: string;
}

// AvatarEditor shows the avatar with a camera button; picking a file opens a
// crop dialog, and the cropped square is uploaded.
export function AvatarEditor({ url, name }: Props) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [error, setError] = useState('');

  useEffect(
    () => () => {
      if (source) URL.revokeObjectURL(source);
    },
    [source],
  );

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

  const close = useCallback(() => setSource(null), []);

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

  const pick = () => inputRef.current?.click();

  return (
    <>
      <div className="avatar-edit">
        <Avatar url={url} name={name} size={112} />
        <button className="camera" onClick={pick} aria-label={url ? 'Заменить фото' : 'Загрузить фото'} title="Изменить фото">
          <Camera size={16} />
        </button>
      </div>
      <input ref={inputRef} type="file" accept={ACCEPTED.join(',')} hidden onChange={onFile} />

      {url && (
        <div className="identity-actions">
          <button className="btn btn-sm" onClick={pick}>
            Заменить
          </button>
          <button className="btn btn-sm btn-ghost btn-danger" onClick={() => remove.mutate()} disabled={remove.isPending}>
            <Trash2 size={14} />
            Удалить
          </button>
        </div>
      )}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : (
        !url && <p className="field-hint">PNG, JPEG или WebP от 64×64 px</p>
      )}

      {source && (
        <Modal
          title="Кадрирование фото"
          onClose={close}
          footer={
            <>
              <button className="btn btn-ghost" onClick={close} disabled={upload.isPending}>
                Отмена
              </button>
              <button className="btn btn-primary" onClick={() => upload.mutate()} disabled={upload.isPending || !area}>
                {upload.isPending ? 'Сохранение…' : 'Сохранить фото'}
              </button>
            </>
          }
        >
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
            <ZoomIn size={16} />
            <span className="sr-only">Масштаб</span>
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
          </label>
          <p className="field-hint" style={{ padding: '4px 24px 16px' }}>
            Фото увидят коллеги и другие корпоративные сервисы.
          </p>
        </Modal>
      )}
    </>
  );
}
