// HTTP headers for Cloudflare Pages (_headers) and the local dev/preview
// servers. The CSP enforces the privacy guarantee at the browser level: the
// page cannot connect anywhere except its own origin.
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "media-src 'self' blob: mediastream:",
  "font-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CSP,
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), display-capture=()',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Opener-Policy': 'same-origin',
};
