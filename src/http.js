import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { hostHeaderValidation } from '@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js';
import { mcpAuthMetadataRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { createMcpServer } from './server.js';

const localHosts = ['localhost', '127.0.0.1', '::1'];
export function equalSecret(a, b) {
  const aa = Buffer.from(a); const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

export function createTokenVerifier({ jwks, issuer, audience, subject, resource }) {
  return { verifyAccessToken: async token => {
    try {
      const { payload } = await jwtVerify(token, jwks, { issuer, audience,
        algorithms: ['RS256', 'ES256', 'EdDSA'], requiredClaims: ['sub', 'exp'] });
      if (payload.sub !== subject) throw new Error('Wrong account');
      const scopes = typeof payload.scope === 'string' ? payload.scope.split(' ') : [];
      return { token, clientId: String(payload.client_id ?? payload.azp ?? 'oauth-client'), scopes, expiresAt: payload.exp, resource };
    } catch { throw new InvalidTokenError('Invalid access token'); }
  } };
}

export async function createHttpApp(config, service) {
  const app = express();
  app.disable('x-powered-by');
  const local = localHosts.includes(config.host);
  const hasOAuth = Boolean(config.issuer);
  if (!hasOAuth && !(config.demo && local) && config.accessToken.length < 32) throw new Error('HTTP wymaga MCP_ACCESS_TOKEN (minimum 32 znaki) lub OAuth.');
  if (!local && !config.publicUrl) throw new Error('Zdalny serwer wymaga MCP_PUBLIC_URL=https://twoja-domena/mcp i reverse proxy HTTPS.');
  const publicUrl = config.publicUrl ? new URL(config.publicUrl) : null;
  if (publicUrl && (publicUrl.protocol !== 'https:' || publicUrl.pathname !== '/mcp' || publicUrl.search || publicUrl.hash || publicUrl.username || publicUrl.password)) throw new Error('MCP_PUBLIC_URL musi mieć postać https://domena/mcp.');
  const allowedHosts = [...localHosts, '[::1]', ...(publicUrl ? [publicUrl.hostname] : [])];
  app.use(hostHeaderValidation(allowedHosts));
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const origin = req.get('origin');
    if (origin && !config.allowedOrigins.includes(origin)) return res.status(403).json({ error: 'Origin not allowed' });
    if (origin) { res.set('Access-Control-Allow-Origin', origin); res.vary('Origin'); }
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Methods', 'POST,GET,DELETE,OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Authorization,Content-Type,MCP-Protocol-Version,Mcp-Session-Id');
      return res.sendStatus(204);
    }
    next();
  });
  let minute = 0; let requests = 0;
  app.use((req, res, next) => {
    const window = Math.floor(Date.now() / 60000);
    if (window !== minute) { minute = window; requests = 0; }
    if (++requests > 240) { res.set('Retry-After', '60'); return res.sendStatus(429); }
    next();
  });
  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'garmin-personal-mcp' }));
  let authenticate;
  if (hasOAuth) {
    if (!publicUrl || !config.oauthSubject) throw new Error('OAuth wymaga MCP_PUBLIC_URL i OAUTH_SUBJECT (konto właściciela danych).');
    const issuer = new URL(config.issuer);
    if (issuer.protocol !== 'https:' || issuer.search || issuer.hash || issuer.username || issuer.password) throw new Error('OAUTH_ISSUER wymaga poprawnego adresu HTTPS.');
    const metadataUrl = new URL(`${issuer.href.replace(/\/$/, '')}/.well-known/openid-configuration`);
    const response = await fetch(metadataUrl, { signal: AbortSignal.timeout(10000), redirect: 'error' });
    if (!response.ok) throw new Error('Nie można pobrać metadanych dostawcy OAuth.');
    const metadata = await response.json();
    if (metadata.issuer !== config.issuer || !metadata.jwks_uri || !metadata.authorization_endpoint || !metadata.token_endpoint) throw new Error('Nieprawidłowe metadane dostawcy OAuth.');
    for (const url of [metadata.jwks_uri, metadata.authorization_endpoint, metadata.token_endpoint]) if (new URL(url).protocol !== 'https:') throw new Error('Endpointy OAuth wymagają HTTPS.');
    const jwks = createRemoteJWKSet(new URL(metadata.jwks_uri));
    app.use(mcpAuthMetadataRouter({ oauthMetadata: metadata, resourceServerUrl: publicUrl, scopesSupported: [config.oauthScope], resourceName: 'Private Garmin Training' }));
    const verifier = createTokenVerifier({ jwks, issuer: config.issuer, audience: config.oauthAudience || publicUrl.href,
      subject: config.oauthSubject, resource: publicUrl });
    authenticate = requireBearerAuth({ verifier, requiredScopes: [config.oauthScope], expectedResource: publicUrl,
      resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(publicUrl) });
  } else {
    authenticate = (req, res, next) => {
      if (config.demo && local && !config.accessToken) return next();
      const authorization = req.get('authorization') || '';
      if (!authorization.startsWith('Bearer ') || !equalSecret(authorization.slice(7), config.accessToken)) {
        res.set('WWW-Authenticate', 'Bearer'); return res.sendStatus(401);
      }
      next();
    };
  }
  app.use('/mcp', authenticate, express.json({ limit: '256kb' }));
  let inFlight = 0;
  app.post('/mcp', async (req, res) => {
    if (inFlight >= 8) return res.status(503).json({ error: 'Too many concurrent requests' });
    inFlight++;
    const server = createMcpServer(service);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { inFlight--; void server.close().catch(() => {}); });
    try { await server.connect(transport); await transport.handleRequest(req, res, req.body); }
    catch { if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal MCP error' } }); }
  });
  app.all('/mcp', (_req, res) => res.sendStatus(405));
  app.use((error, _req, res, _next) => {
    if (!res.headersSent) res.status(error.type === 'entity.too.large' ? 413 : 400).json({ error: 'Invalid request' });
  });
  return app;
}
