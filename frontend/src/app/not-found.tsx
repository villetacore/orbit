'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

// redirect() would run while the page is prerendered, not in the browser, and
// the Go backend has to answer unknown paths with this page's 404 status.
export default function NotFound() {
  const router = useRouter();
  useEffect(() => router.replace('/'), [router]);
  return null;
}
