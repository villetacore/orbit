import type { ReactNode } from 'react';
import { JetBrains_Mono, Manrope } from 'next/font/google';
import { Providers } from './providers';
import '@villetacore/velessoft-tokens/tokens.css';
import '@villetacore/velessoft-ui/styles.css';
import '../styles.css';

// Downloaded at build time and served by Orbit itself; styles.css maps them onto
// the design tokens.
const sans = Manrope({ subsets: ['latin', 'cyrillic'], variable: '--font-sans' });
const mono = JetBrains_Mono({ subsets: ['latin', 'cyrillic'], variable: '--font-mono' });

// Applies the saved theme before the first paint to avoid a flash. Must match
// getTheme and applyTheme in lib/theme.ts.
const themeScript = `try{var t=localStorage.getItem('orbit-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

// The title and favicon are plain tags, not Next metadata: applyBranding changes
// them at runtime, and Next would put its own values back on every navigation.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" data-theme="auto" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <title>Orbit</title>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="vs-root">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
