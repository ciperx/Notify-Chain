import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import http from 'http';
import { createEventsServer } from './events-server';
import { resolveCorsPolicy, resolveAllowedOrigin, CorsPolicyError } from './cors-policy';

jest.mock('../store/event-registry', () => ({
  eventRegistry: { getEvents: jest.fn(() => []), count: jest.fn(() => 0) },
}));

jest.mock('../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

const BASE_OPTIONS = {
  port: 0,
  stellarRpcUrl: 'https://soroban-testnet.stellar.org:443',
  stellarNetworkPassphrase: 'Test SDF Network ; September 2015',
  contractAddresses: [] as [],
};

function makeRequest(
  server: http.Server,
  options: { method: string; path: string; origin?: string; headers?: Record<string, string> }
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const req = http.request(
      {
        host: '127.0.0.1',
        port: addr.port,
        path: options.path,
        method: options.method,
        headers: {
          ...(options.origin ? { Origin: options.origin } : {}),
          ...(options.headers ?? {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: data }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

describe('Environment-Specific CORS Policies (Issue #998)', () => {
  describe('resolveCorsPolicy per environment', () => {
    it('local environment defaults to local dashboard origins', () => {
      const policy = resolveCorsPolicy('local');
      expect(policy.restrictive).toBe(false);
      expect(policy.allowedOrigins).toContain('http://localhost:5173');
      expect(policy.allowedOrigins).not.toContain('*');
    });

    it('development environment defaults to local dashboard origins', () => {
      const policy = resolveCorsPolicy('development');
      expect(policy.restrictive).toBe(false);
      expect(policy.allowedOrigins).toContain('http://localhost:3000');
    });

    it('staging environment fails closed when unconfigured', () => {
      const policy = resolveCorsPolicy('staging');
      expect(policy.restrictive).toBe(true);
      expect(policy.allowedOrigins).toEqual([]);
    });

    it('production environment fails closed when unconfigured', () => {
      const policy = resolveCorsPolicy('production');
      expect(policy.restrictive).toBe(true);
      expect(policy.allowedOrigins).toEqual([]);
    });

    it('production uses an explicit allowlist when configured', () => {
      const policy = resolveCorsPolicy(
        'production',
        'https://app.notifychain.io, https://admin.notifychain.io'
      );
      expect(policy.restrictive).toBe(true);
      expect(policy.allowedOrigins).toEqual([
        'https://app.notifychain.io',
        'https://admin.notifychain.io',
      ]);
    });

    it('rejects wildcard in staging and production', () => {
      expect(() => resolveCorsPolicy('production', '*')).toThrow(CorsPolicyError);
      expect(() => resolveCorsPolicy('staging', '*')).toThrow(CorsPolicyError);
    });

    it('allows wildcard only in non-restrictive environments', () => {
      const policy = resolveCorsPolicy('local', '*');
      expect(policy.allowedOrigins).toEqual(['*']);
    });

    it('validates configured origins', () => {
      expect(() => resolveCorsPolicy('production', 'ftp://bad.example')).toThrow(CorsPolicyError);
      expect(() => resolveCorsPolicy('production', 'https://bad.example/path')).toThrow(
        CorsPolicyError
      );
    });
  });

  describe('resolveAllowedOrigin', () => {
    const policy = resolveCorsPolicy('production', 'https://app.notifychain.io');

    it('echoes an allowed origin', () => {
      expect(resolveAllowedOrigin(policy, 'https://app.notifychain.io')).toBe(
        'https://app.notifychain.io'
      );
    });

    it('rejects a disallowed origin', () => {
      expect(resolveAllowedOrigin(policy, 'https://evil.example')).toBeNull();
    });

    it('treats a missing Origin header as a non-CORS request', () => {
      expect(resolveAllowedOrigin(policy, undefined)).toBeNull();
    });

    it('wildcard policy returns *', () => {
      const wildcard = resolveCorsPolicy('development', '*');
      expect(resolveAllowedOrigin(wildcard, 'https://anything.example')).toBe('*');
    });
  });

  describe('server preflight behavior', () => {
    let server: http.Server;

    afterEach(() => {
      if (server) server.close();
    });

    it('returns 204 with CORS headers for an allowed origin preflight', async () => {
      server = createEventsServer({
        ...BASE_OPTIONS,
        nodeEnv: 'production',
        corsOrigin: 'https://app.notifychain.io',
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

      const res = await makeRequest(server, {
        method: 'OPTIONS',
        path: '/api/events',
        origin: 'https://app.notifychain.io',
        headers: { 'Access-Control-Request-Method': 'GET' },
      });

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('https://app.notifychain.io');
      expect(res.headers['access-control-allow-methods']).toContain('GET');
      expect(res.headers['vary']).toContain('Origin');
    });

    it('rejects a preflight from a disallowed origin with 403 and no CORS headers', async () => {
      server = createEventsServer({
        ...BASE_OPTIONS,
        nodeEnv: 'production',
        corsOrigin: 'https://app.notifychain.io',
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

      const res = await makeRequest(server, {
        method: 'OPTIONS',
        path: '/api/events',
        origin: 'https://evil.example',
        headers: { 'Access-Control-Request-Method': 'GET' },
      });

      expect(res.status).toBe(403);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('fails closed in production with no configured allowlist', async () => {
      const previous = process.env.CORS_ALLOWED_ORIGINS;
      delete process.env.CORS_ALLOWED_ORIGINS;
      try {
        server = createEventsServer({ ...BASE_OPTIONS, nodeEnv: 'production' });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

        const res = await makeRequest(server, {
          method: 'OPTIONS',
          path: '/api/events',
          origin: 'https://app.notifychain.io',
          headers: { 'Access-Control-Request-Method': 'GET' },
        });

        expect(res.status).toBe(403);
        expect(res.headers['access-control-allow-origin']).toBeUndefined();
      } finally {
        if (previous !== undefined) process.env.CORS_ALLOWED_ORIGINS = previous;
      }
    });

    it('preflight without an Origin header still succeeds in development', async () => {
      server = createEventsServer({ ...BASE_OPTIONS, nodeEnv: 'development' });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

      const res = await makeRequest(server, { method: 'OPTIONS', path: '/api/events' });
      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('disallowed origin on a normal request receives no CORS headers', async () => {
      server = createEventsServer({
        ...BASE_OPTIONS,
        nodeEnv: 'production',
        corsOrigin: 'https://app.notifychain.io',
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

      const res = await makeRequest(server, {
        method: 'GET',
        path: '/health',
        origin: 'https://evil.example',
      });

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });
});
