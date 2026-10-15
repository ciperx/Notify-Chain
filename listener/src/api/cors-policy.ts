/**
 * Environment-Specific CORS Policy (Issue #998)
 *
 * Resolves the allowed CORS origins for a given environment and decides, per
 * request, whether an incoming Origin should receive CORS headers.
 *
 * Policy:
 * - local / development / test: defaults to the local dashboard ports.
 * - staging / production: no default origins at all — an explicit allowlist
 *   MUST be configured (CORS_ALLOWED_ORIGINS / EVENTS_API_CORS_ORIGIN) and a
 *   wildcard "*" is always rejected. If no allowlist is configured, every
 *   cross-origin request is rejected (fail closed).
 */

export type CorsEnvironment = 'local' | 'staging' | 'production' | 'development' | 'test';

const LOCAL_DEFAULT_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
];

export class CorsPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CorsPolicyError';
  }
}

export interface CorsPolicy {
  /** Resolved allowlist. Empty for production/staging when unconfigured (fail closed). */
  allowedOrigins: string[];
  /** Environment the policy was resolved for. */
  environment: CorsEnvironment;
  /** True when the restrictive (production/staging) rules apply. */
  restrictive: boolean;
}

function normalizeEnvironment(nodeEnv: string | undefined): CorsEnvironment {
  const env = (nodeEnv ?? 'development').trim().toLowerCase();
  if (['production', 'prod'].includes(env)) return 'production';
  if (['staging', 'stage'].includes(env)) return 'staging';
  if (['local', 'localhost'].includes(env)) return 'local';
  if (['test', 'development', 'dev'].includes(env)) return 'development';
  return 'development';
}

function parseOrigins(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed === '*') return ['*'];

  let list: string[];
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) {
        throw new Error('not an array');
      }
      list = parsed.map((o) => String(o).trim());
    } catch {
      throw new CorsPolicyError(`Invalid JSON array in CORS origin configuration: ${trimmed}`);
    }
  } else {
    list = trimmed.split(',').map((o) => o.trim()).filter(Boolean);
  }

  if (list.length === 0) {
    throw new CorsPolicyError('No valid origins specified in CORS origin configuration.');
  }

  for (const origin of list) {
    if (origin === '*') continue;
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new CorsPolicyError(`Invalid origin URL "${origin}". Must be an absolute http(s) origin.`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new CorsPolicyError(
        `Invalid origin protocol "${url.protocol}" in "${origin}". Only http: and https: are allowed.`
      );
    }
    if (url.pathname !== '' && url.pathname !== '/') {
      throw new CorsPolicyError(
        `Origin "${origin}" must not include path segments. Specify scheme, host and optional port only.`
      );
    }
  }

  return list;
}

/**
 * Resolves the environment-specific CORS policy.
 *
 * @param nodeEnv runtime environment (e.g. process.env.NODE_ENV)
 * @param rawOrigins explicitly configured origins (comma-separated, JSON array, or "*")
 */
export function resolveCorsPolicy(
  nodeEnv: string | undefined,
  rawOrigins?: string
): CorsPolicy {
  const environment = normalizeEnvironment(nodeEnv);
  const restrictive = environment === 'production' || environment === 'staging';

  if (rawOrigins !== undefined && rawOrigins.trim() !== '') {
    const origins = parseOrigins(rawOrigins);
    if (origins.includes('*')) {
      if (restrictive) {
        throw new CorsPolicyError(
          `Wildcard CORS origin "*" is not permitted in ${environment} environments. ` +
            'Configure an explicit origin allowlist instead.'
        );
      }
      // Wildcard in non-restrictive environments: allow everything.
      return { allowedOrigins: ['*'], environment, restrictive };
    }
    return { allowedOrigins: origins, environment, restrictive };
  }

  // No explicit configuration.
  if (restrictive) {
    // Fail closed: no implicit origins; every cross-origin request is rejected
    // until an explicit allowlist is configured.
    return { allowedOrigins: [], environment, restrictive };
  }

  return { allowedOrigins: [...LOCAL_DEFAULT_ORIGINS], environment, restrictive };
}

/**
 * Decides whether a request's Origin should receive CORS headers, and which
 * value the Access-Control-Allow-Origin header should carry.
 *
 * Returns null when the origin must be rejected (no CORS headers emitted).
 */
export function resolveAllowedOrigin(
  policy: CorsPolicy,
  requestOrigin: string | undefined
): string | null {
  // Non-CORS requests (same-origin tools, curl) pass through untouched.
  if (!requestOrigin) return null;

  if (policy.allowedOrigins.includes('*')) return '*';

  const normalized = requestOrigin.trim().replace(/\/$/, '');
  if (policy.allowedOrigins.includes(normalized)) {
    return normalized;
  }
  return null;
}
