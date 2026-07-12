import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildAllowedOrigins, isOriginAllowed, resolveApiHost } from './serverConfig.js'

test('resolveApiHost defaults to loopback', () => {
  assert.equal(resolveApiHost({}), '127.0.0.1')
})

test('resolveApiHost accepts explicit wildcard bind host', () => {
  assert.equal(resolveApiHost({ API_HOST: '0.0.0.0' }), '0.0.0.0')
})

test('buildAllowedOrigins includes https localhost by default', () => {
  assert.equal(isOriginAllowed('https://localhost', buildAllowedOrigins({})), true)
})

test('buildAllowedOrigins includes configured CORS origins', () => {
  const allowed = buildAllowedOrigins({ CORS_ORIGINS: 'https://app.example, http://10.0.2.2:5173 ' })

  assert.equal(isOriginAllowed('https://app.example', allowed), true)
  assert.equal(isOriginAllowed('http://10.0.2.2:5173', allowed), true)
})

test('isOriginAllowed allows requests without an Origin header', () => {
  assert.equal(isOriginAllowed(undefined, buildAllowedOrigins({})), true)
})

test('isOriginAllowed rejects unknown origins', () => {
  assert.equal(isOriginAllowed('https://unknown.example', buildAllowedOrigins({})), false)
})
