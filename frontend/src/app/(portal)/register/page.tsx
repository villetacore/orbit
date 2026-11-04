'use client';

import { redirect } from 'next/navigation';

// AuthGate shows signed-out users the landing page, which opens the sign-up form
// on this path. Signed-in users have nothing to do here.
export default function Page() {
  redirect('/');
}
