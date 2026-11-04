'use client';

import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { useMe } from '@/auth';

export function RequireAdmin({ children }: { children: ReactNode }) {
  const me = useMe();
  if (!me.isAdmin) redirect('/');
  return children;
}
