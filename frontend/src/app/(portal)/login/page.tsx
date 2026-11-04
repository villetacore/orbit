'use client';

import { redirect } from 'next/navigation';

// AuthGate shows the landing page to signed-out users on any route, including
// this one, which the backend links to. Signed-in users have nothing to do here.
export default function Page() {
  redirect('/');
}
