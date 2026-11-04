import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { api, type Branding } from './api';
import { isHexColor, linkColors, readableOn } from './lib/color';

export const brandingQueryKey = ['branding'] as const;

export const defaultBranding: Branding = {
  appName: 'Orbit',
  landingTitle: '',
  landingSubtitle: '',
  primaryColor: '#8B7CF6',
  accentColor: '#B8EF65',
  supportEmail: '',
  supportUrl: '',
  faviconUrl: '',
  logoUrl: '',
};

const BrandingContext = createContext<Branding>(defaultBranding);

export function useBranding(): Branding {
  return useContext(BrandingContext);
}

// applyBranding pushes branding into the document: title, favicon and the
// CSS variables styles.css maps onto the design tokens.
export function applyBranding(b: Branding) {
  const root = document.documentElement.style;
  if (isHexColor(b.primaryColor)) {
    root.setProperty('--brand-primary', b.primaryColor);
    const links = linkColors(b.primaryColor);
    root.setProperty('--link-light', links.light);
    root.setProperty('--link-dark', links.dark);
  }
  if (isHexColor(b.accentColor)) {
    root.setProperty('--brand-accent', b.accentColor);
    root.setProperty('--on-brand-accent', readableOn(b.accentColor));
  }
  document.title = b.appName || defaultBranding.appName;

  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.type = b.faviconUrl ? 'image/png' : 'image/svg+xml';
  link.href = b.faviconUrl || '/favicon.svg';
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const branding = useQuery({
    queryKey: brandingQueryKey,
    queryFn: api.branding,
    staleTime: 5 * 60_000,
  });
  // A failed request keeps the built-in look; branding is cosmetic.
  const value = branding.data ?? defaultBranding;

  useEffect(() => applyBranding(value), [value]);

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}
