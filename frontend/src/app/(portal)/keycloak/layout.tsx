'use client';

import { PageHeader } from '@villetacore/velessoft-ui';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { keycloakSections } from '@/components/keycloak/sections';
import { NavLink } from '@/components/NavLink';
import { RequireAdmin } from '@/components/RequireAdmin';

// The Keycloak section replaces the admin console for this realm. Everything
// goes through Orbit's backend, which holds the service account credentials.
export default function KeycloakLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const current = keycloakSections.find((s) => pathname === `/keycloak/${s.id}`);

  return (
    <RequireAdmin>
      <div className="page">
        <PageHeader eyebrow="Keycloak" title={current?.label ?? 'Keycloak'} description="Изменения сразу применяются в Keycloak и записываются в журнал аудита Orbit." />
        <div className="kc-layout">
          <nav aria-label="Разделы Keycloak" className="kc-nav">
            <ul className="vs-nav-list">
              {keycloakSections.map((s) => (
                <li key={s.id}>
                  <NavLink href={`/keycloak/${s.id}`}>{s.label}</NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <div className="kc-content">{children}</div>
        </div>
      </div>
    </RequireAdmin>
  );
}
