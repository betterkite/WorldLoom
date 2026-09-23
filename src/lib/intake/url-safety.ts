import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { GovernanceError } from '@/lib/governance/changes';

function ipv4ToNumber(value: string): number | null {
  const parts = value.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return null;
  }
  return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0;
}

function inIpv4Range(value: number, start: string, end: string): boolean {
  const from = ipv4ToNumber(start);
  const to = ipv4ToNumber(end);
  return from !== null && to !== null && value >= from && value <= to;
}

function ipv6Hextets(value: string): number[] | null {
  const sections = value.split('::');
  if (sections.length > 2) return null;
  const left = sections[0] ? sections[0].split(':') : [];
  const right = sections.length === 2 && sections[1] ? sections[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((sections.length === 1 && missing !== 0) || (sections.length === 2 && missing < 1)) {
    return null;
  }
  const parts = [...left, ...Array.from({ length: missing }, () => '0'), ...right];
  const parsed = parts.map((part) =>
    part.length > 0 && part.length <= 4 ? parseInt(part, 16) : NaN
  );
  return parsed.every((part) => Number.isInteger(part) && part >= 0 && part <= 0xffff)
    ? parsed
    : null;
}

function isForbiddenIp(address: string): boolean {
  const normalized = address.replace(/^\[|\]$/g, '').toLowerCase();
  if (isIP(normalized) === 4) {
    const value = ipv4ToNumber(normalized);
    if (value === null) return true;
    return [
      ['0.0.0.0', '0.255.255.255'],
      ['10.0.0.0', '10.255.255.255'],
      ['100.64.0.0', '100.127.255.255'],
      ['127.0.0.0', '127.255.255.255'],
      ['169.254.0.0', '169.254.255.255'],
      ['172.16.0.0', '172.31.255.255'],
      ['192.0.0.0', '192.0.0.255'],
      ['192.0.2.0', '192.0.2.255'],
      ['192.168.0.0', '192.168.255.255'],
      ['198.18.0.0', '198.19.255.255'],
      ['198.51.100.0', '198.51.100.255'],
      ['203.0.113.0', '203.0.113.255'],
      ['224.0.0.0', '255.255.255.255']
    ].some(([start, end]) => inIpv4Range(value, start, end));
  }
  if (isIP(normalized) !== 6) return true;
  const parts = ipv6Hextets(normalized);
  if (!parts) return true;
  const allZero = parts.every((part) => part === 0);
  const loopback = parts.slice(0, 7).every((part) => part === 0) && parts[7] === 1;
  if (allZero || loopback) return true;

  // IPv4-mapped IPv6 addresses must be checked against the IPv4 ranges too.
  if (parts.slice(0, 5).every((part) => part === 0) && parts[5] === 0xffff) {
    const mapped = `${parts[6] >> 8}.${parts[6] & 0xff}.${parts[7] >> 8}.${parts[7] & 0xff}`;
    return isForbiddenIp(mapped);
  }

  const first = parts[0];
  return (
    (first >= 0xfc00 && first <= 0xfdff) || // unique local
    (first >= 0xfe80 && first <= 0xfebf) || // link-local
    first >= 0xff00 // multicast / reserved multicast space
  );
}

async function resolvedAddresses(hostname: string): Promise<string[]> {
  if (isIP(hostname)) return [hostname];
  try {
    return (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);
  } catch {
    throw new GovernanceError('url_fetch_failed', '目标主机无法解析');
  }
}

/** Validate every hop before making an outbound HTTP request. */
export async function assertSafeRemoteUrl(input: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new GovernanceError('invalid_url', 'URL 格式无效');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new GovernanceError('invalid_url', '仅支持 http(s) URL');
  }
  if (parsed.username || parsed.password || !parsed.hostname) {
    throw new GovernanceError('invalid_url', 'URL 不得包含凭据或空主机名');
  }
  if (parsed.port && !['80', '443'].includes(parsed.port)) {
    throw new GovernanceError('invalid_url', '仅允许标准 HTTP(S) 端口');
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new GovernanceError('invalid_url', '不允许访问本地主机');
  }
  const addresses = await resolvedAddresses(hostname);
  if (!addresses.length || addresses.some(isForbiddenIp)) {
    throw new GovernanceError('invalid_url', '不允许访问私有、保留或本地网络地址');
  }
  return parsed;
}
