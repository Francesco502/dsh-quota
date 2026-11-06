import test from 'node:test'
import assert from 'node:assert/strict'
import { assertSafeRemoteUrl, isSafeRemoteUrl, UnsafeRemoteUrlError } from '../src/core/net-guard.ts'

test('rejects non-http schemes', async () => {
  await assert.rejects(() => assertSafeRemoteUrl('file:///etc/passwd'), UnsafeRemoteUrlError)
  await assert.rejects(() => assertSafeRemoteUrl('gopher://127.0.0.1:6379/'), UnsafeRemoteUrlError)
})

test('rejects cloud metadata and link-local targets', async () => {
  await assert.rejects(() => assertSafeRemoteUrl('http://169.254.169.254/latest/meta-data/'), UnsafeRemoteUrlError)
  await assert.rejects(() => assertSafeRemoteUrl('http://[fe80::1]/'), UnsafeRemoteUrlError)
  await assert.rejects(() => assertSafeRemoteUrl('http://metadata.google.internal/'), UnsafeRemoteUrlError)
})

test('rejects embedded credentials', async () => {
  await assert.rejects(() => assertSafeRemoteUrl('http://user:pass@127.0.0.1:3000/'), UnsafeRemoteUrlError)
})

test('allows a local relay (the legitimate deployment)', async () => {
  const url = await assertSafeRemoteUrl('http://127.0.0.1:3000/v1')
  assert.equal(url.port, '3000')
  assert.equal(await isSafeRemoteUrl('http://localhost:8080'), true)
})

test('allows private LAN addresses', async () => {
  assert.equal(await isSafeRemoteUrl('http://192.168.1.5:3000'), true)
  assert.equal(await isSafeRemoteUrl('http://10.0.0.8:3000/v1'), true)
})

test('rejects unspecified addresses', async () => {
  await assert.rejects(() => assertSafeRemoteUrl('http://0.0.0.0:3000/'), UnsafeRemoteUrlError)
})

test('returns false instead of throwing for unsafe URLs', async () => {
  assert.equal(await isSafeRemoteUrl('http://169.254.169.254/'), false)
  assert.equal(await isSafeRemoteUrl('not a url'), false)
})
