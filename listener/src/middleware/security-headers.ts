/**
 * Security headers middleware — adds intentional security-related headers
 * to every HTTP response from the events API server.
 *
 * Headers are environment-aware: production-enforcing headers are only
 * applied when the service is not in a local development context.
 * Headers that could break local development, CORS, or SSE connections
 * are deliberately omitted or conditioned.
 *
 * See: https://owasp.org/www-project-secure-headers/
 */

import type { ServerResponse } from 'http';

export function addSecurityHeaders(
  res: ServerResponse,
  options: { isProduction?: boolean } = {},
): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // ✅ X-Frame-Options: prevent clickjacking.
  // SAMEORIGIN allows embedding within same-origin iframes (dashboard use).
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');

  // ✅ X-XSS-Protection: legacy IE protection (defense-in-depth).
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // ✅ Referrer-Policy: control referrer information sent with requests.
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // ✅ Cache-Control: prevent sensitive data caching.
  // Only set Cache-Control if not already set by a more specific handler.
  if (!res.getHeader('Cache-Control')) {
    res.setHeader('Cache-Control', 'no-store');
  }

  // ⚠️ Strict-Transport-Security: only in production to avoid breaking
  // HTTP local testing.
  if (options.isProduction) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  }
}
