/**
 * Utilities for PeerDrop application URLs, hostnames, and sharing links.
 * Ensures all displayed links, badges, and titles strictly use the official PeerDrop branding.
 */

export function getCleanPeerDropUrl(rawUrl?: string): string {
  if (typeof window === 'undefined') return 'https://peerdrop.app';
  const url = rawUrl || window.location.href;
  // Replace any legacy netbeam subdomain or path occurrences with peerdrop
  return url.replace(/netbeam/gi, 'peerdrop');
}

export function getWorkingAppUrl(): string {
  if (typeof window === 'undefined') return 'https://peerdrop.app';
  return window.location.href;
}

export function getLanDisplayAddress(ip?: string): string {
  if (ip && ip !== '127.0.0.1' && !ip.includes('unknown') && !ip.includes('...')) {
    return `http://${ip}:3000`;
  }
  return getCleanPeerDropUrl();
}
