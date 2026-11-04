import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Dialog, Slider } from '@villetacore/velessoft-ui';
import { Camera, Trash2 } from 'lucide-react';
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

// AvatarEditor shows the avatar with its actions; picking a file opens a crop
// dialog, and the cropped square is uploaded.
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
    <>
      <Avatar url={url} name={name} size={112} />
      <input ref={inputRef} type="file" accept={ACCEPTED.join(',')} hidden onChange={onFile} />
      <div className="row">
        <Button size="sm" className="with-icon" onClick={() => inputRef.current?.click()}>
          <Camera size={14} />
          {url ? 'Заменить' : 'Загрузить фото'}
        </Button>
        {url && (
          <Button size="sm" variant="ghost" className="with-icon" onClick={() => remove.mutate()} loading={remove.isPending}>
            <Trash2 size={14} />
            Удалить
          </Button>
        )}
      </div>
      {error && <Alert tone="error">{error}</Alert>}

      {source && (
        <Dialog
          open
          title="Кадрирование фото"
          onClose={() => setSource(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setSource(null)} disabled={upload.isPending}>
                Отмена
              </Button>
              <Button variant="primary" onClick={() => upload.mutate()} loading={upload.isPending} disabled={!area}>
                Сохранить фото
              </Button>
            </>
          }
        >
          <div className="stack">
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
            <Slider label="Масштаб" min={1} max={3} step={0.01} value={zoom} onChange={setZoom} />
            <p className="hint">Фото увидят коллеги и другие корпоративные сервисы.</p>
          </div>
        </Dialog>
      )}
    </>
  );
}
