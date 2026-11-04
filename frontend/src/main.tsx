import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider, VelessoftProvider } from '@villetacore/velessoft-ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { ApiError } from './api';
import { App } from './App';
import { meQueryKey } from './auth';
import { BrandingProvider } from './branding';
import { applyTheme, getTheme } from './lib/theme';
import '@fontsource-variable/manrope';
import '@fontsource-variable/jetbrains-mono';
import '@villetacore/velessoft-tokens/tokens.css';
import '@villetacore/velessoft-ui/styles.css';
import './styles.css';

// An expired session on any other request sends the user back through
// AuthGate. The "me" query itself is excluded: re-fetching it on its own 401
// would loop forever. Only this error code means that: a rejected password is a
// 401 too, and re-fetching then would reset the sign-in form.
function onError(err: unknown) {
  if (err instanceof ApiError && err.code === 'unauthorized') {
    void queryClient.invalidateQueries({ queryKey: meQueryKey });
  }
}

// Apply the saved theme before the first render to avoid a flash.
applyTheme(getTheme());

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
        <VelessoftProvider>
          <ToastProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </ToastProvider>
        </VelessoftProvider>
      </BrandingProvider>
    </QueryClientProvider>
  </StrictMode>,
);
