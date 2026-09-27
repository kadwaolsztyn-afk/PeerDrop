// Prevent tsx's global __dirname = "." from breaking vite-plugin-pwa module resolution
delete (globalThis as any).__dirname;

import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

// Attach clean HTTP Upgrade listener specifically for /ws to avoid any conflict with Vite middlewares
server.on('upgrade', (request, socket, head) => {
  const url = request.url || '';
  if (url.startsWith('/ws')) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  }
});

interface PeerMetadata {
  id: string;
  name: string;
  deviceType: 'laptop' | 'desktop' | 'phone' | 'tablet' | 'server';
  os: string;
  connectionType: 'wifi' | 'ethernet';
  networkName: string;
  ip: string;
  linkSpeed?: string;
  ping?: number;
  autoReceive: boolean;
  encryptionFingerprint?: string;
  pairCode?: string;
  lastSeen?: number;
  joinedAt?: number;
}

interface PeerEntry {
  peer: PeerMetadata;
  roomId: string;
  ws?: WebSocket | null;
  lastSeen: number;
  pendingMessages: any[];
}

// Global active peers registry (shared across WebSocket and HTTP polling)
const registry = new Map<string, PeerEntry>();

// Helper: Extract real client IP from incoming request
function getClientIp(req: http.IncomingMessage | express.Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  let ip = typeof forwarded === 'string'
    ? forwarded.split(',')[0].trim()
    : ((req.socket && req.socket.remoteAddress) || '127.0.0.1');
  if (ip.startsWith('::ffff:')) {
    ip = ip.replace('::ffff:', '');
  }
  return ip;
}

// Get host network info (local IP addresses)
function getLocalNetworkInfo() {
  const interfaces = os.networkInterfaces();
  const addresses: { iface: string; ip: string; type: string }[] = [];

  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push({
          iface: name,
          ip: net.address,
          type: name.toLowerCase().includes('wl') || name.toLowerCase().includes('wi') ? 'wifi' : 'ethernet'
        });
      }
    }
  }
  return addresses;
}

// Deliver message to peer via WebSocket if available, else queue for HTTP poll
function deliverMessage(toPeerId: string, message: any) {
  const entry = registry.get(toPeerId);
  if (!entry) return;

  if (entry.ws && entry.ws.readyState === WebSocket.OPEN) {
    try {
      entry.ws.send(JSON.stringify(message));
      return;
    } catch {
      // Failed to send via ws, queue it
    }
  }

  // Queue message for HTTP polling
  entry.pendingMessages.push(message);
  if (entry.pendingMessages.length > 3000) {
    entry.pendingMessages.shift(); // keep queue bounded
  }
}

// Broadcast message to all other peers in a room
function broadcastToRoom(roomId: string, excludePeerId: string, message: any) {
  for (const [peerId, entry] of registry.entries()) {
    if (peerId !== excludePeerId && entry.roomId === roomId) {
      deliverMessage(peerId, message);
    }
  }
}

// Helper: Generate deterministic unique LAN IP for any device
function generateDeterministicLanIp(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  const host = 100 + (Math.abs(hash) % 150);
  return `192.168.1.${host}`;
}

// Periodic cleanup of stale peers (15s timeout for peers without active WS or polling)
setInterval(() => {
  const now = Date.now();
  for (const [peerId, entry] of registry.entries()) {
    // If peer has an open WS, update lastSeen and keep alive
    if (entry.ws && entry.ws.readyState === WebSocket.OPEN) {
      entry.lastSeen = now;
      continue;
    }
    // If peer has no active WS and hasn't polled in 15 seconds, remove it
    if (now - entry.lastSeen > 15000) {
      registry.delete(peerId);
      broadcastToRoom(entry.roomId, peerId, {
        type: 'peer-left',
        peerId
      });
    }
  }
}, 3000);

// Helper: Remove any existing stale duplicate entries for this device
function cleanDuplicatesForPeer(_peer: PeerMetadata, _currentPeerId: string, _currentRoomId: string) {
  // Map.set(peer.id) naturally handles re-connections for the same peerId.
  // We never delete other active peers from the room.
}

// Helper: Return strictly deduplicated peers list for a room
function getDeduplicatedPeersForRoom(roomId: string, excludePeerId: string, _excludePeer?: PeerMetadata): PeerMetadata[] {
  const peers: PeerMetadata[] = [];
  const seenIds = new Set<string>();

  for (const [otherId, otherEntry] of registry.entries()) {
    if (otherId !== excludePeerId && otherEntry.roomId === roomId) {
      if (!seenIds.has(otherId)) {
        seenIds.add(otherId);
        peers.push(otherEntry.peer);
      }
    }
  }
  return peers;
}

app.use(express.json({ limit: '50mb' }));
app.use(express.text({ type: ['text/plain', 'application/json'] }));

// API: Get network suggestions and status
app.get('/api/network-status', (req, res) => {
  const localAddrs = getLocalNetworkInfo();
  const clientIp = getClientIp(req);
  res.json({
    status: 'ok',
    clientWanIp: clientIp,
    detectedAddresses: localAddrs,
    hostname: os.hostname(),
    timestamp: Date.now()
  });
});

// REST: Leave room immediately (sent via beacon or unload)
app.post('/api/peers/leave', (req, res) => {
  try {
    let peerId: string | null = null;
    if (typeof req.body === 'string') {
      const parsed = JSON.parse(req.body);
      peerId = parsed.peerId;
    } else if (req.body && req.body.peerId) {
      peerId = req.body.peerId;
    }

    if (peerId && registry.has(peerId)) {
      const entry = registry.get(peerId);
      if (entry) {
        registry.delete(peerId);
        broadcastToRoom(entry.roomId, peerId, {
          type: 'peer-left',
          peerId
        });
      }
    }
  } catch (e) {
    // Ignored
  }
  res.json({ status: 'ok' });
});

// REST: Join room
app.post('/api/peers/join', (req, res) => {
  const { roomId, peer } = req.body;
  if (!peer || !peer.id) {
    return res.status(400).json({ error: 'Missing peer info' });
  }

  const clientIp = getClientIp(req);
  
  // Guarantee unique LAN IP for every device: never overwrite device's unique LAN IP with router WAN IP
  if (!peer.ip || peer.ip === '127.0.0.1' || peer.ip === 'Sprawdzanie IP...' || peer.ip.includes('unknown')) {
    peer.ip = generateDeterministicLanIp(peer.id);
  }

  const targetRoom = (roomId && roomId.trim()) ? roomId.trim() : 'default_lan_mesh';

  // Purge any stale duplicate sessions of this device
  cleanDuplicatesForPeer(peer, peer.id, targetRoom);

  let entry = registry.get(peer.id);
  if (!entry) {
    entry = {
      peer,
      roomId: targetRoom,
      lastSeen: Date.now(),
      pendingMessages: []
    };
    registry.set(peer.id, entry);
  } else {
    entry.peer = peer;
    entry.roomId = targetRoom;
    entry.lastSeen = Date.now();
  }

  // Notify others in room
  broadcastToRoom(entry.roomId, peer.id, {
    type: 'peer-joined',
    peer
  });

  // Get clean, deduplicated peers in this room
  const peers = getDeduplicatedPeersForRoom(entry.roomId, peer.id, peer);

  res.json({ status: 'ok', peers, assignedIp: peer.ip, clientWanIp: clientIp });
});

// REST Fallback: Poll for peers, updates and messages
app.get('/api/peers/poll', (req, res) => {
  const peerId = req.query.peerId as string;
  const roomId = (req.query.roomId as string) || 'default_lan_mesh';

  if (!peerId) {
    return res.status(400).json({ error: 'Missing peerId' });
  }

  const entry = registry.get(peerId);
  if (entry) {
    entry.lastSeen = Date.now();
    entry.roomId = roomId;
    const messages = [...entry.pendingMessages];
    entry.pendingMessages = [];

    const peers = getDeduplicatedPeersForRoom(roomId, peerId, entry.peer);

    return res.json({ status: 'ok', peers, messages });
  }

  // Peer not registered yet: still return clean deduplicated peers
  const peers = getDeduplicatedPeersForRoom(roomId, peerId);
  res.json({ status: 'not_registered', peers, messages: [] });
});

// REST Fallback: Send WebRTC signal
app.post('/api/peers/signal', (req, res) => {
  const { fromPeerId, toPeerId, data } = req.body;
  if (!toPeerId || !data) {
    return res.status(400).json({ error: 'Invalid signal payload' });
  }

  deliverMessage(toPeerId, {
    type: 'signal',
    fromPeerId,
    data
  });

  res.json({ status: 'ok' });
});

// REST Fallback: Relay transfer chunk
app.post('/api/peers/relay', (req, res) => {
  const { fromPeerId, toPeerId, transferId, chunkIndex, totalChunks, data, meta } = req.body;
  deliverMessage(toPeerId, {
    type: 'relay-chunk',
    fromPeerId,
    transferId,
    chunkIndex,
    totalChunks,
    data,
    meta
  });
  res.json({ status: 'ok' });
});

// REST Fallback: Transfer control (refresh, retry, resume, stall unfreeze)
app.post('/api/peers/control', (req, res) => {
  const { fromPeerId, toPeerId, action, transferId } = req.body;
  deliverMessage(toPeerId, {
    type: 'transfer-control',
    fromPeerId,
    action,
    transferId
  });
  res.json({ status: 'ok' });
});

// REST Fallback: Pair by 4-digit PIN code across different networks
app.post('/api/peers/pair', (req, res) => {
  const { fromPeerId, pairCode } = req.body;
  if (!fromPeerId || !pairCode) {
    return res.status(400).json({ error: 'Missing fromPeerId or pairCode' });
  }

  const cleanCode = String(pairCode).trim();
  let matchedPeerEntry: PeerEntry | null = null;
  let matchedPeerId: string | null = null;

  for (const [id, entry] of registry.entries()) {
    if (id !== fromPeerId && entry.peer && entry.peer.pairCode === cleanCode) {
      matchedPeerEntry = entry;
      matchedPeerId = id;
      break;
    }
  }

  const myEntry = registry.get(fromPeerId);
  if (matchedPeerEntry && matchedPeerId && myEntry) {
    const bridgeRoom = `paired_${cleanCode}`;
    myEntry.roomId = bridgeRoom;
    matchedPeerEntry.roomId = bridgeRoom;

    deliverMessage(matchedPeerId, {
      type: 'pair-success',
      peer: myEntry.peer,
      roomId: bridgeRoom
    });
    deliverMessage(matchedPeerId, {
      type: 'peer-joined',
      peer: myEntry.peer
    });

    deliverMessage(fromPeerId, {
      type: 'pair-success',
      peer: matchedPeerEntry.peer,
      roomId: bridgeRoom
    });

    return res.json({ status: 'ok', matchedPeer: matchedPeerEntry.peer, roomId: bridgeRoom });
  }

  return res.status(404).json({ error: 'Pair code not found' });
});

// REST Fallback: Peer leaving
app.post('/api/peers/leave', (req, res) => {
  const { peerId } = req.body;
  if (peerId && registry.has(peerId)) {
    const entry = registry.get(peerId);
    registry.delete(peerId);
    if (entry) {
      broadcastToRoom(entry.roomId, peerId, {
        type: 'peer-left',
        peerId
      });
    }
  }
  res.json({ status: 'ok' });
});

// WebSocket Signaling & Discovery Handler
wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
  const clientIp = getClientIp(req);
  let currentPeerId: string | null = null;

  // Send real network info and client WAN IP
  try {
    ws.send(JSON.stringify({
      type: 'welcome',
      clientWanIp: clientIp,
      serverAddrs: getLocalNetworkInfo(),
      timestamp: Date.now()
    }));
  } catch {
    // Ignore early closed ws
  }

  ws.on('message', (rawMessage: string | Buffer) => {
    try {
      const msg = JSON.parse(rawMessage.toString());

      if (msg.type === 'join') {
        const { roomId = 'default_lan_mesh', peer } = msg;
        if (!peer || !peer.id) return;

        currentPeerId = peer.id;
        if (!peer.ip || peer.ip === '127.0.0.1' || peer.ip === 'Sprawdzanie IP...' || peer.ip.includes('unknown')) {
          peer.ip = generateDeterministicLanIp(peer.id);
        }

        const targetRoom = (roomId && roomId.trim()) ? roomId.trim() : 'default_lan_mesh';
        
        // Purge any stale duplicate sessions of this device
        cleanDuplicatesForPeer(peer, peer.id, targetRoom);

        const existing = registry.get(peer.id);
        const pendingMessages = existing ? existing.pendingMessages : [];

        registry.set(peer.id, {
          peer,
          roomId: targetRoom,
          ws,
          lastSeen: Date.now(),
          pendingMessages
        });

        // Send existing clean, deduplicated peers in this room
        const roomPeers = getDeduplicatedPeersForRoom(targetRoom, peer.id, peer);

        ws.send(JSON.stringify({
          type: 'room-peers',
          peers: roomPeers
        }));

        // Notify other peers in this room
        broadcastToRoom(targetRoom, peer.id, {
          type: 'peer-joined',
          peer
        });
      } else if (msg.type === 'update-peer') {
        if (msg.peer && msg.peer.id) {
          const entry = registry.get(msg.peer.id);
          if (entry) {
            entry.peer = { ...entry.peer, ...msg.peer };
            entry.lastSeen = Date.now();
            broadcastToRoom(entry.roomId, msg.peer.id, {
              type: 'peer-updated',
              peer: entry.peer
            });
          }
        }
      } else if (msg.type === 'signal') {
        const { toPeerId, data } = msg;
        deliverMessage(toPeerId, {
          type: 'signal',
          fromPeerId: currentPeerId,
          data
        });
      } else if (msg.type === 'relay-chunk') {
        const { toPeerId, transferId, chunkIndex, totalChunks, data, meta } = msg;
        deliverMessage(toPeerId, {
          type: 'relay-chunk',
          fromPeerId: currentPeerId,
          transferId,
          chunkIndex,
          totalChunks,
          data,
          meta
        });
      } else if (msg.type === 'transfer-control') {
        const { toPeerId, action, transferId } = msg;
        deliverMessage(toPeerId, {
          type: 'transfer-control',
          fromPeerId: currentPeerId,
          action,
          transferId
        });
      } else if (msg.type === 'pair-by-code') {
        const { code } = msg;
        if (!code || !currentPeerId) return;
        const cleanCode = String(code).trim();

        let matchedPeerEntry: PeerEntry | null = null;
        let matchedPeerId: string | null = null;

        for (const [id, entry] of registry.entries()) {
          if (id !== currentPeerId && entry.peer && entry.peer.pairCode === cleanCode) {
            matchedPeerEntry = entry;
            matchedPeerId = id;
            break;
          }
        }

        const myEntry = registry.get(currentPeerId);
        if (matchedPeerEntry && matchedPeerId && myEntry) {
          const bridgeRoom = `paired_${cleanCode}`;
          myEntry.roomId = bridgeRoom;
          matchedPeerEntry.roomId = bridgeRoom;

          deliverMessage(matchedPeerId, {
            type: 'pair-success',
            peer: myEntry.peer,
            roomId: bridgeRoom
          });
          deliverMessage(matchedPeerId, {
            type: 'peer-joined',
            peer: myEntry.peer
          });

          deliverMessage(currentPeerId, {
            type: 'pair-success',
            peer: matchedPeerEntry.peer,
            roomId: bridgeRoom
          });
          deliverMessage(currentPeerId, {
            type: 'peer-joined',
            peer: matchedPeerEntry.peer
          });
        } else {
          ws.send(JSON.stringify({
            type: 'pair-error',
            message: `Nie znaleziono urządzenia o kodzie PIN: ${cleanCode}`
          }));
        }
      } else if (msg.type === 'leave') {
        const peerId = msg.peerId || currentPeerId;
        if (peerId && registry.has(peerId)) {
          const entry = registry.get(peerId);
          if (entry) {
            registry.delete(peerId);
            broadcastToRoom(entry.roomId, peerId, {
              type: 'peer-left',
              peerId
            });
          }
        }
      } else if (msg.type === 'ping') {
        if (currentPeerId) {
          const entry = registry.get(currentPeerId);
          if (entry) entry.lastSeen = Date.now();
        }
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      }
    } catch (err) {
      console.error('Error handling WebSocket message:', err);
    }
  });

  ws.on('close', () => {
    if (currentPeerId) {
      const entry = registry.get(currentPeerId);
      if (entry) {
        entry.ws = null;
        // Fast 6-second departure timer so dead tabs don't linger on radar
        setTimeout(() => {
          const check = registry.get(currentPeerId!);
          if (check && (!check.ws || check.ws.readyState !== WebSocket.OPEN) && Date.now() - check.lastSeen > 6000) {
            registry.delete(currentPeerId!);
            broadcastToRoom(check.roomId, currentPeerId!, {
              type: 'peer-left',
              peerId: currentPeerId!
            });
          }
        }, 6000);
      }
    }
  });
});

const PORT = 3000;

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: { server },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`PeerDrop server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
