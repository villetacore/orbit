import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';

// In development the Go API runs on :8080; Next proxies the BFF routes so the
// browser sees a single origin and session cookies stay first-party.
const api = process.env.ORBIT_API_URL ?? 'http://localhost:8080';

/** @returns {import('next').NextConfig} */
export default function config(phase) {
  const base = {
    reactStrictMode: true,
    // `npm run build` has already run tsc.
    typescript: { ignoreBuildErrors: true },
  };

  if (phase === PHASE_DEVELOPMENT_SERVER) {
    return {
      ...base,
      rewrites: async () => ['/api', '/auth', '/go'].map((path) => ({ source: `${path}/:path*`, destination: `${api}${path}/:path*` })),
    };
  }

  // In production the Go API serves the exported files from ORBIT_STATIC_DIR.
  return { ...base, output: 'export' };
}
