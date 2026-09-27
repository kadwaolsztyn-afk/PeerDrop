export type DeviceType = 'laptop' | 'desktop' | 'phone' | 'tablet' | 'server';
export type ConnectionType = 'wifi' | 'ethernet';
export type ReceiveSaveMode = 'prompt' | 'save_as' | 'auto_downloads';

export interface PeerDevice {
  id: string;
  name: string;
  deviceType: DeviceType;
  os: string;
  browser?: string;
  modelDetails?: string;
  screenResolution?: string;
  cpuCores?: number;
  ip: string;
  connectionType: ConnectionType;
  networkName: string;
  linkSpeed: string; // e.g. "866 Mb/s" or "1000 Mb/s (Gigabit)"
  signalStrength?: number; // 1-100 (for wifi)
  ping: number; // in ms
  isSelf?: boolean;
  autoReceive: boolean;
  receiveSaveMode?: ReceiveSaveMode;
  encryptionFingerprint: string;
  pairCode?: string;
  lastSeen: number;
}

export interface NetworkProfile {
  type: ConnectionType;
  ssid: string;
  password?: string;
  channel?: string;
  frequency?: string;
  security: string;
  ipRange: string;
  gateway: string;
}

export interface FileTransfer {
  id: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  direction: 'send' | 'receive';
  peerId: string;
  peerName: string;
  peerDeviceType: DeviceType;
  status: 'pending' | 'encrypting' | 'transferring' | 'decrypting' | 'completed' | 'cancelled' | 'error';
  progress: number; // 0 - 100
  bytesTransferred: number;
  currentSpeed: number; // bytes/sec
  peakSpeed: number; // bytes/sec
  avgSpeed: number; // bytes/sec
  startTime: number;
  endTime?: number;
  etaSeconds: number;
  error?: string;
  blobUrl?: string;
  blob?: Blob;
  fileChecksum?: string;
  isAutoAccepted: boolean;
  chunksTotal: number;
  chunksCompleted: number;
  savedLocation?: string;
  isStalled?: boolean;
  lastActivityTime?: number;
  isLink?: boolean;
  linkUrl?: string;
  linkTitle?: string;
}

export interface TransferChunkMetadata {
  transferId: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  totalChunks: number;
  chunkIndex: number;
  chunkSize: number;
  iv: string; // base64 encoded IV for AES-GCM
  checksum?: string;
  senderName: string;
  senderDeviceType: DeviceType;
  autoReceive: boolean;
  isLink?: boolean;
  linkUrl?: string;
  linkTitle?: string;
}

export interface NetworkStats {
  bytesSent: number;
  bytesReceived: number;
  activeTransfers: number;
  completedTransfers: number;
  peakSpeed: number;
}
