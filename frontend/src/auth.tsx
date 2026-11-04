import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Spinner } from '@villetacore/velessoft-ui';
import { createContext, useContext, type ReactNode } from 'react';
import { ApiError, api, errorMessage, setCsrfToken, type Me } from './api';
import { BrandMark } from '@/components/ui';
import { Landing } from '@/components/landing/Landing';

const MeContext = createContext<Me | null>(null);

export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe must be used inside <AuthGate>');
  return me;
}

export const meQueryKey = ['me'] as const;

async function fetchMe(): Promise<Me> {
  const me = await api.me();
  setCsrfToken(me.csrfToken);
  return me;
}

// AuthGate renders the app for signed-in users and the landing page otherwise.
export function AuthGate({ children }: { children: ReactNode }) {
  const me = useQuery({
    queryKey: meQueryKey,
    queryFn: fetchMe,
    retry: (count, err) => !(err instanceof ApiError && err.status === 401) && count < 2,
    staleTime: 60_000,
  });

  if (me.isPending) {
    return (
      <div className="splash">
        <BrandMark size={24} />
        <Spinner label="Загрузка" />
      </div>
    );
  }
  if (me.isError) {
    if (me.error instanceof ApiError && me.error.status === 401) {
      return <Landing />;
    }
    return (
      <div className="splash">
        <BrandMark size={24} />
        <Alert tone="error" title="Не удалось загрузить данные аккаунта">
          {errorMessage(me.error)}
        </Alert>
        <Button onClick={() => me.refetch()}>Повторить</Button>
      </div>
    );
  }
  return <MeContext.Provider value={me.data}>{children}</MeContext.Provider>;
}
