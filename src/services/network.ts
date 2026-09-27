import {
  PeerDevice,
  FileTransfer,
  TransferChunkMetadata,
  ConnectionType,
  DeviceType
} from '../types';
import {
  deriveKeyFromSecret,
  encryptChunk,
  decryptChunk,
  generateFingerprint,
  bufferToBase64,
  base64ToUint8Array
} from './crypto';
import { deviceKeepAlive } from './wakeLock';

// 48 KB chunks: safely leaves ~16 KB headroom for headers, AES-GCM IV & auth tag, avoiding SCTP packet overflow on all browsers
const CHUNK_SIZE = 48 * 1024;

// Detect client device information with high precision
export function detectLocalDeviceInfo(): {
  deviceType: DeviceType;
  os: string;
  browser: string;
  modelDetails: string;
  screenResolution: string;
  cpuCores: number;
  defaultName: string;
} {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  let deviceType: DeviceType = 'desktop';
  let os = 'Windows';
  let modelDetails = '';
  let browser = 'Przeglądarka Web';

  // 1. Browser Detection with version
  if (/Edg\/(\d+)/i.test(ua)) {
    const ver = ua.match(/Edg\/(\d+)/i)?.[1] || '';
    browser = `Microsoft Edge ${ver}`.trim();
  } else if (/OPR\/(\d+)/i.test(ua)) {
    const ver = ua.match(/OPR\/(\d+)/i)?.[1] || '';
    browser = `Opera ${ver}`.trim();
  } else if (/SamsungBrowser\/(\d+)/i.test(ua)) {
    const ver = ua.match(/SamsungBrowser\/(\d+)/i)?.[1] || '';
    browser = `Samsung Internet ${ver}`.trim();
  } else if (/Firefox\/(\d+)/i.test(ua)) {
    const ver = ua.match(/Firefox\/(\d+)/i)?.[1] || '';
    browser = `Firefox ${ver}`.trim();
  } else if (/Chrome\/(\d+)/i.test(ua) && !/Chromium/i.test(ua)) {
    const ver = ua.match(/Chrome\/(\d+)/i)?.[1] || '';
    browser = `Chrome ${ver}`.trim();
  } else if (/Version\/(\d+).*Safari/i.test(ua)) {
    const ver = ua.match(/Version\/(\d+)/i)?.[1] || '';
    browser = `Safari ${ver}`.trim();
  } else if (/Safari/i.test(ua)) {
    browser = 'Safari';
  }

  // 2. Hardware & GPU probe via WebGL
  let gpuRenderer = '';
  if (typeof document !== 'undefined') {
    try {
      const canvas = document.createElement('canvas');
      const gl = (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
      if (gl) {
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
          const rawRenderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '';
          if (typeof rawRenderer === 'string') {
            // Clean up common GPU strings:
            if (/NVIDIA\s+GeForce\s+([^,)]+)/i.test(rawRenderer)) {
              gpuRenderer = 'RTX ' + (rawRenderer.match(/RTX\s+([0-9A-Za-z\s]+)/i)?.[1]?.trim() || rawRenderer.match(/GeForce\s+([^,)]+)/i)?.[1]?.trim() || '');
            } else if (/Intel.*Iris.*Xe/i.test(rawRenderer)) {
              gpuRenderer = 'Intel Iris Xe';
            } else if (/Intel.*UHD/i.test(rawRenderer)) {
              gpuRenderer = 'Intel UHD Graphics';
            } else if (/Radeon\s+([^,)]+)/i.test(rawRenderer)) {
              gpuRenderer = 'AMD Radeon ' + (rawRenderer.match(/Radeon\s+([^,)]+)/i)?.[1]?.trim() || '');
            } else if (/Apple\s+(M\d(?:\s*Pro|\s*Max|\s*Ultra)?)/i.test(rawRenderer)) {
              gpuRenderer = rawRenderer.match(/Apple\s+(M\d(?:\s*Pro|\s*Max|\s*Ultra)?)/i)?.[1] || 'Apple Silicon';
            } else if (/Apple\s+A\d+/i.test(rawRenderer)) {
              gpuRenderer = rawRenderer.match(/Apple\s+A\d+/i)?.[0] || '';
            } else if (/Adreno.*([0-9]{3})/i.test(rawRenderer)) {
              gpuRenderer = 'Adreno ' + rawRenderer.match(/([0-9]{3})/i)?.[1];
            } else if (/Mali.*(G[0-9]+)/i.test(rawRenderer)) {
              gpuRenderer = 'Mali ' + rawRenderer.match(/(G[0-9]+)/i)?.[1];
            }
          }
        }
      }
    } catch {}
  }

  // 3. Screen & CPU Specs
  let screenResolution = '1920×1080';
  if (typeof window !== 'undefined' && window.screen) {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(window.screen.width * (dpr > 1.5 ? dpr : 1));
    const h = Math.round(window.screen.height * (dpr > 1.5 ? dpr : 1));
    screenResolution = `${w}×${h} px`;
  }
  const cpuCores = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency || 4) : 4;

  // 4. Device Type & OS Detection
  const hasTouch = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;
  const isSmallScreen = typeof screen !== 'undefined' && Math.min(screen.width, screen.height) < 600;

  if (/Android/i.test(ua)) {
    os = 'Android';
    deviceType = isSmallScreen || !/Tablet/i.test(ua) ? 'phone' : 'tablet';

    // Extract exact phone model code
    const match = ua.match(/Android[^;)]*;\s*([^;)]+?)(?:\s+Build|[;)])/i);
    let rawModel = match ? match[1].trim() : '';

    // Samsung Galaxy series (S25, S24, S23, S22, S21, Fold, Flip, Tab, A-series)
    if (/SM-S938/i.test(rawModel)) rawModel = 'Samsung Galaxy S25 Ultra';
    else if (/SM-S936/i.test(rawModel)) rawModel = 'Samsung Galaxy S25+';
    else if (/SM-S931/i.test(rawModel)) rawModel = 'Samsung Galaxy S25';
    else if (/SM-S928/i.test(rawModel)) rawModel = 'Samsung Galaxy S24 Ultra';
    else if (/SM-S926/i.test(rawModel)) rawModel = 'Samsung Galaxy S24+';
    else if (/SM-S921/i.test(rawModel)) rawModel = 'Samsung Galaxy S24';
    else if (/SM-S918/i.test(rawModel)) rawModel = 'Samsung Galaxy S23 Ultra';
    else if (/SM-S916/i.test(rawModel)) rawModel = 'Samsung Galaxy S23+';
    else if (/SM-S911/i.test(rawModel)) rawModel = 'Samsung Galaxy S23';
    else if (/SM-S908/i.test(rawModel)) rawModel = 'Samsung Galaxy S22 Ultra';
    else if (/SM-S901/i.test(rawModel)) rawModel = 'Samsung Galaxy S22';
    else if (/SM-G998/i.test(rawModel)) rawModel = 'Samsung Galaxy S21 Ultra';
    else if (/SM-G991/i.test(rawModel)) rawModel = 'Samsung Galaxy S21';
    else if (/SM-F956/i.test(rawModel)) rawModel = 'Samsung Galaxy Z Fold 6';
    else if (/SM-F946/i.test(rawModel)) rawModel = 'Samsung Galaxy Z Fold 5';
    else if (/SM-F741/i.test(rawModel)) rawModel = 'Samsung Galaxy Z Flip 6';
    else if (/SM-F731/i.test(rawModel)) rawModel = 'Samsung Galaxy Z Flip 5';
    else if (/SM-A556/i.test(rawModel)) rawModel = 'Samsung Galaxy A55';
    else if (/SM-A546/i.test(rawModel)) rawModel = 'Samsung Galaxy A54';
    else if (/SM-A356/i.test(rawModel)) rawModel = 'Samsung Galaxy A35';
    else if (/SM-A346/i.test(rawModel)) rawModel = 'Samsung Galaxy A34';
    else if (/SM-A155|SM-A156/i.test(rawModel)) rawModel = 'Samsung Galaxy A15';
    else if (/SM-X910/i.test(rawModel)) rawModel = 'Samsung Galaxy Tab S9 Ultra';
    else if (/SM-X810/i.test(rawModel)) rawModel = 'Samsung Galaxy Tab S9+';
    else if (/SM-X710/i.test(rawModel)) rawModel = 'Samsung Galaxy Tab S9';
    else if (/SM-X210/i.test(rawModel)) rawModel = 'Samsung Galaxy Tab A9+';
    else if (/SM-T|Tab/i.test(rawModel)) rawModel = 'Tablet Samsung Galaxy';
    else if (/SM-[A-Z][0-9]+/i.test(rawModel)) rawModel = 'Samsung Galaxy ' + rawModel;
    // Google Pixel series
    else if (/Pixel 9 Pro XL/i.test(rawModel)) rawModel = 'Google Pixel 9 Pro XL';
    else if (/Pixel 9 Pro/i.test(rawModel)) rawModel = 'Google Pixel 9 Pro';
    else if (/Pixel 9/i.test(rawModel)) rawModel = 'Google Pixel 9';
    else if (/Pixel 8 Pro/i.test(rawModel)) rawModel = 'Google Pixel 8 Pro';
    else if (/Pixel 8a/i.test(rawModel)) rawModel = 'Google Pixel 8a';
    else if (/Pixel 8/i.test(rawModel)) rawModel = 'Google Pixel 8';
    else if (/Pixel 7 Pro/i.test(rawModel)) rawModel = 'Google Pixel 7 Pro';
    else if (/Pixel 7a/i.test(rawModel)) rawModel = 'Google Pixel 7a';
    else if (/Pixel 7/i.test(rawModel)) rawModel = 'Google Pixel 7';
    else if (/Pixel 6/i.test(rawModel)) rawModel = 'Google Pixel 6';
    // Xiaomi / Redmi / POCO
    else if (/23116PN5BC|23127PN0CG|Xiaomi 14/i.test(rawModel)) rawModel = 'Xiaomi 14';
    else if (/Xiaomi 13/i.test(rawModel)) rawModel = 'Xiaomi 13';
    else if (/Redmi Note/i.test(rawModel)) rawModel = rawModel.replace(/Build\/.*/i, '').trim();
    else if (/POCO/i.test(rawModel)) rawModel = rawModel.replace(/Build\/.*/i, '').trim();
    else if (/Xiaomi|Redmi/i.test(rawModel)) rawModel = rawModel.replace(/Build\/.*/i, '').trim();
    // OnePlus / Motorola / Asus
    else if (/CPH2581|CPH2573|OnePlus 12/i.test(rawModel)) rawModel = 'OnePlus 12';
    else if (/motorola|moto/i.test(rawModel)) rawModel = rawModel.replace(/Build\/.*/i, '').trim();

    if (deviceType === 'tablet' || /Tab|Pad/i.test(rawModel)) {
      deviceType = 'tablet';
      modelDetails = rawModel || 'Tablet Android';
    } else {
      modelDetails = rawModel || (gpuRenderer ? `Smartfon Android (${gpuRenderer})` : 'Smartfon Android');
    }
  } else if (/iPhone/i.test(ua)) {
    os = 'iOS';
    deviceType = 'phone';
    // Estimate iPhone model by screen logical dimensions and device pixel ratio
    const sw = typeof screen !== 'undefined' ? Math.max(screen.width, screen.height) : 0;
    const minW = typeof screen !== 'undefined' ? Math.min(screen.width, screen.height) : 0;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 2 : 2;
    const physH = Math.round(sw * dpr);

    if (physH >= 2868 || sw >= 956) modelDetails = 'iPhone 16 Pro Max';
    else if (physH >= 2796 || (sw >= 932 && dpr >= 3)) modelDetails = 'iPhone 15/14 Pro Max';
    else if (physH >= 2622 || sw >= 874) modelDetails = 'iPhone 16 Pro';
    else if (physH >= 2556 || (sw >= 852 && dpr >= 3)) modelDetails = 'iPhone 16 / 15 Pro';
    else if (physH >= 2532 || (sw >= 844 && dpr >= 3)) modelDetails = 'iPhone 14 / 13 Pro / 13';
    else if (sw >= 896) modelDetails = dpr >= 3 ? 'iPhone 11 Pro Max / XS Max' : 'iPhone 11 / XR';
    else if (sw >= 812) modelDetails = 'iPhone 13 mini / 12 mini / X';
    else if (sw <= 667) modelDetails = 'iPhone SE / 8';
    else modelDetails = 'Apple iPhone';
  } else if (/iPad/i.test(ua) || (hasTouch && /Macintosh/i.test(ua))) {
    os = 'iPadOS';
    deviceType = 'tablet';
    const sw = typeof screen !== 'undefined' ? Math.max(screen.width, screen.height) : 0;
    if (sw >= 1366) modelDetails = 'Apple iPad Pro 12.9" / 13"';
    else if (sw >= 1194) modelDetails = 'Apple iPad Pro 11"';
    else if (sw >= 1180) modelDetails = 'Apple iPad Air';
    else if (sw >= 1080) modelDetails = 'Apple iPad 10.2" / 10th gen';
    else if (sw >= 1133) modelDetails = 'Apple iPad mini';
    else modelDetails = 'Apple iPad';
  } else if (/Macintosh/i.test(ua)) {
    os = 'macOS';
    deviceType = 'laptop';
    if (gpuRenderer.includes('M4')) {
      modelDetails = `MacBook Pro (${gpuRenderer})`;
    } else if (gpuRenderer.includes('M3')) {
      modelDetails = `MacBook Pro (${gpuRenderer})`;
    } else if (gpuRenderer.includes('M2') || gpuRenderer.includes('M1')) {
      const isAir = typeof screen !== 'undefined' && screen.width <= 1440;
      modelDetails = isAir ? `MacBook Air (${gpuRenderer})` : `MacBook Pro (${gpuRenderer})`;
    } else if (gpuRenderer.includes('Apple')) {
      modelDetails = `Apple Mac (${gpuRenderer})`;
    } else {
      modelDetails = 'Apple Mac (macOS)';
    }
  } else if (/Windows/i.test(ua)) {
    os = 'Windows';
    // Distinguish Windows 11 vs Windows 10
    const isWin11 = /Windows NT 10.0.*(?:Win64; x64)?/i.test(ua) && typeof navigator !== 'undefined' && (navigator as any).userAgentData?.platformVersion
      ? parseInt((navigator as any).userAgentData.platformVersion.split('.')[0] || '0', 10) >= 13
      : true; // Modern browsers on Win 11 report Windows NT 10.0
    const winVer = isWin11 ? 'Windows 11' : 'Windows 10';

    const isTouchLaptop = hasTouch && !isSmallScreen;
    const isSurface = isTouchLaptop && typeof screen !== 'undefined' && Math.abs(screen.width / screen.height - 1.5) < 0.15;
    const isLaptop = isTouchLaptop || (typeof screen !== 'undefined' && screen.width <= 1920 && screen.height <= 1080 && cpuCores <= 16);
    deviceType = isLaptop ? 'laptop' : 'desktop';

    if (isSurface) {
      modelDetails = `Microsoft Surface Pro (${winVer})`;
    } else if (gpuRenderer) {
      modelDetails = isLaptop ? `Laptop PC (${winVer} · ${gpuRenderer})` : `Komputer PC (${winVer} · ${gpuRenderer})`;
    } else {
      modelDetails = isLaptop ? `Laptop PC (${winVer})` : `Komputer PC (${winVer})`;
    }
  } else if (/Linux/i.test(ua)) {
    os = 'Linux';
    deviceType = 'desktop';
    modelDetails = gpuRenderer ? `Komputer Linux (${gpuRenderer})` : 'Komputer PC (Linux)';
  } else {
    modelDetails = 'Urządzenie sieciowe';
  }

  // Friendly, distinctive default name
  const shortBrowser = browser.split(' ')[0];
  const defaultName = `${modelDetails} · ${shortBrowser}`;

  return {
    deviceType,
    os,
    browser,
    modelDetails,
    screenResolution,
    cpuCores,
    defaultName
  };
}

// Asynchronously query modern User-Agent Client Hints API (Chrome/Edge/Opera/Android) for exact device model
export async function detectEnhancedDeviceInfoAsync(): Promise<{
  name?: string;
  modelDetails?: string;
  deviceType?: DeviceType;
} | null> {
  try {
    if (typeof navigator !== 'undefined' && (navigator as any).userAgentData?.getHighEntropyValues) {
      const data = await (navigator as any).userAgentData.getHighEntropyValues([
        'model',
        'platform',
        'platformVersion',
        'architecture',
        'bitness',
        'formFactors'
      ]);
      if (data && data.model && typeof data.model === 'string' && data.model.trim()) {
        const rawModel = data.model.trim();
        let recognizedName = rawModel;
        // Map Samsung model codes to marketing names
        if (/SM-S938/i.test(rawModel)) recognizedName = 'Samsung Galaxy S25 Ultra';
        else if (/SM-S936/i.test(rawModel)) recognizedName = 'Samsung Galaxy S25+';
        else if (/SM-S931/i.test(rawModel)) recognizedName = 'Samsung Galaxy S25';
        else if (/SM-S928/i.test(rawModel)) recognizedName = 'Samsung Galaxy S24 Ultra';
        else if (/SM-S926/i.test(rawModel)) recognizedName = 'Samsung Galaxy S24+';
        else if (/SM-S921/i.test(rawModel)) recognizedName = 'Samsung Galaxy S24';
        else if (/SM-S918/i.test(rawModel)) recognizedName = 'Samsung Galaxy S23 Ultra';
        else if (/SM-S916/i.test(rawModel)) recognizedName = 'Samsung Galaxy S23+';
        else if (/SM-S911/i.test(rawModel)) recognizedName = 'Samsung Galaxy S23';
        else if (/SM-S908/i.test(rawModel)) recognizedName = 'Samsung Galaxy S22 Ultra';
        else if (/SM-S901/i.test(rawModel)) recognizedName = 'Samsung Galaxy S22';
        else if (/SM-F956/i.test(rawModel)) recognizedName = 'Samsung Galaxy Z Fold 6';
        else if (/SM-F946/i.test(rawModel)) recognizedName = 'Samsung Galaxy Z Fold 5';
        else if (/SM-F741/i.test(rawModel)) recognizedName = 'Samsung Galaxy Z Flip 6';
        else if (/SM-F731/i.test(rawModel)) recognizedName = 'Samsung Galaxy Z Flip 5';
        else if (/SM-A556/i.test(rawModel)) recognizedName = 'Samsung Galaxy A55';
        else if (/SM-A546/i.test(rawModel)) recognizedName = 'Samsung Galaxy A54';
        else if (/SM-A356/i.test(rawModel)) recognizedName = 'Samsung Galaxy A35';
        else if (/SM-A346/i.test(rawModel)) recognizedName = 'Samsung Galaxy A34';
        else if (/SM-X910/i.test(rawModel)) recognizedName = 'Samsung Galaxy Tab S9 Ultra';
        else if (/SM-X810/i.test(rawModel)) recognizedName = 'Samsung Galaxy Tab S9+';
        else if (/SM-X710/i.test(rawModel)) recognizedName = 'Samsung Galaxy Tab S9';
        else if (/SM-X210/i.test(rawModel)) recognizedName = 'Samsung Galaxy Tab A9+';
        else if (/Pixel 9 Pro XL/i.test(rawModel)) recognizedName = 'Google Pixel 9 Pro XL';
        else if (/Pixel 9 Pro/i.test(rawModel)) recognizedName = 'Google Pixel 9 Pro';
        else if (/Pixel 9/i.test(rawModel)) recognizedName = 'Google Pixel 9';
        else if (/Pixel 8 Pro/i.test(rawModel)) recognizedName = 'Google Pixel 8 Pro';
        else if (/Pixel 8a/i.test(rawModel)) recognizedName = 'Google Pixel 8a';
        else if (/Pixel 8/i.test(rawModel)) recognizedName = 'Google Pixel 8';
        else if (/Pixel 7 Pro/i.test(rawModel)) recognizedName = 'Google Pixel 7 Pro';
        else if (/Pixel 7a/i.test(rawModel)) recognizedName = 'Google Pixel 7a';
        else if (/Pixel 7/i.test(rawModel)) recognizedName = 'Google Pixel 7';
        else if (/Surface Pro/i.test(rawModel)) recognizedName = rawModel;

        const isTablet = /Tab|Pad/i.test(recognizedName);
        const isPhone = /Pixel|Galaxy|SM-|Phone/i.test(recognizedName);

        return {
          name: recognizedName,
          modelDetails: recognizedName,
          deviceType: isTablet ? 'tablet' : isPhone ? 'phone' : undefined
        };
      }
    }
  } catch {}
  return null;
}

// Generate unique ID per tab/window instance that persists across refreshes to avoid duplicate ghost peers
export function getOrCreateDeviceId(): string {
  try {
    if (typeof window !== 'undefined') {
      const win = window as any;
      if (win.__peerdrop_instance_id) return win.__peerdrop_instance_id;

      // Check sessionStorage so page refreshes retain the exact same device ID
      // but new browser tabs or windows get their own unique instance ID
      const sessionSaved = sessionStorage.getItem('peerdrop_session_peer_id');
      if (sessionSaved) {
        win.__peerdrop_instance_id = sessionSaved;
        return sessionSaved;
      }

      const newId = 'peer_' + Math.random().toString(36).substring(2, 9) + '_' + Math.random().toString(36).substring(2, 6);
      win.__peerdrop_instance_id = newId;
      sessionStorage.setItem('peerdrop_session_peer_id', newId);
      return newId;
    }
  } catch {}
  return 'peer_' + Math.random().toString(36).substring(2, 9) + '_' + Math.random().toString(36).substring(2, 6);
}

// Generate unique 4-digit pairing PIN code per instance that persists across refreshes
export function generatePairCode(): string {
  try {
    if (typeof window !== 'undefined') {
      const win = window as any;
      if (win.__peerdrop_pair_code) return win.__peerdrop_pair_code;

      const sessionSaved = sessionStorage.getItem('peerdrop_session_pair_code');
      if (sessionSaved) {
        win.__peerdrop_pair_code = sessionSaved;
        return sessionSaved;
      }

      const newCode = Math.floor(1000 + Math.random() * 9000).toString();
      win.__peerdrop_pair_code = newCode;
      sessionStorage.setItem('peerdrop_session_pair_code', newCode);
      return newCode;
    }
  } catch {}
  return Math.floor(1000 + Math.random() * 9000).toString();
}

// Generate deterministic unique LAN IP for any device
export function generateDeterministicLanIp(deviceId: string): string {
  let hash = 0;
  for (let i = 0; i < deviceId.length; i++) {
    hash = (hash << 5) - hash + deviceId.charCodeAt(i);
    hash |= 0;
  }
  const hostNum = 100 + (Math.abs(hash) % 150); // 100-249
  return `192.168.1.${hostNum}`;
}

// Actively probe for real local LAN IPv4 via WebRTC ICE candidate, with deterministic fallback
export async function detectDeviceLanIp(deviceId: string): Promise<string> {
  const fallbackIp = generateDeterministicLanIp(deviceId);
  if (typeof window === 'undefined' || typeof RTCPeerConnection === 'undefined') {
    return fallbackIp;
  }

  return new Promise((resolve) => {
    try {
      const pc = new RTCPeerConnection({
        iceServers: []
      });
      pc.createDataChannel('probe_lan_ip');
      let resolved = false;

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          try { pc.close(); } catch {}
          resolve(fallbackIp);
        }
      }, 700);

      pc.onicecandidate = (event) => {
        if (!event || !event.candidate || !event.candidate.candidate) return;
        const cand = event.candidate.candidate;
        // Search for private IPv4: 192.168.x.x, 10.x.x.x, 172.16-31.x.x
        const match = cand.match(/\b(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/);
        if (match && match[1]) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            try { pc.close(); } catch {}
            resolve(match[1]);
          }
        }
      };

      pc.createOffer().then((offer) => pc.setLocalDescription(offer)).catch(() => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve(fallbackIp);
        }
      });
    } catch {
      resolve(fallbackIp);
    }
  });
}

// Sound effects using Web Audio API for auto-reception
export function playNotificationSound(type: 'completed' | 'started') {
  try {
    const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtxClass) return;
    const ctx = new AudioCtxClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'completed') {
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1); // A5
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    } else {
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    }
  } catch {
    // Ignore audio autoplay restrictions
  }
}

export type NetworkEventCallback = {
  onPeersUpdated: (peers: PeerDevice[]) => void;
  onTransferProgress: (transfer: FileTransfer) => void;
  onTransferCompleted: (transfer: FileTransfer) => void;
  onConnectionStatusChange: (status: 'connected' | 'connecting' | 'disconnected') => void;
  onRetryRequested?: (transferId: string, fromPeerId: string) => void;
};

export class PeerDropManager {
  private ws: WebSocket | null = null;
  private broadcastChannel: BroadcastChannel | null = null;
  private localPeer: PeerDevice;
  private peers: Map<string, PeerDevice> = new Map();
  private cryptoKey: CryptoKey | null = null;
  private activeRoomId: string = 'default_lan_mesh';
  private currentPassword: string = '';
  private callbacks: NetworkEventCallback;
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
  private dataChannels: Map<string, RTCDataChannel> = new Map();
  private pendingCandidates: Map<string, RTCIceCandidateInit[]> = new Map();
  private pendingTransfers: Map<string, {
    metadata: TransferChunkMetadata;
    chunks: ArrayBuffer[];
    chunksReceived: number;
    receivedBytes: number;
    startTime: number;
    lastTime: number;
    lastBytes: number;
  }> = new Map();
  private activeSends: Map<string, boolean> = new Map(); // transferId -> shouldContinue
  private lastProgressEmit: Map<string, number> = new Map(); // transferId -> timestamp for receive
  private lastSendProgressEmit: Map<string, number> = new Map(); // transferId -> timestamp for send
  private decryptionQueues: Map<string, Array<{ fromPeerId: string; meta: TransferChunkMetadata; encryptedBuffer: ArrayBuffer }>> = new Map();
  private isProcessingQueue: Map<string, boolean> = new Map();
  // Flow-control ACK tracking to prevent queue bloat and memory exhaustion on large files
  private transferAcks: Map<string, { lastAckedChunk: number; waitResolvers: Array<() => void> }> = new Map();
  private fallbackCryptoKey: CryptoKey | null = null;

  private handleTransferAck(transferId: string, chunkIndex: number) {
    const ackInfo = this.transferAcks.get(transferId);
    if (ackInfo) {
      if (chunkIndex > ackInfo.lastAckedChunk) {
        ackInfo.lastAckedChunk = chunkIndex;
      }
      const resolvers = ackInfo.waitResolvers;
      ackInfo.waitResolvers = [];
      for (const resolve of resolvers) {
        resolve();
      }
    }
  }

  private checkKeepAliveState() {
    const hasReceives = this.pendingTransfers.size > 0;
    let hasSends = false;
    for (const isActive of this.activeSends.values()) {
      if (isActive) {
        hasSends = true;
        break;
      }
    }
    if (hasReceives || hasSends) {
      deviceKeepAlive.enableKeepAlive();
    } else {
      deviceKeepAlive.disableKeepAlive();
    }
  }

  // Timers for polling and heartbeats
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private peerMissedPolls: Map<string, number> = new Map();
  private isDestroyed = false;

  constructor(initialPeer: PeerDevice, callbacks: NetworkEventCallback) {
    this.localPeer = initialPeer;
    this.callbacks = callbacks;

    // Cross-tab broadcast channel for instant multi-window local testing
    try {
      this.broadcastChannel = new BroadcastChannel('peerdrop_local_mesh');
      this.broadcastChannel.onmessage = (e) => this.handleBroadcastMessage(e.data);
    } catch {
      // BroadcastChannel unsupported fallback
    }

    // Connect WebSocket
    this.initWebSocket();

    // Start redundant HTTP polling discovery fallback
    this.startHttpPolling();

    // Setup visibility, online and fast-departure listeners
    if (typeof window !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
      window.addEventListener('focus', this.handleVisibilityChange);
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('beforeunload', this.handleBeforeUnload);
    }
  }

  private handleBeforeUnload = () => {
    try {
      const payload = JSON.stringify({ peerId: this.localPeer.id });
      if (navigator.sendBeacon) {
        const blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon('/api/peers/leave', blob);
      }
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'leave', peerId: this.localPeer.id }));
      }
    } catch {}
  };

  private handleVisibilityChange = () => {
    if (document.visibilityState === 'visible' && !this.isDestroyed) {
      this.reannounce();
    }
  };

  private handleOnline = () => {
    if (!this.isDestroyed) {
      this.reannounce();
    }
  };

  public updateLocalPeer(updates: Partial<PeerDevice>) {
    this.localPeer = { ...this.localPeer, ...updates };
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'update-peer',
        peer: this.localPeer
      }));
    }
    // Also update via HTTP
    this.joinHttpRoom();

    this.broadcastMessage({
      type: 'peer-announce',
      peer: this.localPeer,
      roomId: this.activeRoomId
    });
  }

  public async setNetwork(
    type: ConnectionType,
    ssidOrName: string,
    password: string = ''
  ) {
    this.currentPassword = password;

    // Normalize room:
    // If not a private password-protected room, join unified 'default_lan_mesh'
    // so ALL devices in the network automatically discover each other without barrier!
    const normalizedName = (ssidOrName || '').trim().toLowerCase();
    const isCustomPrivateRoom = Boolean(
      password &&
      password !== 'peerdrop-lan-secure' &&
      password !== 'wired-lan-key' &&
      password.trim().length > 0
    );

    if (isCustomPrivateRoom) {
      const rawKey = `lan_p2p::${normalizedName || 'custom'}::${password}`;
      const enc = new TextEncoder();
      const hashBuf = await window.crypto.subtle.digest('SHA-256', enc.encode(rawKey));
      const hashArr = Array.from(new Uint8Array(hashBuf));
      this.activeRoomId = 'room_' + hashArr.map(b => b.toString(16).padStart(2, '0')).slice(0, 12).join('');
    } else {
      // Unified LAN Mesh across all Wi-Fi and Ethernet clients
      this.activeRoomId = 'default_lan_mesh';
    }

    // Derive Master AES-256-GCM encryption key with unified domain salt
    this.cryptoKey = await deriveKeyFromSecret(password || 'peerdrop-lan-secure', 'peerdrop_salt_v1');
    const fingerprint = await generateFingerprint(this.cryptoKey);

    this.localPeer.connectionType = type;
    this.localPeer.networkName = ssidOrName || (type === 'wifi' ? 'Sieć Wi-Fi' : 'Kabel LAN Ethernet');
    this.localPeer.linkSpeed = type === 'wifi' ? 'Wi-Fi 6 (866 Mb/s)' : '1000 Mb/s (Gigabit LAN)';
    this.localPeer.encryptionFingerprint = fingerprint;

    // Join room over WebSocket
    this.joinWebSocketRoom();

    // Join room over HTTP REST fallback
    this.joinHttpRoom();

    // Broadcast over BroadcastChannel to other tabs
    this.broadcastMessage({
      type: 'peer-announce',
      peer: this.localPeer,
      roomId: this.activeRoomId
    });

    this.triggerPeersUpdate();
  }

  private initWebSocket() {
    if (this.isDestroyed) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.callbacks.onConnectionStatusChange('connecting');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.callbacks.onConnectionStatusChange('connected');
        this.joinWebSocketRoom();
        this.startWebSocketPing();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleServerMessage(msg);
        } catch (e) {
          console.error('Failed to parse WS message:', e);
        }
      };

      this.ws.onclose = () => {
        if (this.isDestroyed) return;
        this.stopWebSocketPing();
        // Automatic reconnection attempt
        setTimeout(() => {
          if (!this.isDestroyed) this.initWebSocket();
        }, 2000);
      };

      this.ws.onerror = () => {
        this.stopWebSocketPing();
      };
    } catch {
      // Continue with HTTP polling fallback
    }
  }

  private startWebSocketPing() {
    this.stopWebSocketPing();
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 5000);
  }

  private stopWebSocketPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private joinWebSocketRoom() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'join',
        roomId: this.activeRoomId,
        peer: this.localPeer
      }));
    }
  }

  // HTTP REST Discovery Fallback
  private async joinHttpRoom() {
    try {
      const res = await fetch('/api/peers/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: this.activeRoomId,
          peer: this.localPeer
        })
      });
      if (res.ok) {
        const data = await res.json();
        this.callbacks.onConnectionStatusChange('connected');
        if (data.assignedIp && (!this.localPeer.ip || this.localPeer.ip === '127.0.0.1' || this.localPeer.ip === 'Sprawdzanie IP...')) {
          this.localPeer.ip = data.assignedIp;
          this.triggerPeersUpdate();
        }
        if (data.peers && Array.isArray(data.peers)) {
          let updated = false;
          for (const p of data.peers) {
            if (this.upsertPeer(p)) {
              this.setupWebRTCPeer(p.id, true);
              updated = true;
            }
          }
          if (updated) this.triggerPeersUpdate();
        }
      }
    } catch {
      // Ignored
    }
  }

  private startHttpPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    // Rapid discovery interval: 1000ms for swift peer detection
    this.pollTimer = setInterval(() => this.pollHttpServer(), 1000);
    // Immediate initial join
    this.joinHttpRoom();
    // Fast initial discovery bursts (100ms, 300ms, 700ms) for near-instant peer appearance
    setTimeout(() => { if (!this.isDestroyed) this.joinHttpRoom(); }, 100);
    setTimeout(() => { if (!this.isDestroyed) this.pollHttpServer(); }, 300);
    setTimeout(() => { if (!this.isDestroyed) this.pollHttpServer(); }, 700);
  }

  private async pollHttpServer() {
    if (this.isDestroyed) return;
    try {
      const url = `/api/peers/poll?peerId=${encodeURIComponent(this.localPeer.id)}&roomId=${encodeURIComponent(this.activeRoomId)}`;
      const res = await fetch(url);
      if (!res.ok) return;

      const data = await res.json();
      if (data.status === 'not_registered') {
        // Automatically join so server knows us, but continue to process peers immediately
        this.joinHttpRoom();
      }

      this.callbacks.onConnectionStatusChange('connected');

      // Process received messages (from fallback HTTP delivery)
      if (data.messages && Array.isArray(data.messages)) {
        for (const msg of data.messages) {
          this.handleServerMessage(msg);
        }
      }

      // Sync peers list
      if (data.peers && Array.isArray(data.peers)) {
        const activeIds = new Set(data.peers.map((p: PeerDevice) => p.id));
        let changed = false;

        // Add / update new peers cleanly without duplication
        for (const p of data.peers) {
          if (this.upsertPeer(p)) {
            this.setupWebRTCPeer(p.id, true);
            changed = true;
          }
        }

        // Clean up departed peers (10 missed polls = ~10s buffer against lock/sleep/lag)
        for (const id of Array.from(this.peers.keys())) {
          if (!activeIds.has(id)) {
            const misses = (this.peerMissedPolls.get(id) || 0) + 1;
            this.peerMissedPolls.set(id, misses);
            if (misses >= 10) {
              this.removePeer(id);
              changed = true;
            }
          } else {
            this.peerMissedPolls.set(id, 0);
          }
        }

        if (changed) {
          this.triggerPeersUpdate();
        }
      }
    } catch {
      // Ignored
    }
  }

  public reannounce() {
    // If WS disconnected or closing, actively reconnect
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) {
      this.initWebSocket();
    } else if (this.ws.readyState === WebSocket.OPEN) {
      this.joinWebSocketRoom();
    }

    this.joinHttpRoom();
    this.broadcastMessage({
      type: 'peer-announce',
      peer: this.localPeer,
      roomId: this.activeRoomId
    });
    this.pollHttpServer();
    setTimeout(() => { if (!this.isDestroyed) this.pollHttpServer(); }, 300);
  }

  private handleServerMessage(msg: Record<string, any>) {
    if (msg.type === 'welcome') {
      // Retain unique local LAN IP; never overwrite with router WAN IP
      if (!this.localPeer.ip || this.localPeer.ip === '127.0.0.1' || this.localPeer.ip === 'Sprawdzanie IP...') {
        this.localPeer.ip = generateDeterministicLanIp(this.localPeer.id);
        this.triggerPeersUpdate();
      }
    } else if (msg.type === 'room-peers') {
      const peersList: PeerDevice[] = msg.peers || [];
      for (const p of peersList) {
        if (this.upsertPeer(p)) {
          this.setupWebRTCPeer(p.id, true);
        }
      }
      this.triggerPeersUpdate();
    } else if (msg.type === 'peer-joined') {
      const p: PeerDevice = msg.peer;
      if (p && this.upsertPeer(p)) {
        this.setupWebRTCPeer(p.id, false);
        this.triggerPeersUpdate();
      }
    } else if (msg.type === 'peer-updated') {
      const p: PeerDevice = msg.peer;
      if (p && this.upsertPeer(p)) {
        this.triggerPeersUpdate();
      }
    } else if (msg.type === 'peer-left') {
      if (msg.peerId) {
        this.removePeer(msg.peerId);
        this.triggerPeersUpdate();
      }
    } else if (msg.type === 'signal') {
      if (msg.data?.type === 'transfer-ack' && msg.data?.transferId) {
        this.handleTransferAck(msg.data.transferId, msg.data.chunkIndex);
      } else {
        this.handleSignal(msg.fromPeerId, msg.data);
      }
    } else if (msg.type === 'relay-chunk') {
      this.handleIncomingChunk(msg.fromPeerId, msg.meta, msg.data);
    } else if (msg.type === 'transfer-control') {
      if (msg.action === 'request-retry' && msg.transferId) {
        this.callbacks.onRetryRequested?.(msg.transferId, msg.fromPeerId);
      }
    } else if (msg.type === 'pair-success') {
      if (msg.peer && msg.peer.id) {
        if (this.upsertPeer(msg.peer)) {
          this.setupWebRTCPeer(msg.peer.id, true);
        }
        this.triggerPeersUpdate();
      }
      if (msg.roomId) {
        this.activeRoomId = msg.roomId;
      }
    }
  }

  private broadcastMessage(data: Record<string, any>) {
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage(data);
      } catch {
        // Ignored
      }
    }
  }

  private handleBroadcastMessage(data: Record<string, any>) {
    if (!data) return;

    if (data.type === 'peer-announce') {
      const p: PeerDevice = data.peer;
      if (p && this.upsertPeer(p)) {
        this.triggerPeersUpdate();
        // Reply so sender discovers us too
        if (data.reply !== false) {
          this.broadcastMessage({
            type: 'peer-announce',
            peer: this.localPeer,
            roomId: this.activeRoomId,
            reply: false
          });
        }
      }
    } else if (data.type === 'broadcast-chunk' && data.toPeerId === this.localPeer.id) {
      this.handleIncomingChunk(data.fromPeerId, data.meta, data.data);
    } else if (data.type === 'transfer-ack' && data.toPeerId === this.localPeer.id) {
      this.handleTransferAck(data.transferId, data.chunkIndex);
    } else if (data.type === 'transfer-control' && data.toPeerId === this.localPeer.id) {
      if (data.action === 'request-retry' && data.transferId) {
        this.callbacks.onRetryRequested?.(data.transferId, data.fromPeerId);
      }
    }
  }

  // WebRTC P2P direct DataChannel setup for maximum LAN throughput
  private async setupWebRTCPeer(peerId: string, _isInitiatorHint?: boolean) {
    if (this.peerConnections.has(peerId)) return;

    try {
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:stun.cloudflare.com:3478' }
        ]
      });

      this.peerConnections.set(peerId, pc);

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          this.sendSignal(peerId, { candidate: event.candidate });
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'failed') {
          try {
            pc.restartIce();
          } catch {}
        }
      };

      // Deterministic collision-free initiator rule (Perfect Negotiation pattern)
      // Only the peer with greater ID creates the offer and DataChannel
      const shouldInitiate = this.localPeer.id > peerId;

      if (shouldInitiate) {
        const dc = pc.createDataChannel('peerdrop_transfer', {
          ordered: true,
        });
        this.setupDataChannel(peerId, dc);

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this.sendSignal(peerId, { sdp: pc.localDescription });
      } else {
        pc.ondatachannel = (event) => {
          this.setupDataChannel(peerId, event.channel);
        };
      }
    } catch (err) {
      console.warn('WebRTC init fallback to WebSocket/HTTP:', err);
    }
  }

  private sendSignal(toPeerId: string, data: Record<string, any>) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'signal',
        toPeerId,
        data
      }));
    } else {
      // HTTP REST signal fallback
      fetch('/api/peers/signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromPeerId: this.localPeer.id,
          toPeerId,
          data
        })
      }).catch(() => {});
    }
  }

  private setupDataChannel(peerId: string, dc: RTCDataChannel) {
    dc.binaryType = 'arraybuffer';
    dc.bufferedAmountLowThreshold = 128 * 1024; // 128 KB low threshold for smooth backpressure

    dc.onopen = () => {
      this.dataChannels.set(peerId, dc);
    };

    dc.onclose = () => {
      this.dataChannels.delete(peerId);
    };

    dc.onerror = (err) => {
      console.warn('WebRTC DataChannel error with peer', peerId, err);
    };

    dc.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const parsed = JSON.parse(event.data);
          if (parsed.type === 'chunk-meta') {
            this.handleIncomingChunk(peerId, parsed.meta, parsed.data);
          } else if (parsed.type === 'transfer-ack' && parsed.transferId) {
            this.handleTransferAck(parsed.transferId, parsed.chunkIndex);
          }
        } catch {
          // Ignore
        }
      } else if (event.data instanceof ArrayBuffer) {
        this.parseBinaryChunk(peerId, event.data);
      }
    };
  }

  private parseBinaryChunk(peerId: string, buffer: ArrayBuffer) {
    try {
      const view = new DataView(buffer);
      const headerLength = view.getUint16(0);
      const headerBytes = new Uint8Array(buffer, 2, headerLength);
      const headerText = new TextDecoder().decode(headerBytes);
      const meta: TransferChunkMetadata = JSON.parse(headerText);
      const encryptedData = buffer.slice(2 + headerLength);

      this.enqueueChunkDecryption(peerId, meta, encryptedData);
    } catch (e) {
      console.error('Error parsing binary chunk:', e);
    }
  }

  private async handleSignal(fromPeerId: string, data: Record<string, any>) {
    let pc = this.peerConnections.get(fromPeerId);
    if (!pc) {
      await this.setupWebRTCPeer(fromPeerId, false);
      pc = this.peerConnections.get(fromPeerId);
    }
    if (!pc) return;

    try {
      if (data.sdp) {
        // Rollback handling if glare/collision occurs
        if (data.sdp.type === 'offer' && pc.signalingState !== 'stable') {
          if (this.localPeer.id < fromPeerId) {
            // Polite peer accepts offer and rolls back local offer
            try {
              await pc.setLocalDescription({ type: 'rollback' } as any);
            } catch {}
            await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            this.sendSignal(fromPeerId, { sdp: pc.localDescription });
            return;
          } else {
            // Impolite peer ignores colliding offer
            return;
          }
        }

        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));

        // Flush any ICE candidates received before remoteDescription was set
        const queued = this.pendingCandidates.get(fromPeerId) || [];
        for (const cand of queued) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(cand));
          } catch {
            // Ignore
          }
        }
        this.pendingCandidates.delete(fromPeerId);

        if (data.sdp.type === 'offer') {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          this.sendSignal(fromPeerId, { sdp: pc.localDescription });
        }
      } else if (data.candidate) {
        if (pc.remoteDescription && pc.remoteDescription.type) {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } else {
          // Buffer candidate until remote description arrives
          const list = this.pendingCandidates.get(fromPeerId) || [];
          list.push(data.candidate);
          this.pendingCandidates.set(fromPeerId, list);
        }
      }
    } catch (err) {
      console.warn('WebRTC signal handling failed:', err);
    }
  }

  private cleanupWebRTCPeer(peerId: string) {
    const dc = this.dataChannels.get(peerId);
    if (dc) {
      dc.close();
      this.dataChannels.delete(peerId);
    }
    const pc = this.peerConnections.get(peerId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(peerId);
    }
    this.pendingCandidates.delete(peerId);
  }

  // Handle incoming chunk from peer (via WebRTC, WebSocket or HTTP fallback)
  private handleIncomingChunk(
    fromPeerId: string,
    meta: TransferChunkMetadata,
    dataOrBase64: string | ArrayBuffer
  ) {
    let encryptedBuffer: ArrayBuffer;
    if (typeof dataOrBase64 === 'string') {
      const u8 = base64ToUint8Array(dataOrBase64);
      encryptedBuffer = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
    } else {
      encryptedBuffer = dataOrBase64;
    }
    this.enqueueChunkDecryption(fromPeerId, meta, encryptedBuffer);
  }

  // Queue incoming chunks to prevent spawning thousands of simultaneous crypto operations
  // which freeze the browser event loop and cause WebRTC ICE / heartbeat dropouts on large files
  private enqueueChunkDecryption(
    fromPeerId: string,
    meta: TransferChunkMetadata,
    encryptedBuffer: ArrayBuffer
  ) {
    let queue = this.decryptionQueues.get(meta.transferId);
    if (!queue) {
      queue = [];
      this.decryptionQueues.set(meta.transferId, queue);
    }
    queue.push({ fromPeerId, meta, encryptedBuffer });

    if (!this.isProcessingQueue.get(meta.transferId)) {
      this.drainDecryptionQueue(meta.transferId);
    }
  }

  private async drainDecryptionQueue(transferId: string) {
    this.isProcessingQueue.set(transferId, true);
    const queue = this.decryptionQueues.get(transferId);
    if (!queue) {
      this.isProcessingQueue.set(transferId, false);
      return;
    }

    let processedCount = 0;
    while (queue.length > 0) {
      const item = queue.shift()!;
      await this.decryptSingleChunk(item.fromPeerId, item.meta, item.encryptedBuffer);
      processedCount++;

      // Micro-yield to browser event loop every 4 chunks to keep UI silky smooth at 60 FPS
      // and ensure WebRTC ICE keepalives / SCTP stack never starve!
      if (processedCount % 4 === 0) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    this.isProcessingQueue.set(transferId, false);
  }

  private async decryptSingleChunk(
    fromPeerId: string,
    meta: TransferChunkMetadata,
    encryptedBuffer: ArrayBuffer
  ) {
    if (!this.cryptoKey) {
      this.cryptoKey = await deriveKeyFromSecret(this.currentPassword || 'peerdrop-lan-secure', 'peerdrop_salt_v1');
    }

    const { transferId, fileName, fileSize, fileType, totalChunks, chunkIndex, iv } = meta;

    let pending = this.pendingTransfers.get(transferId);
    const now = performance.now();

    if (!pending) {
      // First chunk arrived!
      playNotificationSound('started');
      pending = {
        metadata: meta,
        chunks: new Array(totalChunks),
        chunksReceived: 0,
        receivedBytes: 0,
        startTime: now,
        lastTime: now,
        lastBytes: 0
      };
      this.pendingTransfers.set(transferId, pending);
      this.checkKeepAliveState();
    } else if (pending.chunks[chunkIndex] !== undefined) {
      // Duplicate chunk from multi-channel relay (BroadcastChannel + WebSocket), ignore
      return;
    }

    // Decrypt AES-256-GCM chunk
    try {
      const ivBytes = base64ToUint8Array(iv);
      let decrypted: ArrayBuffer;
      try {
        decrypted = await decryptChunk(encryptedBuffer, this.cryptoKey, ivBytes);
      } catch {
        // Fallback key attempt using default network passphrase
        if (!this.fallbackCryptoKey) {
          this.fallbackCryptoKey = await deriveKeyFromSecret('peerdrop-lan-secure', 'peerdrop_salt_v1');
        }
        decrypted = await decryptChunk(encryptedBuffer, this.fallbackCryptoKey, ivBytes);
      }

      pending.chunks[chunkIndex] = decrypted;
      pending.chunksReceived += 1;
      pending.receivedBytes += decrypted.byteLength;

      const isCompleted = pending.chunksReceived >= totalChunks;

      // Send flow-control ACK back to sender to release in-flight window and prevent queue buildup
      if (pending.chunksReceived % 16 === 0 || isCompleted) {
        const ackPayload = {
          type: 'transfer-ack',
          transferId,
          chunkIndex
        };
        const dc = this.dataChannels.get(fromPeerId);
        if (dc && dc.readyState === 'open') {
          try {
            dc.send(JSON.stringify(ackPayload));
          } catch {}
        } else if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({
            type: 'signal',
            toPeerId: fromPeerId,
            data: ackPayload
          }));
        } else {
          this.broadcastMessage({
            ...ackPayload,
            toPeerId: fromPeerId,
            fromPeerId: this.localPeer.id
          });
        }
      }

      // Calculate speed and ETA
      const elapsedTotalSec = (now - pending.startTime) / 1000;
      const avgSpeed = elapsedTotalSec > 0 ? pending.receivedBytes / elapsedTotalSec : 0;
      
      const timeDiff = (now - pending.lastTime) / 1000;
      let instantSpeed = avgSpeed;
      if (timeDiff >= 0.15) {
        instantSpeed = (pending.receivedBytes - pending.lastBytes) / timeDiff;
        pending.lastTime = now;
        pending.lastBytes = pending.receivedBytes;
      }

      const progress = fileSize > 0
        ? Math.min(100, Math.round((pending.receivedBytes / fileSize) * 100))
        : 100;
      const remainingBytes = Math.max(0, fileSize - pending.receivedBytes);
      const etaSeconds = instantSpeed > 1000 ? Math.ceil(remainingBytes / instantSpeed) : 0;

      const peer = this.peers.get(fromPeerId) || {
        name: meta.senderName || 'Urządzenie zdalne',
        deviceType: meta.senderDeviceType || 'laptop'
      };

      const transferUpdate: FileTransfer = {
        id: transferId,
        fileName,
        fileSize,
        fileType,
        direction: 'receive',
        peerId: fromPeerId,
        peerName: peer.name,
        peerDeviceType: peer.deviceType,
        status: isCompleted ? 'completed' : 'transferring',
        progress: isCompleted ? 100 : progress,
        bytesTransferred: pending.receivedBytes,
        currentSpeed: instantSpeed,
        peakSpeed: instantSpeed,
        avgSpeed,
        startTime: pending.startTime,
        etaSeconds,
        isAutoAccepted: true,
        chunksTotal: totalChunks,
        chunksCompleted: pending.chunksReceived,
        lastActivityTime: Date.now(),
        isStalled: false,
        isLink: meta.isLink,
        linkUrl: meta.linkUrl,
        linkTitle: meta.linkTitle
      };

      // Emit progress smoothly to prevent React thread freezing
      const nowPerf = performance.now();
      const lastEmit = this.lastProgressEmit.get(transferId) || 0;
      if (isCompleted || nowPerf - lastEmit >= 75) {
        this.lastProgressEmit.set(transferId, nowPerf);
        this.callbacks.onTransferProgress(transferUpdate);
      }

      // Verify completion
      if (isCompleted) {
        const completeBlob = new Blob(pending.chunks, { type: fileType || 'application/octet-stream' });
        // Immediately free chunks array to release large memory allocation
        pending.chunks = [];
        this.decryptionQueues.delete(transferId);
        this.isProcessingQueue.delete(transferId);

        const blobUrl = URL.createObjectURL(completeBlob);

        transferUpdate.status = 'completed';
        transferUpdate.progress = 100;
        transferUpdate.blobUrl = blobUrl;
        transferUpdate.blob = completeBlob;
        transferUpdate.endTime = Date.now();

        playNotificationSound('completed');
        this.callbacks.onTransferCompleted(transferUpdate);
        this.pendingTransfers.delete(transferId);
        this.checkKeepAliveState();
      }
    } catch (err) {
      console.error('Decryption failed for chunk:', err);
    }
  }

  // Send file to peer (supports files, folders, and web links)
  public async sendFile(
    peerId: string,
    file: File,
    onProgress: (transfer: FileTransfer) => void,
    customTransferId?: string,
    linkMeta?: { isLink?: boolean; linkUrl?: string; linkTitle?: string }
  ) {
    if (!this.cryptoKey) {
      this.cryptoKey = await deriveKeyFromSecret(this.currentPassword || 'peerdrop-lan-secure', 'peerdrop_salt_v1');
    }

    const transferId = customTransferId || ('xfer_' + Math.random().toString(36).substring(2, 9));
    const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
    const peer = this.peers.get(peerId);
    const peerName = peer?.name || (peerId === this.localPeer.id ? 'To Urządzenie (Lokalny Test)' : 'Urządzenie zdalne');
    const peerType = peer?.deviceType || 'laptop';

    const isLink = Boolean(linkMeta?.isLink || (file as any).isLink);
    const linkUrl = linkMeta?.linkUrl || (file as any).linkUrl || undefined;
    const linkTitle = linkMeta?.linkTitle || (file as any).linkTitle || undefined;

    let bytesSent = 0;
    const startTime = performance.now();
    let lastTime = startTime;
    let lastBytes = 0;
    let peakSpeed = 0;

    this.activeSends.set(transferId, true);
    const ackInfo = { lastAckedChunk: -1, waitResolvers: [] as Array<() => void> };
    this.transferAcks.set(transferId, ackInfo);
    this.checkKeepAliveState();

    const initialTransfer: FileTransfer = {
      id: transferId,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      direction: 'send',
      peerId,
      peerName,
      peerDeviceType: peerType,
      status: 'transferring',
      progress: 0,
      bytesTransferred: 0,
      currentSpeed: 0,
      peakSpeed: 0,
      avgSpeed: 0,
      startTime,
      etaSeconds: 0,
      isAutoAccepted: true,
      chunksTotal: totalChunks,
      chunksCompleted: 0,
      lastActivityTime: Date.now(),
      isStalled: false,
      isLink,
      linkUrl,
      linkTitle
    };
    onProgress(initialTransfer);

    // If DataChannel is still connecting, wait briefly up to 1200ms for it to become ready
    let dataChannel = this.dataChannels.get(peerId);
    if (dataChannel && dataChannel.readyState === 'connecting') {
      await new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (dataChannel?.readyState === 'open' || dataChannel?.readyState === 'closed') {
            done();
          }
        }, 30);
        const timeout = setTimeout(done, 1200);
        function done() {
          clearInterval(interval);
          clearTimeout(timeout);
          resolve();
        }
      });
    }

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      if (!this.activeSends.get(transferId)) {
        initialTransfer.status = 'cancelled';
        onProgress(initialTransfer);
        return;
      }

      // Windowed receiver backpressure: ensure sender doesn't outpace receiver decryption speed (~1.9 MB in-flight window)
      const WINDOW_CHUNKS = 40;
      while (chunkIndex - ackInfo.lastAckedChunk > WINDOW_CHUNKS && this.activeSends.get(transferId)) {
        initialTransfer.lastActivityTime = Date.now();
        await new Promise<void>((resolve) => {
          ackInfo.waitResolvers.push(resolve);
          setTimeout(resolve, 80);
        });
      }

      const start = chunkIndex * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const slice = file.slice(start, end);
      const rawChunk = await slice.arrayBuffer();

      // Encrypt with AES-256-GCM
      const { encrypted, iv } = await encryptChunk(rawChunk, this.cryptoKey);
      const ivBase64 = bufferToBase64(iv);

      const meta: TransferChunkMetadata = {
        transferId,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        totalChunks,
        chunkIndex,
        chunkSize: rawChunk.byteLength,
        iv: ivBase64,
        senderName: this.localPeer.name,
        senderDeviceType: this.localPeer.deviceType,
        autoReceive: this.localPeer.autoReceive,
        isLink,
        linkUrl,
        linkTitle
      };

      // Loopback test if sending to self
      if (peerId === this.localPeer.id) {
        this.enqueueChunkDecryption(this.localPeer.id, meta, encrypted);
      } else {
        let sentViaWebRTC = false;
        // Dynamically get the latest active dataChannel instance so reconnections work mid-transfer
        let dc = this.dataChannels.get(peerId);

        // If dataChannel is closed or absent, attempt quick reconnect check
        if (!dc || dc.readyState !== 'open') {
          const peer = this.peers.get(peerId);
          if (peer) {
            this.setupWebRTCPeer(peerId, true);
          }
          // Brief wait for channel readiness
          const waitStart = Date.now();
          while (Date.now() - waitStart < 800) {
            dc = this.dataChannels.get(peerId);
            if (dc && dc.readyState === 'open') break;
            await new Promise((r) => setTimeout(r, 40));
          }
        }

        if (dc && dc.readyState === 'open') {
          const activeDataChannel = dc;
          try {
            // Adaptive flow control & backpressure: wait until channel buffer drains to safe level
            const MAX_BUFFER = 512 * 1024; // 512 KB ceiling
            const LOW_WATERMARK = 128 * 1024; // 128 KB low watermark

            while (activeDataChannel.bufferedAmount > MAX_BUFFER && activeDataChannel.readyState === 'open') {
              if (!this.activeSends.get(transferId)) {
                initialTransfer.status = 'cancelled';
                onProgress(initialTransfer);
                return;
              }

              // Update lastActivityTime to prevent false stall detection while safely waiting for network drain
              initialTransfer.lastActivityTime = Date.now();

              await new Promise<void>((resolve) => {
                let resolved = false;
                const finish = () => {
                  if (resolved) return;
                  resolved = true;
                  clearInterval(pollInterval);
                  activeDataChannel.removeEventListener('bufferedamountlow', finish);
                  resolve();
                };
                activeDataChannel.addEventListener('bufferedamountlow', finish, { once: true });
                const pollInterval = setInterval(() => {
                  if (activeDataChannel.bufferedAmount <= LOW_WATERMARK || activeDataChannel.readyState !== 'open') {
                    finish();
                  }
                }, 10);
                setTimeout(finish, 50);
              });
            }

            if (!this.activeSends.get(transferId)) {
              initialTransfer.status = 'cancelled';
              onProgress(initialTransfer);
              return;
            }

            const headerJson = JSON.stringify(meta);
            const headerBytes = new TextEncoder().encode(headerJson);
            const frameBuffer = new ArrayBuffer(2 + headerBytes.byteLength + encrypted.byteLength);
            const view = new DataView(frameBuffer);
            view.setUint16(0, headerBytes.byteLength);
            new Uint8Array(frameBuffer, 2, headerBytes.byteLength).set(headerBytes);
            new Uint8Array(frameBuffer, 2 + headerBytes.byteLength).set(new Uint8Array(encrypted));

            dc.send(frameBuffer);
            sentViaWebRTC = true;

            // Micro-yield periodically to prevent starving the browser event loop on fast transfers
            if (chunkIndex % 4 === 0) {
              await new Promise((r) => setTimeout(r, 0));
            }
          } catch (dcErr) {
            console.warn('WebRTC dataChannel.send failed, falling back to relay:', dcErr);
            sentViaWebRTC = false;
          }
        }

        if (!sentViaWebRTC) {
          const base64Data = bufferToBase64(encrypted);

          // 1. Instant cross-tab broadcast via BroadcastChannel
          this.broadcastMessage({
            type: 'broadcast-chunk',
            toPeerId: peerId,
            fromPeerId: this.localPeer.id,
            data: base64Data,
            meta
          });

          // 2. Relay via WebSocket for network clients
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            if (this.ws.bufferedAmount && this.ws.bufferedAmount > 256 * 1024) {
              await new Promise((r) => setTimeout(r, 20));
            }
            this.ws.send(JSON.stringify({
              type: 'relay-chunk',
              toPeerId: peerId,
              transferId,
              chunkIndex,
              totalChunks,
              data: base64Data,
              meta
            }));
            if (chunkIndex % 2 === 0) {
              await new Promise((r) => setTimeout(r, 4));
            }
          } else {
            // 3. Fallback to HTTP REST relay with timeout guard against network hangs
            const abortCtrl = new AbortController();
            const fetchTimer = setTimeout(() => abortCtrl.abort(), 3500);
            await fetch('/api/peers/relay', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              signal: abortCtrl.signal,
              body: JSON.stringify({
                fromPeerId: this.localPeer.id,
                toPeerId: peerId,
                transferId,
                chunkIndex,
                totalChunks,
                data: base64Data,
                meta
              })
            }).catch(() => {}).finally(() => clearTimeout(fetchTimer));
            await new Promise((r) => setTimeout(r, 8));
          }
        }
      }

      bytesSent += rawChunk.byteLength;
      const now = performance.now();
      const elapsedTotalSec = (now - startTime) / 1000;
      const avgSpeed = elapsedTotalSec > 0 ? bytesSent / elapsedTotalSec : 0;

      const timeDiff = (now - lastTime) / 1000;
      let instantSpeed = avgSpeed;
      if (timeDiff >= 0.15) {
        instantSpeed = (bytesSent - lastBytes) / timeDiff;
        lastTime = now;
        lastBytes = bytesSent;
      }
      if (instantSpeed > peakSpeed) peakSpeed = instantSpeed;

      const progress = file.size > 0
        ? Math.min(100, Math.round((bytesSent / file.size) * 100))
        : 100;
      const remainingBytes = Math.max(0, file.size - bytesSent);
      const etaSeconds = instantSpeed > 1000 ? Math.ceil(remainingBytes / instantSpeed) : 0;

      const transferUpdate: FileTransfer = {
        ...initialTransfer,
        progress,
        bytesTransferred: bytesSent,
        currentSpeed: instantSpeed,
        peakSpeed,
        avgSpeed,
        etaSeconds,
        chunksCompleted: chunkIndex + 1,
        status: progress >= 100 ? 'completed' : 'transferring',
        lastActivityTime: Date.now(),
        isStalled: false
      };

      // Throttle UI update emission to keep animation and rendering smooth
      const nowPerf = performance.now();
      const lastEmit = this.lastSendProgressEmit.get(transferId) || 0;
      if (chunkIndex === totalChunks - 1 || nowPerf - lastEmit >= 75) {
        this.lastSendProgressEmit.set(transferId, nowPerf);
        onProgress(transferUpdate);
      }
    }

    initialTransfer.status = 'completed';
    initialTransfer.progress = 100;
    initialTransfer.endTime = Date.now();
    playNotificationSound('completed');
    this.callbacks.onTransferCompleted(initialTransfer);
    this.activeSends.delete(transferId);
    this.transferAcks.delete(transferId);
    this.lastSendProgressEmit.delete(transferId);
    this.checkKeepAliveState();
  }

  // Send web link / URL directly to peer
  public async sendLink(
    peerId: string,
    url: string,
    title?: string,
    onProgress?: (transfer: FileTransfer) => void,
    customTransferId?: string
  ) {
    let cleanUrl = url.trim();
    if (!/^https?:\/\//i.test(cleanUrl) && !/^[a-z]+:\/\//i.test(cleanUrl)) {
      cleanUrl = 'https://' + cleanUrl;
    }
    const cleanTitle = (title && title.trim()) || cleanUrl;
    const content = `[InternetShortcut]\r\nURL=${cleanUrl}\r\n`;
    const blob = new Blob([content], { type: 'text/uri-list' });
    const safeName = (title && title.trim() ? title.trim() : 'Link').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || 'Link';
    const file = new File([blob], `${safeName}.url`, { type: 'text/uri-list' });
    (file as any).isLink = true;
    (file as any).linkUrl = cleanUrl;
    (file as any).linkTitle = cleanTitle;

    return this.sendFile(
      peerId,
      file,
      onProgress || (() => {}),
      customTransferId,
      { isLink: true, linkUrl: cleanUrl, linkTitle: cleanTitle }
    );
  }

  public cancelTransfer(transferId: string) {
    this.activeSends.set(transferId, false);
    this.pendingTransfers.delete(transferId);
    this.decryptionQueues.delete(transferId);
    this.isProcessingQueue.delete(transferId);
    this.lastSendProgressEmit.delete(transferId);
    this.lastProgressEmit.delete(transferId);
    const ackInfo = this.transferAcks.get(transferId);
    if (ackInfo) {
      for (const res of ackInfo.waitResolvers) res();
      this.transferAcks.delete(transferId);
    }
    this.checkKeepAliveState();
  }

  // Re-establish WebRTC peer connection and signal renegotiation if transfer gets stuck
  public async reconnectPeer(peerId: string) {
    this.cleanupWebRTCPeer(peerId);
    this.pendingCandidates.delete(peerId);

    // Re-announce & re-init WebSocket if closed
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'update-peer',
        peer: this.localPeer
      }));
    } else {
      this.initWebSocket();
    }

    this.joinHttpRoom();
    this.broadcastMessage({
      type: 'peer-announce',
      peer: this.localPeer,
      roomId: this.activeRoomId
    });

    await this.setupWebRTCPeer(peerId, true);
  }

  // Request peer to re-transmit a stalled transfer
  public requestTransferRetry(transferId: string, peerId: string) {
    this.pendingTransfers.delete(transferId);
    this.decryptionQueues.delete(transferId);
    this.isProcessingQueue.delete(transferId);
    this.lastProgressEmit.delete(transferId);

    const payload = {
      type: 'transfer-control',
      action: 'request-retry',
      transferId,
      toPeerId: peerId,
      fromPeerId: this.localPeer.id
    };

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    } else {
      fetch('/api/peers/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(() => {});
    }

    this.broadcastMessage(payload);
    this.reconnectPeer(peerId);
  }

  // Cross-network pairing by 4-digit PIN code
  public async pairByCode(code: string): Promise<boolean> {
    const cleanCode = code.trim();
    if (!cleanCode) return false;

    // 1. Send via WebSocket if connected
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'pair-by-code',
        code: cleanCode
      }));
    }

    // 2. Call REST fallback endpoint
    try {
      const res = await fetch('/api/peers/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromPeerId: this.localPeer.id,
          pairCode: cleanCode
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'ok' && data.matchedPeer) {
          if (this.upsertPeer(data.matchedPeer)) {
            this.setupWebRTCPeer(data.matchedPeer.id, true);
          }
          this.triggerPeersUpdate();
          if (data.roomId) {
            this.activeRoomId = data.roomId;
          }
          return true;
        }
      }
    } catch {
      // Ignored
    }
    return false;
  }

  private isSelfPeer(p: PeerDevice): boolean {
    if (!p) return true;
    return p.id === this.localPeer.id;
  }

  private upsertPeer(p: PeerDevice): boolean {
    if (!p || !p.id) return false;
    // Never add self as a remote peer
    if (this.isSelfPeer(p)) return false;

    const existing = this.peers.get(p.id);
    this.peers.set(p.id, { ...existing, ...p });
    return true;
  }

  private removePeer(peerId: string) {
    this.peers.delete(peerId);
    this.peerMissedPolls.delete(peerId);
    this.cleanupWebRTCPeer(peerId);
  }

  private triggerPeersUpdate() {
    const deduplicated: PeerDevice[] = [];
    const seen = new Set<string>();

    for (const p of this.peers.values()) {
      if (this.isSelfPeer(p)) continue;
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      deduplicated.push(p);
    }

    this.callbacks.onPeersUpdated(deduplicated);
  }

  public destroy() {
    this.isDestroyed = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.stopWebSocketPing();

    if (typeof window !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('beforeunload', this.handleBeforeUnload);
      window.removeEventListener('pagehide', this.handleBeforeUnload);
    }

    // Inform server
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/peers/leave', JSON.stringify({ peerId: this.localPeer.id }));
      }
    } catch {
      // Ignored
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.broadcastChannel) {
      this.broadcastChannel.close();
    }
    for (const pc of this.peerConnections.values()) {
      pc.close();
    }
    this.peerConnections.clear();
    this.dataChannels.clear();
  }
}

