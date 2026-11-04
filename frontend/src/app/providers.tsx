'use client';

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider, VelessoftProvider } from '@villetacore/velessoft-ui';
import { useState, type ReactNode } from 'react';
import { ApiError } from '@/api';
import { meQueryKey } from '@/auth';
import { BrandingProvider } from '@/branding';

function createQueryClient() {
  // An expired session on any other request sends the user back through
  // AuthGate. The "me" query itself is excluded: re-fetching it on its own 401
  // would loop forever. Only this error code means that: a rejected password is
  // a 401 too, and re-fetching then would reset the sign-in form.
  function onError(err: unknown) {
    if (err instanceof ApiError && err.code === 'unauthorized') {
      void queryClient.invalidateQueries({ queryKey: meQueryKey });
    }
  }

  const queryClient: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (err, query) => {
        if (query.queryKey[0] !== meQueryKey[0]) onError(err);
      },
    }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: { refetchOnWindowFocus: false },
    },
  });
  return queryClient;
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <BrandingProvider>
        <VelessoftProvider>
          <ToastProvider>{children}</ToastProvider>
        </VelessoftProvider>
      </BrandingProvider>
    </QueryClientProvider>
  );
}
