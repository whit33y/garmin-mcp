import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Store } from '../src/store.js';
import { DemoClient } from '../src/demo.js';
import { TrainingService } from '../src/service.js';
import { createHttpApp, equalSecret, createTokenVerifier } from '../src/http.js';
import { generateKeyPair, SignJWT } from 'jose';

test('OAuth checks signed JWT audience, expiry, issuer and owner account', async () => {
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const issuer = 'https://issuer.example/'; const audience = 'https://garmin.example/mcp';
  const verifier = createTokenVerifier({ jwks: publicKey, issuer, audience, subject: 'owner', resource: new URL(audience) });
  const sign = (overrides = {}) => new SignJWT({ sub: 'owner', iss: issuer, aud: audience, scope: 'mcp', exp: Math.floor(Date.now() / 1000) + 300, ...overrides }).setProtectedHeader({ alg: 'ES256' }).sign(privateKey);
  assert.deepEqual((await verifier.verifyAccessToken(await sign())).scopes, ['mcp']);
  for (const invalid of [{ sub: 'someone-else' }, { aud: 'https://other-api.example' }, { iss: 'https://fake.example/' }, { exp: 1 }]) {
    await assert.rejects(verifier.verifyAccessToken(await sign(invalid)), /Invalid access token/);
  }
  await assert.rejects(verifier.verifyAccessToken('not-a-token'), /Invalid access token/);
});

const baseConfig = { host: '127.0.0.1', demo: false, accessToken: 'a'.repeat(64), allowedOrigins: [], issuer: '', publicUrl: '' };
test('HTTP refuses missing credentials and unsafe external binding', async () => {
  await assert.rejects(createHttpApp({ ...baseConfig, accessToken: '' }, {}), /wymaga/);
  await assert.rejects(createHttpApp({ ...baseConfig, host: '0.0.0.0' }, {}), /MCP_PUBLIC_URL/);
  await assert.rejects(createHttpApp({ ...baseConfig, issuer: 'https://issuer.example' }, {}), /OAUTH_SUBJECT/);
  assert.equal(equalSecret('abc', 'abc'), true); assert.equal(equalSecret('abc', 'abcd'), false);
});

test('HTTP authenticates, rejects foreign Host/Origin and completes MCP tool calls', async () => {
  const store = new Store(':memory:');
  const service = new TrainingService({ client: new DemoClient(), store, demo: true });
  const app = await createHttpApp(baseConfig, service);
  const listener = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { listener.once('listening', resolve); listener.once('error', reject); });
  const url = new URL(`http://127.0.0.1:${listener.address().port}/mcp`);
  const client = new Client({ name: 'http-test', version: '1.0.0' });
  try {
    assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 401);
    assert.equal((await fetch(url, { method: 'POST', headers: { origin: 'https://evil.example', authorization: `Bearer ${baseConfig.accessToken}` } })).status, 403);
    const foreignHostStatus = await new Promise((resolve, reject) => {
      const req = request(url, { method: 'POST', headers: { Host: 'evil.example', Authorization: `Bearer ${baseConfig.accessToken}` } }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject); req.end();
    });
    assert.equal(foreignHostStatus, 403);
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${baseConfig.accessToken}` } } }));
    assert.equal((await client.listTools()).tools.length, 19);
    const result = await client.callTool({ name: 'suggest_today_training', arguments: { preferredSport: 'swimming' } });
    assert.notEqual(result.isError, true);
    assert.equal(result.structuredContent.suggestions[0].sport, 'swimming');
  } finally {
    await client.close();
    await new Promise(resolve => listener.close(resolve));
    store.close();
  }
});
