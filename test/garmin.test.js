import test from 'node:test';
import assert from 'node:assert/strict';
import { GarminClient } from '../src/garmin.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
test('live Garmin token contract: text/plain token without JSON-only Accept header', async () => {
  const client = new GarminClient({ apiKey: 'secret', baseUrl: 'https://personal.connectapi.garmin.com', fetchImpl: async (_url, options) => {
    assert.equal(options.headers.Accept, undefined);
    return new Response('header.payload.signature', { headers: { 'content-type': 'text/plain' } });
  } });
  assert.equal(await client.accessToken(), 'header.payload.signature');
});
test('key is sent only to token endpoint, requests use Bearer, cache avoids calls', async () => {
  const calls = [];
  const client = new GarminClient({ apiKey: 'secret', baseUrl: 'https://personal.connectapi.garmin.com', fetchImpl: async (url, options) => {
    calls.push({ url: url.href, options });
    return url.pathname.includes('token') ? json({ access_token: 'token', expires_in: 86400 }) : json({ value: 1 });
  } });
  await client.get('/test', { date: '2026-10-28' });
  const cached = await client.get('/test', { date: '2026-10-28' });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.headers.Authorization, 'ApiKey secret');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer token');
  assert.equal(cached.cached, true);
  assert.equal(calls[1].options.redirect, 'error');
});

test('concurrent token requests share exchange and a 401 renews once', async () => {
  let tokens = 0; let reads = 0;
  const client = new GarminClient({ apiKey: 'secret', baseUrl: 'https://personal.connectapi.garmin.com', fetchImpl: async url => {
    if (url.pathname.includes('token')) { tokens++; return json({ accessToken: `token-${tokens}` }); }
    reads++; return reads === 1 ? json({}, 401) : json({ ok: true });
  } });
  await Promise.all([client.accessToken(), client.accessToken()]);
  assert.equal(tokens, 1);
  await client.get('/test');
  assert.equal(tokens, 2);
  assert.equal(reads, 2);
});

test('expiry obtains new token; long Retry-After is respected without immediate retry', async () => {
  let now = 0; let tokens = 0;
  const client = new GarminClient({ apiKey: 'secret', baseUrl: 'https://personal.connectapi.garmin.com', now: () => now,
    fetchImpl: async url => {
      if (url.pathname.includes('token')) { tokens++; return json({ access_token: 'a', expires_in: 120 }); }
      return new Response('private response never leaked', { status: 429, headers: { 'Retry-After': '60' } });
    } });
  await client.accessToken(); now = 61000; await client.accessToken(); assert.equal(tokens, 2);
  await assert.rejects(client.get('/test'), error => error.status === 429 && !error.message.includes('private response'));
});

test('bounded retry, 204 handling, invalid shape and truncated pagination are explicit', async () => {
  let attempts = 0;
  const client = new GarminClient({ apiKey: 'x', baseUrl: 'https://personal.connectapi.garmin.com', wait: async () => {}, fetchImpl: async url => {
    if (url.pathname.includes('token')) return json({ access_token: 'a' });
    if (url.pathname === '/missing') return new Response(null, { status: 204 });
    attempts++; return json({}, 503);
  } });
  await assert.rejects(client.get('/test'), /503/); assert.equal(attempts, 3);
  assert.equal((await client.get('/missing')).data, null);
  client.get = async () => ({ data: [{ activityId: 1 }], fetchedAt: 'now' });
  assert.equal((await client.activities('2026-10-01', '2026-10-28', 1)).truncated, true);
  client.get = async () => ({ data: {}, fetchedAt: 'now' });
  await assert.rejects(client.activities('2026-10-01', '2026-10-28'), /format/);
});

test('untrusted absolute paths and oversized upstream responses are rejected', async () => {
  const client = new GarminClient({ apiKey: 'x', baseUrl: 'https://personal.connectapi.garmin.com' });
  await assert.rejects(client.get('//evil.example'), /ścieżka/);
  await assert.rejects(client.json(new Response('{}', { headers: { 'content-length': '99999999' } }), 'test'), /limit/);
});
