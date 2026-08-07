import { describe, expect, test } from 'bun:test'
import { assertSafeRemoteUrl, isPrivateIp } from '../../src/security/url-policy.js'
import type { DnsLookup } from '../../src/security/url-policy.js'

const publicLookup: DnsLookup = () => Promise.resolve([{ address: '93.184.216.34', family: 4 }])

describe('remote URL policy', () => {
  test.each([
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '0.0.0.0',
    '::1',
    'fc00::1',
    'fd12::1',
    'fe80::1',
    '::ffff:127.0.0.1',
  ])('classifies %s as private', address => {
    expect(isPrivateIp(address)).toBe(true)
  })

  test.each(['8.8.8.8', '93.184.216.34', '198.51.1.1', '203.0.1.1', '2001:4860:4860::8888'])(
    'classifies %s as public',
    address => {
      expect(isPrivateIp(address)).toBe(false)
    },
  )

  test('accepts a public HTTPS hostname', async () => {
    const result = await assertSafeRemoteUrl(
      'https://example.com/image.png',
      { allowPrivateNetwork: false },
      publicLookup,
    )
    expect(result.href).toBe('https://example.com/image.png')
  })

  test.each([
    'file:///etc/passwd',
    'https://user:password@example.com/image.png',
    'http://localhost/image.png',
    'http://127.0.0.1/image.png',
    'http://[::1]/image.png',
  ])('rejects unsafe URL %s', url => {
    expect(assertSafeRemoteUrl(url, { allowPrivateNetwork: false }, publicLookup)).rejects.toMatchObject({
      code: 'URL_ACCESS_DENIED',
    })
  })

  test('rejects a public hostname resolving to a private address', () => {
    const privateLookup: DnsLookup = () => Promise.resolve([{ address: '127.0.0.1', family: 4 }])
    expect(
      assertSafeRemoteUrl('https://example.com/a.png', { allowPrivateNetwork: false }, privateLookup),
    ).rejects.toMatchObject({ code: 'URL_ACCESS_DENIED' })
  })

  test('maps DNS failures to a safe policy error', () => {
    const failedLookup: DnsLookup = () => Promise.reject(new Error('resolver details'))
    expect(
      assertSafeRemoteUrl('https://example.com/a.png', { allowPrivateNetwork: false }, failedLookup),
    ).rejects.toMatchObject({ code: 'URL_ACCESS_DENIED' })
  })
})
