/**
 * High-performance Web Crypto API implementation for end-to-end encryption (E2EE)
 * Using AES-256-GCM with PBKDF2 key derivation and unique IV per chunk.
 */

// Convert ArrayBuffer to Base64 in fast memory-efficient batches
export function bufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const CHUNK_SZ = 0x8000; // 32KB batches for fromCharCode to prevent stack overflow
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK_SZ) {
    chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK_SZ) as unknown as number[]));
  }
  return btoa(chunks.join(''));
}

// Convert Base64 to Uint8Array
export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Derive a 256-bit AES-GCM key from network secret / password
export async function deriveKeyFromSecret(password: string, salt: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    enc.encode(password || 'default-secure-peerdrop-key'),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );

  return await window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode(salt || 'peerdrop-p2p-salt-v1'),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

// Encrypt a single chunk of data with AES-256-GCM
export async function encryptChunk(
  data: ArrayBuffer,
  key: CryptoKey
): Promise<{ encrypted: ArrayBuffer; iv: Uint8Array }> {
  // 12-byte IV is standard and optimal for AES-GCM
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv,
      tagLength: 128, // 128-bit authentication tag
    },
    key,
    data
  );

  return { encrypted, iv };
}

// Decrypt a single chunk of data with AES-256-GCM
export async function decryptChunk(
  encryptedData: ArrayBuffer,
  key: CryptoKey,
  iv: Uint8Array
): Promise<ArrayBuffer> {
  return await window.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: iv as BufferSource,
      tagLength: 128,
    },
    key,
    encryptedData
  );
}

// Generate short cryptographic fingerprint of the key
export async function generateFingerprint(key: CryptoKey): Promise<string> {
  try {
    const exported = await window.crypto.subtle.exportKey('raw', key);
    const hash = await window.crypto.subtle.digest('SHA-256', exported);
    const hashArray = Array.from(new Uint8Array(hash));
    const hex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.substring(0, 4)}:${hex.substring(4, 8)}:${hex.substring(8, 12)}:${hex.substring(12, 16)}`.toUpperCase();
  } catch {
    return 'E2EE-AES256-ACTIVE';
  }
}

// Calculate SHA-256 checksum of an ArrayBuffer
export async function calculateChecksum(buffer: ArrayBuffer): Promise<string> {
  const hash = await window.crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hash));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
