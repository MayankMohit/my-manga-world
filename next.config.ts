import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// R2 objects are served from presigned URLs on this host.
const R2_HOST = "https://*.r2.cloudflarestorage.com";

/**
 * Content Security Policy. Kept pragmatic for now so dev tooling (HMR, React
 * refresh) works; Phase 8 tightens script-src to nonce-based. `img-src` and
 * `connect-src` allow the private R2 host for presigned reads/writes.
 */
const csp = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: blob: ${R2_HOST}`,
  `font-src 'self' data:`,
  `connect-src 'self' ${R2_HOST}${isDev ? " ws: wss:" : ""}`,
  `worker-src 'self' blob:`,
  `manifest-src 'self'`,
  `media-src 'self' blob:`,
  `frame-ancestors 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
  `object-src 'none'`,
  ...(isDev ? [] : [`upgrade-insecure-requests`]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  ...(isDev
    ? []
    : [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]),
];

const nextConfig: NextConfig = {
  reactCompiler: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
