'use strict'

const crypto = require('node:crypto')

function parseIPv4(value) {
  if (typeof value !== 'string') return null
  const parts = value.trim().split('.')
  if (parts.length !== 4) return null
  const octets = parts.map((part) => /^\d{1,3}$/.test(part) ? Number(part) : NaN)
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null
  return octets
}

function ipv4ToInt(value) {
  const parts = parseIPv4(value)
  if (!parts) return null
  return ((((parts[0] * 256) + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0
}

function intToIPv4(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) return null
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.')
}

function prefixFromNetmask(netmask) {
  const value = ipv4ToInt(netmask)
  if (value == null) return null
  let prefix = 0
  let sawZero = false
  for (let bit = 31; bit >= 0; bit -= 1) {
    const set = (value & (2 ** bit)) !== 0
    if (set && sawZero) return null
    if (set) prefix += 1
    else sawZero = true
  }
  return prefix
}

function isUsableUnicast(value) {
  const parts = parseIPv4(value)
  if (!parts) return false
  const first = parts[0]
  if (first === 0 || first === 127 || first >= 224) return false
  if (first === 169 && parts[1] === 254) return false
  return value !== '255.255.255.255'
}

function addressScope(value) {
  const parts = parseIPv4(value)
  if (!parts) return 'other'
  if (parts[0] === 10) return 'private'
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return 'private'
  if (parts[0] === 192 && parts[1] === 168) return 'private'
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return 'shared'
  return 'other'
}

function stableInterfaceId(name, address, prefixLength) {
  return crypto.createHash('sha256').update(`${name}\0${address}\0${prefixLength}`).digest('hex').slice(0, 16)
}

function interfaceRank(name) {
  const value = String(name || '').toLowerCase()
  if (/^(?:en\d+|eth\d+|wlan\d+|wi-?fi|ethernet)/.test(value)) return 0
  if (/^(?:bridge|utun|tun|tap|docker|veth|vmnet|vbox|hyper-v)/.test(value)) return 2
  return 1
}

function interfaceKind(name) {
  const value = String(name || '').toLowerCase()
  if (/^(?:utun|tun|tap|wg|ppp|ipsec)/.test(value) || /vpn/.test(value)) return 'vpn'
  if (/^(?:bridge|docker|veth|vmnet|vbox|virbr|br-|hyper-v)/.test(value)) return 'virtual'
  return 'physical'
}

function exactInterfaceMatch(left, right) {
  return Boolean(left && right
    && left.id === right.id
    && left.name === right.name
    && left.address === right.address
    && left.prefixLength === right.prefixLength
    && left.scope === right.scope
    && left.kind === right.kind)
}

function listInterfacesFromNode(nodeOs) {
  let raw = {}
  try {
    raw = nodeOs && typeof nodeOs.networkInterfaces === 'function' ? nodeOs.networkInterfaces() : {}
  } catch {
    raw = {}
  }
  const result = []
  for (const [name, entries] of Object.entries(raw || {})) {
    if (!Array.isArray(entries)) continue
    for (const entry of entries) {
      const family = entry && entry.family
      if (!entry || entry.internal || (family !== 'IPv4' && family !== 4)) continue
      const address = typeof entry.address === 'string' ? entry.address : ''
      if (!isUsableUnicast(address)) continue
      const cidrPrefix = typeof entry.cidr === 'string' && entry.cidr.includes('/')
        ? Number(entry.cidr.slice(entry.cidr.lastIndexOf('/') + 1))
        : null
      const prefixLength = Number.isInteger(cidrPrefix) && cidrPrefix >= 0 && cidrPrefix <= 32
        ? cidrPrefix
        : prefixFromNetmask(entry.netmask)
      if (prefixLength == null) continue
      const scope = addressScope(address)
      // Active discovery is limited to RFC1918 and carrier-grade NAT ranges.
      // A directly assigned public address must never become an implicit sweep.
      if (scope === 'other') continue
      const kind = interfaceKind(name)
      const requiresConfirmation = scope === 'shared' || kind !== 'physical'
      result.push({
        id: stableInterfaceId(name, address, prefixLength),
        name: String(name).slice(0, 120),
        address,
        cidr: `${address}/${prefixLength}`,
        prefixLength,
        scope,
        kind,
        requiresConfirmation,
        riskReason: scope === 'shared'
          ? '运营商共享地址网段'
          : kind === 'vpn'
            ? 'VPN 或隧道接口'
            : kind === 'virtual'
              ? '虚拟或桥接接口'
              : null,
      })
    }
  }
  return result.sort((a, b) => {
    const rank = { private: 0, shared: 1, other: 2 }
    return rank[a.scope] - rank[b.scope]
      || interfaceRank(a.name) - interfaceRank(b.name)
      || a.name.localeCompare(b.name)
      || a.address.localeCompare(b.address)
  })
}

function subnetContains(networkInterface, ip) {
  const own = ipv4ToInt(networkInterface && networkInterface.address)
  const candidate = ipv4ToInt(ip)
  const prefix = networkInterface && networkInterface.prefixLength
  if (own == null || candidate == null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return (own & mask) === (candidate & mask)
}

module.exports = {
  addressScope,
  intToIPv4,
  exactInterfaceMatch,
  interfaceKind,
  interfaceRank,
  ipv4ToInt,
  isUsableUnicast,
  listInterfacesFromNode,
  parseIPv4,
  prefixFromNetmask,
  stableInterfaceId,
  subnetContains,
}
