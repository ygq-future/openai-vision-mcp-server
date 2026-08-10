import { lookup as nodeLookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { VisionError } from '../errors.js'

export interface DnsAddress {
  address: string
  family: number
}

export type DnsLookup = (hostname: string) => Promise<readonly DnsAddress[]>

export interface RemoteUrlPolicy {
  allowPrivateNetwork: boolean
}

const defaultLookup: DnsLookup = async hostname => nodeLookup(hostname, { all: true, verbatim: true })

function isPrivateIpv4(address: string): boolean {
  const octets = address.split('.').map(Number)
  if (octets.length !== 4 || octets.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return true
  const [a = 0, b = 0, c = 0] = octets
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && ((b === 0 && (c === 0 || c === 2)) || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  )
}

export function isPrivateIp(input: string): boolean {
  const address = input.replace(/^\[|\]$/g, '').toLowerCase()
  if (isIP(address) === 4) return isPrivateIpv4(address)
  if (isIP(address) !== 6) return true

  const mapped = /^(?:::ffff:)(\d+\.\d+\.\d+\.\d+)$/.exec(address)
  if (mapped?.[1]) return isPrivateIpv4(mapped[1])
  const first = Number.parseInt(address.split(':')[0] ?? '0', 16)
  return (
    address === '::' ||
    address === '::1' ||
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xff00) === 0xff00 ||
    address.startsWith('2001:db8:') ||
    first < 0x2000 ||
    first > 0x3fff
  )
}

export async function assertSafeRemoteUrl(
  input: string | URL,
  policy: RemoteUrlPolicy,
  lookup: DnsLookup = defaultLookup,
): Promise<URL> {
  let url: URL
  try {
    url = new URL(input)
  } catch (error) {
    throw new VisionError('URL_ACCESS_DENIED', 'The remote image URL is invalid.', {
      details: { stage: 'url_validation' },
      cause: error,
    })
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new VisionError('URL_ACCESS_DENIED', 'The remote image URL must use HTTP(S) without embedded credentials.', {
      details: { stage: 'url_validation' },
    })
  }
  if (policy.allowPrivateNetwork) return url
  if (url.hostname.toLowerCase() === 'localhost') {
    throw new VisionError(
      'URL_ACCESS_DENIED',
      'The remote image host is private while private-network access is disabled.',
      {
        details: { stage: 'url_policy' },
      },
    )
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  let addresses: readonly DnsAddress[]
  try {
    addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await lookup(hostname)
  } catch (error) {
    throw new VisionError('URL_ACCESS_DENIED', 'The remote image hostname could not be resolved.', {
      details: { stage: 'dns_resolution' },
      cause: error,
    })
  }
  if (addresses.length === 0 || addresses.some(result => isPrivateIp(result.address))) {
    throw new VisionError('URL_ACCESS_DENIED', 'The remote image host resolved to a non-public address.', {
      details: { stage: 'url_policy' },
    })
  }
  return url
}
