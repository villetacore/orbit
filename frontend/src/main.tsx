import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { ApiError } from './api';
import { App } from './App';
import { meQueryKey } from './auth';
import { BrandingProvider } from './branding';
import '@fontsource-variable/manrope';
import '@fontsource-variable/onest';
import './styles.css';

// An expired session on any other request sends the user back through
// AuthGate. The "me" query itself is excluded: re-fetching it on its own 401
// would loop forever.
function onError(err: unknown) {
  if (err instanceof ApiError && err.status === 401) {
    void queryClient.invalidateQueries({ queryKey: meQueryKey });
  }
}

const queryClient = new QueryClient({
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrandingProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </BrandingProvider>
    </QueryClientProvider>
  </StrictMode>,
);
