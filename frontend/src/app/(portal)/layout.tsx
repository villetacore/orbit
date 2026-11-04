'use client';

import type { ReactNode } from 'react';
import { AuthGate } from '@/auth';
import { Layout } from '@/components/Layout';

// Every page is prerendered as the AuthGate splash: account data is only ever
// loaded in the browser, through the Go backend.
export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      <Layout>{children}</Layout>
    </AuthGate>
  );
}
