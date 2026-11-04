'use client';

import { redirect } from 'next/navigation';

// A client component, so that this runs after AuthGate and not at build time.
export default function Page() {
  redirect('/keycloak/realm');
}
