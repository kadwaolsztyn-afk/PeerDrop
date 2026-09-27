import { useState, useEffect, useRef } from 'react';
import {
  Zap,
  QrCode,
  UploadCloud,
  Sun,
  FolderDown,
  RotateCw,
  Link2,
  Send
} from 'lucide-react';
import { PeerDevice, FileTransfer, DeviceType, ReceiveSaveMode } from './types';
import {
  PeerDropManager,
  detectLocalDeviceInfo,
  detectEnhancedDeviceInfoAsync,
  getOrCreateDeviceId,
  generatePairCode,
  generateDeterministicLanIp,
  detectDeviceLanIp,
} from './services/network';
import { DeviceRadar } from './components/DeviceRadar';
import { SendModal } from './components/SendModal';
import { TransferDashboard } from './components/TransferDashboard';
import { ConnectPeerModal } from './components/ConnectPeerModal';
import { PeerDropLogo } from './components/PeerDropLogo';
import { ReceiveSaveModal } from './components/ReceiveSaveModal';
import { PWAInstallButton } from './components/PWAInstallButton';
import { PWAInstallModal } from './components/PWAInstallModal';
import { deviceKeepAlive } from './services/wakeLock';
import { extractFilesFromDataTransfer, FileLoadProgress } from './utils/fileExtractor';
import { FileLoadingOverlay } from './components/FileLoadingOverlay';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { formatBytes } from './utils/format';
import {
  getActiveTransferDestination,
  saveTransferFile,
  clearActiveTransferDestination,
  saveFileToDefaultDownloads,
} from './utils/fileSaver';

export default function App() {
  const isOnline = useOnlineStatus();
  const [manager, setManager] = useState<PeerDropManager | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'connecting' | 'disconnected'>('connecting');
  const [peers, setPeers] = useState<PeerDevice[]>([]);
  const [transfers, setTransfers] = useState<FileTransfer[]>([]);
  const [refreshingTransferIds, setRefreshingTransferIds] = useState<string[]>([]);
  const [isKeepAliveActive, setIsKeepAliveActive] = useState<boolean>(false);
  const sendQueueFilesRef = useRef<Map<string, { peerId: string; file: File; id: string }>>(new Map());
  const retrySendRef = useRef<((transferId: string) => void) | undefined>(undefined);

  // Subscribe to device keep-alive status (screen lock prevention)
  useEffect(() => {
    return deviceKeepAlive.subscribe((active) => {
      setIsKeepAliveActive(active);
    });
  }, []);

  // Monitor transfers to ensure keep-alive stays active while transferring
  useEffect(() => {
    const hasActive = transfers.some(
      (t) => t.status === 'transferring' || t.status === 'encrypting' || t.status === 'decrypting' || t.status === 'pending'
    );
    if (hasActive) {
      deviceKeepAlive.enableKeepAlive();
    } else {
      deviceKeepAlive.disableKeepAlive();
      // When transfer batch finishes, reset active destination after 90s so next batch can prompt again if needed
      if (transfers.length > 0) {
        const timer = setTimeout(() => {
          clearActiveTransferDestination();
        }, 90000);
        return () => clearTimeout(timer);
      }
    }
  }, [transfers]);

  // Periodic stall detection for active transfers (identifies frozen files without data transfer for >7s)
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      setTransfers((prev) => {
        let changed = false;
        const updated = prev.map((t) => {
          if (
            (t.status === 'transferring' || t.status === 'pending') &&
            t.progress < 100
          ) {
            const lastActivity = t.lastActivityTime || t.startTime || now;
            const isStalledNow = now - lastActivity > 15000;
            if (Boolean(t.isStalled) !== isStalledNow) {
              changed = true;
              return { ...t, isStalled: isStalledNow };
            }
          } else if (t.isStalled) {
            changed = true;
            return { ...t, isStalled: false };
          }
          return t;
        });
        return changed ? updated : prev;
      });
    }, 2000);

    return () => clearInterval(timer);
  }, []);

  // Modals
  const [isSendModalOpen, setIsSendModalOpen] = useState(false);
  const [sendModalInitialMode, setSendModalInitialMode] = useState<'files' | 'link'>('files');
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [isInstallModalOpen, setIsInstallModalOpen] = useState(false);
  const [selectedTargetPeer, setSelectedTargetPeer] = useState<PeerDevice | null>(null);
  const [droppedFiles, setDroppedFiles] = useState<File[]>([]);

  // Local Peer State with deterministic unique LAN IP
  const [localPeer, setLocalPeer] = useState<PeerDevice>(() => {
    // Purge any old legacy keys from previous versions
    ['netbeam_device_name', 'netbeam_network_name', 'netbeam_auto_receive', 'netbeam_receive_save_mode'].forEach(k => {
      try { localStorage.removeItem(k); } catch {}
    });

    const { deviceType, os, browser, modelDetails, screenResolution, cpuCores, defaultName } = detectLocalDeviceInfo();
    const rawStoredName = localStorage.getItem('peerdrop_device_name') || defaultName;
    const cleanStoredName = rawStoredName.replace(/netbeam/gi, 'PeerDrop');

    // If device was previously stored under an old generic name, upgrade it to the rich hardware identification
    const isOldGeneric =
      !localStorage.getItem('peerdrop_device_name') ||
      /^Laptop PC \(Windows\)/.test(cleanStoredName) ||
      /^Komputer PC \(Windows\)/.test(cleanStoredName) ||
      /^Smartfon Android/.test(cleanStoredName) ||
      /^Apple Mac \(macOS\)/.test(cleanStoredName) ||
      cleanStoredName.includes('undefined');

    const effectiveName = isOldGeneric ? defaultName : cleanStoredName;
    try { localStorage.setItem('peerdrop_device_name', effectiveName); } catch {}

    const storedAutoReceive = localStorage.getItem('peerdrop_auto_receive') !== 'false';
    const rawNetwork = localStorage.getItem('peerdrop_network_name') || 'Wspólna Sieć Lokalna (LAN / Wi-Fi)';
    const cleanNetwork = rawNetwork.replace(/netbeam/gi, 'PeerDrop');

    const deviceId = getOrCreateDeviceId();
    const uniqueLanIp = generateDeterministicLanIp(deviceId);

    return {
      id: deviceId,
      name: effectiveName,
      deviceType,
      os,
      browser,
      modelDetails,
      screenResolution,
      cpuCores,
      ip: uniqueLanIp,
      connectionType: 'wifi',
      networkName: cleanNetwork,
      linkSpeed: 'Wi-Fi / LAN',
      ping: 1,
      isSelf: true,
      autoReceive: storedAutoReceive,
      receiveSaveMode: (localStorage.getItem('peerdrop_receive_save_mode') as ReceiveSaveMode) || 'prompt',
      encryptionFingerprint: 'A49F:C81B:9E20:3DF1',
      pairCode: generatePairCode(),
      lastSeen: Date.now()
    };
  });

  const [receiveSaveMode, setReceiveSaveMode] = useState<ReceiveSaveMode>(() => {
    const stored = localStorage.getItem('peerdrop_receive_save_mode');
    if (stored === 'prompt' || stored === 'save_as' || stored === 'auto_downloads') {
      return stored as ReceiveSaveMode;
    }
    return 'prompt';
  });

  const receiveSaveModeRef = useRef<ReceiveSaveMode>(receiveSaveMode);
  useEffect(() => {
    receiveSaveModeRef.current = receiveSaveMode;
  }, [receiveSaveMode]);

  const [isReceiveSaveModalOpen, setIsReceiveSaveModalOpen] = useState<boolean>(false);
  const [pendingSaveTransfers, setPendingSaveTransfers] = useState<FileTransfer[]>([]);

  const managerRef = useRef<PeerDropManager | null>(null);

  // Initialize PeerDrop Network Manager
  useEffect(() => {
    const mgr = new PeerDropManager(localPeer, {
      onPeersUpdated: (updatedPeers) => {
        setPeers(updatedPeers);
      },
      onTransferProgress: (updatedTransfer) => {
        setTransfers((prev) => {
          const index = prev.findIndex((t) => t.id === updatedTransfer.id);
          const activeUpdate = {
            ...updatedTransfer,
            lastActivityTime: Date.now(),
            isStalled: false,
          };
          if (index >= 0) {
            const next = [...prev];
            next[index] = activeUpdate;
            return next;
          }
          return [activeUpdate, ...prev];
        });
      },
      onRetryRequested: (transferId) => {
        retrySendRef.current?.(transferId);
      },
      onTransferCompleted: (completedTransfer) => {
        setTransfers((prev) => {
          const filtered = prev.filter((t) => t.id !== completedTransfer.id);
          return [completedTransfer, ...filtered];
        });

        // If a file was received:
        if (completedTransfer.direction === 'receive') {
          // If it is a web link / URL, mark as received without disk save prompt
          if (completedTransfer.isLink) {
            setTransfers((prev) =>
              prev.map((t) => (t.id === completedTransfer.id ? { ...t, savedLocation: 'Odebrano Link URL' } : t))
            );
            return;
          }

          // 1. If set to automatic downloads ("AUTO POBRANE"), save directly to default Downloads
          if (receiveSaveModeRef.current === 'auto_downloads') {
            const source = completedTransfer.blob || completedTransfer.blobUrl;
            if (source) {
              saveFileToDefaultDownloads(source, completedTransfer.fileName);
            }
            setTransfers((prev) =>
              prev.map((t) => (t.id === completedTransfer.id ? { ...t, savedLocation: 'Folder Pobrane' } : t))
            );
            return;
          }

          // 2. If set to choice where to save ("WYBÓR ZAPISU"):
          // Check if destination was already chosen for this transfer session:
          const activeDest = getActiveTransferDestination();
          if (activeDest) {
            // Save this file automatically to the chosen destination!
            const source = completedTransfer.blob || completedTransfer.blobUrl;
            if (source) {
              saveTransferFile(activeDest, source, completedTransfer.fileName).then((res) => {
                if (res.success) {
                  setTransfers((prev) =>
                    prev.map((t) => (t.id === completedTransfer.id ? { ...t, savedLocation: res.location } : t))
                  );
                }
              });
            }
            return;
          }

          // 3. If destination has not been chosen yet, open modal for this transfer
          setPendingSaveTransfers((prev) => {
            if (prev.some((t) => t.id === completedTransfer.id)) return prev;
            return [...prev, completedTransfer];
          });
          setIsReceiveSaveModalOpen(true);
        }
      },
      onConnectionStatusChange: (status) => {
        setConnectionStatus(status);
      },
    });

    managerRef.current = mgr;
    setManager(mgr);

    // Initial default network join
    const urlParams = new URLSearchParams(window.location.search);
    const networkFromUrl = urlParams.get('room') || localPeer.networkName;
    mgr.setNetwork(localPeer.connectionType, networkFromUrl, 'peerdrop-lan-secure');

    // Actively probe for real host LAN IP via WebRTC
    detectDeviceLanIp(localPeer.id).then((realIp) => {
      if (realIp && realIp !== '127.0.0.1') {
        setLocalPeer((prev) => ({ ...prev, ip: realIp }));
        if (managerRef.current) {
          managerRef.current.updateLocalPeer({ ip: realIp });
        }
      }
    });

    // Fetch network context from server without overriding device's unique LAN IP
    fetch('/api/network-status')
      .then((res) => res.json())
      .catch(() => {});

    // Real hardware model detection using User-Agent Client Hints (Chrome, Edge, Samsung Internet, Opera)
    detectEnhancedDeviceInfoAsync().then((enhanced) => {
      if (enhanced && enhanced.name) {
        const enhancedName = enhanced.name;
        setLocalPeer((prev) => {
          const stored = localStorage.getItem('peerdrop_device_name');
          const isOldOrGeneric =
            !stored ||
            /^Laptop PC/i.test(stored) ||
            /^Komputer PC/i.test(stored) ||
            /^Smartfon Android/i.test(stored) ||
            /^Tablet Android/i.test(stored) ||
            /^Urządzenie/i.test(stored);

          if (isOldOrGeneric) {
            try { localStorage.setItem('peerdrop_device_name', enhancedName); } catch {}
            const next: PeerDevice = {
              ...prev,
              name: enhancedName,
              modelDetails: enhanced.modelDetails || prev.modelDetails,
              deviceType: enhanced.deviceType || prev.deviceType
            };
            if (managerRef.current) {
              managerRef.current.updateLocalPeer({
                name: enhancedName,
                modelDetails: next.modelDetails,
                deviceType: next.deviceType
              });
            }
            return next;
          }
          return prev;
        });
      }
    }).catch(() => {});

    // WebRTC Local candidate detection if available
    try {
      const pc = new RTCPeerConnection({ iceServers: [] });
      pc.createDataChannel('discovery');
      pc.createOffer().then((offer) => pc.setLocalDescription(offer)).catch(() => {});
      pc.onicecandidate = (event) => {
        if (!event || !event.candidate || !event.candidate.candidate) return;
        const cand = event.candidate.candidate;
        const match = cand.match(/([0-9]{1,3}(\.[0-9]{1,3}){3})/);
        if (match && match[1] && !match[1].startsWith('127.')) {
          const localIp = match[1];
          setLocalPeer((prev) => ({ ...prev, ip: localIp }));
          if (managerRef.current) {
            managerRef.current.updateLocalPeer({ ip: localIp });
          }
          pc.close();
        }
      };
      setTimeout(() => {
        try { pc.close(); } catch {}
      }, 3000);
    } catch {}

    return () => {
      mgr.destroy();
    };
  }, []);

  // Global window drag & drop for rapid sending
  const [isWindowDragging, setIsWindowDragging] = useState(false);
  const [isExtractingFiles, setIsExtractingFiles] = useState(false);
  const [extractingProgress, setExtractingProgress] = useState<FileLoadProgress | null>(null);
  const dragCounter = useRef(0);

  useEffect(() => {
    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current += 1;
      if (e.dataTransfer && e.dataTransfer.types.includes('Files')) {
        setIsWindowDragging(true);
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current -= 1;
      if (dragCounter.current <= 0) {
        setIsWindowDragging(false);
        dragCounter.current = 0;
      }
    };

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
    };

    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      setIsWindowDragging(false);
      if (e.dataTransfer) {
        setIsExtractingFiles(true);
        try {
          const files = await extractFilesFromDataTransfer(e.dataTransfer, (prog) => {
            setExtractingProgress(prog);
          });
          if (files && files.length > 0) {
            setDroppedFiles(files);
            setSelectedTargetPeer(peers[0] || null);
            setIsSendModalOpen(true);
          }
        } catch {
          if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            setDroppedFiles(Array.from(e.dataTransfer.files));
            setSelectedTargetPeer(peers[0] || null);
            setIsSendModalOpen(true);
          }
        } finally {
          setTimeout(() => {
            setIsExtractingFiles(false);
            setExtractingProgress(null);
          }, 300);
        }
      }
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, [peers]);

  // Update Receive Save Mode preference
  const handleUpdateSaveMode = (mode: ReceiveSaveMode) => {
    setReceiveSaveMode(mode);
    receiveSaveModeRef.current = mode;
    localStorage.setItem('peerdrop_receive_save_mode', mode);
    const autoRec = mode === 'auto_downloads';
    setLocalPeer((prev) => ({ ...prev, autoReceive: autoRec, receiveSaveMode: mode }));
    if (managerRef.current) {
      managerRef.current.updateLocalPeer({ autoReceive: autoRec, receiveSaveMode: mode });
    }
  };

  const toggleSaveMode = () => {
    const nextMode: ReceiveSaveMode = receiveSaveMode === 'prompt' ? 'auto_downloads' : 'prompt';
    handleUpdateSaveMode(nextMode);
  };

  // Trigger send files
  const handleSelectPeerToSend = (peer: PeerDevice) => {
    setSelectedTargetPeer(peer);
    setDroppedFiles([]);
    setSendModalInitialMode('files');
    setIsSendModalOpen(true);
  };

  // Trigger send link to peer
  const handleSelectPeerToSendLink = (peer: PeerDevice) => {
    setSelectedTargetPeer(peer);
    setDroppedFiles([]);
    setSendModalInitialMode('link');
    setIsSendModalOpen(true);
  };

  const handleOpenSendLinkModal = (peer?: PeerDevice | null) => {
    if (peer) setSelectedTargetPeer(peer);
    setDroppedFiles([]);
    setSendModalInitialMode('link');
    setIsSendModalOpen(true);
  };

  // Handle files dropped on peer card
  const handleDropFilesOnPeer = (peer: PeerDevice, files: File[]) => {
    setSelectedTargetPeer(peer);
    setDroppedFiles(files);
    setSendModalInitialMode('files');
    setIsSendModalOpen(true);
  };

  const handleCloseSendModal = () => {
    setIsSendModalOpen(false);
    setDroppedFiles([]);
  };

  // Send a link / URL directly to peer
  const handleStartSendLink = async (peerId: string, url: string, title?: string) => {
    if (!managerRef.current || !url) return;

    const targetPeer = peers.find((p) => p.id === peerId);
    const cleanTitle = (title && title.trim()) || url.trim();
    const transferId = `link_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const linkTransfer: FileTransfer = {
      id: transferId,
      fileName: `${(cleanTitle.replace(/[\\/:*?"<>|]/g, '_').slice(0, 30) || 'Link')}.url`,
      fileSize: new Blob([`[InternetShortcut]\r\nURL=${url}\r\n`]).size,
      fileType: 'text/uri-list',
      direction: 'send',
      peerId,
      peerName: targetPeer?.name || (peerId === localPeer.id ? 'To Urządzenie' : 'Urządzenie docelowe'),
      peerDeviceType: targetPeer?.deviceType || 'laptop',
      status: 'transferring',
      progress: 10,
      bytesTransferred: 0,
      currentSpeed: 0,
      peakSpeed: 0,
      avgSpeed: 0,
      startTime: Date.now(),
      etaSeconds: 1,
      isAutoAccepted: true,
      chunksTotal: 1,
      chunksCompleted: 0,
      isStalled: false,
      lastActivityTime: Date.now(),
      isLink: true,
      linkUrl: url,
      linkTitle: cleanTitle
    };

    setTransfers((prev) => [linkTransfer, ...prev]);

    try {
      await managerRef.current.sendLink(
        peerId,
        url,
        cleanTitle,
        (progressUpdate) => {
          setTransfers((prev) => {
            const index = prev.findIndex((t) => t.id === progressUpdate.id || t.id === transferId);
            if (index >= 0) {
              const next = [...prev];
              next[index] = { ...next[index], ...progressUpdate, isLink: true, linkUrl: url, linkTitle: cleanTitle };
              return next;
            }
            return [{ ...progressUpdate, isLink: true, linkUrl: url, linkTitle: cleanTitle }, ...prev];
          });
        },
        transferId
      );
    } catch (err: any) {
      setTransfers((prev) =>
        prev.map((t) =>
          t.id === transferId
            ? { ...t, status: 'error', error: err?.message || 'Błąd wysyłania linku' }
            : t
        )
      );
    }
  };

  // Start sending multiple files in a reliable sequential queue with live status
  const handleStartSend = async (peerId: string, filesToSend: File[]) => {
    if (!managerRef.current || filesToSend.length === 0) return;

    // Immediately generate transfers for all files so user sees full queue in Dashboard
    const initialTransfers: FileTransfer[] = filesToSend.map((file, idx) => ({
      id: `send_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 7)}`,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type || 'application/octet-stream',
      direction: 'send',
      peerId,
      peerName: peers.find((p) => p.id === peerId)?.name || (peerId === localPeer.id ? 'To Urządzenie' : 'Urządzenie docelowe'),
      peerDeviceType: peers.find((p) => p.id === peerId)?.deviceType || 'laptop',
      status: idx === 0 ? 'transferring' : 'pending',
      progress: 0,
      bytesTransferred: 0,
      currentSpeed: 0,
      peakSpeed: 0,
      avgSpeed: 0,
      startTime: Date.now(),
      etaSeconds: 0,
      chunksTotal: Math.max(1, Math.ceil(file.size / (60 * 1024))),
      chunksCompleted: 0,
      isAutoAccepted: true
    }));

    setTransfers((prev) => [...initialTransfers, ...prev]);

    // Store in send queue map so any file can be retried or refreshed if stalled
    filesToSend.forEach((file, idx) => {
      const initialTx = initialTransfers[idx];
      sendQueueFilesRef.current.set(initialTx.id, { peerId, file, id: initialTx.id });
    });

    // Send files sequentially with pacing so WebRTC / WebSocket channels and browser download popups aren't overwhelmed
    for (let i = 0; i < filesToSend.length; i++) {
      const file = filesToSend[i];
      const initialTx = initialTransfers[i];

      await new Promise<void>((resolve) => {
        managerRef.current?.sendFile(
          peerId,
          file,
          (progressUpdate) => {
            setTransfers((prev) => {
              const index = prev.findIndex((t) => t.id === progressUpdate.id || t.id === initialTx.id);
              if (index >= 0) {
                const next = [...prev];
                next[index] = progressUpdate;
                return next;
              }
              return [progressUpdate, ...prev];
            });

            if (
              progressUpdate.status === 'completed' ||
              progressUpdate.status === 'cancelled' ||
              progressUpdate.status === 'error'
            ) {
              resolve();
            }
          },
          initialTx.id
        );
      });

      // Small pacing delay between files to avoid browser download throttling on receiver
      if (i < filesToSend.length - 1) {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
  };

  // Retry or unfreeze a specific outgoing transfer
  const handleRetrySend = async (transferId: string) => {
    const item = sendQueueFilesRef.current.get(transferId);
    if (!item || !managerRef.current) return;

    setRefreshingTransferIds((prev) => (prev.includes(transferId) ? prev : [...prev, transferId]));

    // Stop current send if stuck
    managerRef.current.cancelTransfer(transferId);
    await managerRef.current.reconnectPeer(item.peerId);
    await new Promise((r) => setTimeout(r, 250));

    setTransfers((prev) =>
      prev.map((t) =>
        t.id === transferId
          ? {
              ...t,
              status: 'transferring',
              progress: 0,
              bytesTransferred: 0,
              currentSpeed: 0,
              isStalled: false,
              lastActivityTime: Date.now(),
            }
          : t
      )
    );

    managerRef.current.sendFile(
      item.peerId,
      item.file,
      (progressUpdate) => {
        setTransfers((prev) => {
          const index = prev.findIndex((t) => t.id === progressUpdate.id || t.id === transferId);
          if (index >= 0) {
            const next = [...prev];
            next[index] = progressUpdate;
            return next;
          }
          return [progressUpdate, ...prev];
        });
      },
      transferId
    );

    setTimeout(() => {
      setRefreshingTransferIds((prev) => prev.filter((id) => id !== transferId));
    }, 800);
  };

  // Wire up ref so manager callbacks can invoke it without closure staleness
  useEffect(() => {
    retrySendRef.current = handleRetrySend;
  });

  // Refresh a single transfer (sender or receiver)
  const handleRefreshTransfer = async (transferId: string) => {
    setRefreshingTransferIds((prev) => (prev.includes(transferId) ? prev : [...prev, transferId]));
    const tx = transfers.find((t) => t.id === transferId);
    if (!tx || !managerRef.current) {
      setRefreshingTransferIds((prev) => prev.filter((id) => id !== transferId));
      return;
    }

    if (tx.direction === 'send') {
      await handleRetrySend(transferId);
    } else {
      // Incoming receive transfer: notify sender peer to re-transmit and reset WebRTC
      managerRef.current.requestTransferRetry(transferId, tx.peerId);
      setTransfers((prev) =>
        prev.map((t) =>
          t.id === transferId
            ? {
                ...t,
                status: 'transferring',
                progress: 0,
                bytesTransferred: 0,
                currentSpeed: 0,
                isStalled: false,
                lastActivityTime: Date.now(),
              }
            : t
        )
      );
      setTimeout(() => {
        setRefreshingTransferIds((prev) => prev.filter((id) => id !== transferId));
      }, 800);
    }
  };

  // Refresh all active or stalled transfers and reconnect peer channels
  const handleRefreshAllActiveTransfers = async () => {
    if (!managerRef.current) return;
    const activeOrStalled = transfers.filter(
      (t) => t.status === 'transferring' || t.status === 'pending' || t.isStalled
    );

    const peerIds = Array.from(new Set(activeOrStalled.map((t) => t.peerId)));
    for (const pid of peerIds) {
      await managerRef.current.reconnectPeer(pid);
    }
    managerRef.current.reannounce();

    if (activeOrStalled.length === 0) return;

    for (const t of activeOrStalled) {
      handleRefreshTransfer(t.id);
    }
  };

  const handleCancelTransfer = (transferId: string) => {
    if (managerRef.current) {
      managerRef.current.cancelTransfer(transferId);
    }
    setTransfers((prev) =>
      prev.map((t) => (t.id === transferId ? { ...t, status: 'cancelled' } : t))
    );
  };

  const handleClearCompleted = () => {
    clearActiveTransferDestination();
    setTransfers((prev) => prev.filter((t) => t.status === 'transferring' || t.status === 'encrypting' || t.status === 'decrypting'));
  };

  const activeTransfers = transfers.filter(
    (t) => t.status === 'transferring' || t.status === 'pending' || t.status === 'encrypting' || t.status === 'decrypting'
  );

  // Synchronize browser tab/window title with PeerDrop
  useEffect(() => {
    if (activeTransfers.length > 0) {
      document.title = `(${activeTransfers.length}) PeerDrop P2P - Transfer w toku`;
    } else {
      document.title = 'PeerDrop P2P - Szybki Transfer Plików i Linków w Sieci LAN';
    }
  }, [activeTransfers.length]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500 selection:text-slate-950 overflow-x-hidden w-full">
      {/* Top Navigation Bar with Safe Area Inset support for notches and status bars */}
      <header className="sticky top-0 z-40 bg-slate-950/95 backdrop-blur-md border-b border-slate-800/80 w-full pt-[env(safe-area-inset-top,0px)]">
        <div className="max-w-[1536px] w-full mx-auto px-2 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center justify-between gap-1.5 sm:gap-4">
          {/* Logo & Brand & Status */}
          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0 min-w-0">
            <PeerDropLogo variant="full" />
            
            {/* Live single connection badge - responsive & balanced */}
            <span
              className={`flex items-center gap-1 sm:gap-1.5 px-1.5 py-0.5 sm:px-2.5 sm:py-1 rounded-full text-[9px] sm:text-[10px] font-mono border transition-all shrink-0 ${
                connectionStatus === 'connected'
                  ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-300'
                  : 'bg-amber-950/50 border-amber-500/40 text-amber-300'
              }`}
              title={connectionStatus === 'connected' ? 'Sieć P2P aktywna – gotowy do transferu' : 'Łączenie z lokalną siecią...'}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${connectionStatus === 'connected' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`}></span>
              <span className="font-bold tracking-wider">
                {connectionStatus === 'connected' ? 'P2P' : 'ŁĄCZENIE'}
              </span>
            </span>

            {/* Active Transfer live indicator or Stall Alert in header */}
            {activeTransfers.some((t) => t.isStalled) ? (
              <button
                type="button"
                onClick={handleRefreshAllActiveTransfers}
                className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-lg text-[10px] font-mono bg-amber-500/20 border border-amber-500/40 text-amber-300 animate-pulse shadow-sm shadow-amber-500/20 shrink-0 cursor-pointer whitespace-nowrap"
                title="Wykryto brak przesyłu danych - kliknij, aby odświeżyć połączenie i wznowić transfer"
              >
                <RotateCw className="w-3.5 h-3.5 text-amber-400 shrink-0 animate-spin" />
                <span className="font-bold hidden sm:inline">ZAWIESZONY — ODŚWIEŻ</span>
                <span className="font-bold sm:hidden">ODŚWIEŻ</span>
              </button>
            ) : activeTransfers.length > 0 ? (
              <button
                type="button"
                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-mono bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 animate-pulse shadow-sm shadow-cyan-500/10 shrink-0 cursor-pointer whitespace-nowrap"
                title="Trwa transfer plików - kliknij aby przewinąć do paska postępu"
              >
                <Zap className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span>TRANSFER: {activeTransfers.length} {activeTransfers.length === 1 ? 'PLIK' : 'PLIKÓW'}</span>
              </button>
            ) : null}

            {isKeepAliveActive && (
              <span className="hidden 2xl:flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-mono bg-amber-500/10 border border-amber-500/30 text-amber-300 animate-pulse shadow-sm shadow-amber-500/10 shrink-0 whitespace-nowrap" title="Blokada wygaszania ekranu aktywna - urządzenie nie przejdzie w tryb uśpienia">
                <Sun className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>EKRAN AKTYWNY</span>
              </span>
            )}
          </div>

          {/* Action buttons - justified right */}
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            {/* Receive Save Mode Toggle (Wybór zapisu folderu vs Auto do Pobranych) - shown on xl+ screens */}
            <button
              type="button"
              onClick={toggleSaveMode}
              className={`cursor-pointer h-9 px-2.5 sm:px-3 rounded-xl border hidden xl:flex items-center gap-1.5 sm:gap-2 transition-all shrink-0 whitespace-nowrap ${
                receiveSaveMode === 'prompt'
                  ? 'bg-cyan-950/40 border-cyan-500/40 text-cyan-300 shadow-sm'
                  : 'bg-emerald-950/30 border-emerald-500/40 text-emerald-300'
              }`}
              title="Wybór zapisu przy odbieraniu: 'WYBÓR ZAPISU' pozwala wybrać folder i nazwę na dysku; 'AUTO POBRANE' zapisuje natychmiast do Pobranych"
            >
              <FolderDown className="w-3.5 h-3.5 shrink-0 text-cyan-400" />
              <span className="text-xs font-medium">Zapis:</span>
              <span className="text-[11px] sm:text-xs font-bold font-mono">
                {receiveSaveMode === 'prompt' ? 'WYBÓR FOLDERU' : 'AUTO POBRANE'}
              </span>
            </button>

            {/* PWA Install Button (Komputer / Telefon / Tablet) */}
            <PWAInstallButton />

            {/* Unified Direct Send Button (Pliki i Linki) */}
            <button
              type="button"
              onClick={() => {
                setSelectedTargetPeer(peers[0] || null);
                setDroppedFiles([]);
                setSendModalInitialMode('files');
                setIsSendModalOpen(true);
              }}
              aria-label="Wyślij pliki lub link"
              className="h-8 w-8 sm:w-auto sm:h-9 px-0 sm:px-3 rounded-lg sm:rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 text-slate-950 hover:from-cyan-400 hover:to-blue-400 font-bold text-xs transition-all shadow-md shadow-cyan-500/20 flex items-center justify-center gap-1.5 shrink-0 active:scale-95 cursor-pointer whitespace-nowrap"
              title="Wyślij pliki lub link bez limitu wielkości"
            >
              <Send className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
              <span className="hidden md:inline">Wyślij</span>
            </button>

            {/* Connect another device modal button (QR code) */}
            <button
              type="button"
              onClick={() => setIsConnectModalOpen(true)}
              aria-label="Połącz drugi telefon lub PC kodem QR"
              className="h-8 w-8 sm:w-auto sm:h-9 px-0 sm:px-3 rounded-lg sm:rounded-xl bg-cyan-500 text-slate-950 hover:bg-cyan-400 font-semibold text-xs transition-all shadow-md shadow-cyan-500/20 flex items-center justify-center gap-1.5 shrink-0 active:scale-95 cursor-pointer whitespace-nowrap"
              title="Zeskanuj kod QR drugim telefonem lub laptopem"
            >
              <QrCode className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
              <span className="hidden md:inline">Połącz</span>
              <span className="hidden sm:inline md:hidden">QR</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-[1536px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Transfer Dashboard (Speedometer & Transfers List) */}
        <TransferDashboard
          transfers={transfers}
          onCancelTransfer={handleCancelTransfer}
          onClearCompleted={handleClearCompleted}
          onRefreshTransfer={handleRefreshTransfer}
          onRefreshAllActive={handleRefreshAllActiveTransfers}
          refreshingTransferIds={refreshingTransferIds}
          onOpenSaveOptions={() => {
            const received = transfers.filter(
              (t) => t.direction === 'receive' && t.status === 'completed' && (t.blob || t.blobUrl)
            );
            if (received.length > 0) {
              setPendingSaveTransfers(received);
              setIsReceiveSaveModalOpen(true);
            }
          }}
        />

        {/* Devices Radar, Device List & Sending Functions */}
        <DeviceRadar
          localPeer={localPeer}
          peers={peers}
          onSelectPeerToSend={handleSelectPeerToSend}
          onDropFilesOnPeer={handleDropFilesOnPeer}
          onUpdateLocalName={(newName) => {
            const updated = { ...localPeer, name: newName };
            setLocalPeer(updated);
            localStorage.setItem('peerdrop_device_name', newName);
            if (managerRef.current) {
              managerRef.current.updateLocalPeer({ name: newName });
            }
          }}
          onReannounce={() => {
            managerRef.current?.reannounce();
          }}
          onPairByCode={(code) => {
            if (managerRef.current) {
              managerRef.current.pairByCode(code);
            }
          }}
        />
      </main>

      {/* Discreet Copyright Footer */}
      <footer className="w-full border-t border-slate-900/80 py-3.5 px-4 text-slate-500 font-sans">
        <div className="max-w-[1536px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px]">
          <span className="text-slate-500">PeerDrop P2P · Bezpośredni, szyfrowany transfer danych</span>
          <span className="text-slate-400 font-mono tracking-wide">
            © {new Date().getFullYear()} FHU KaDWA · NIP 8451859929. Wszelkie prawa zastrzeżone.
          </span>
        </div>
      </footer>

      {/* Modals */}
      <SendModal
        isOpen={isSendModalOpen}
        onClose={handleCloseSendModal}
        targetPeer={selectedTargetPeer}
        allPeers={peers}
        localPeer={localPeer}
        onStartSend={handleStartSend}
        onSendLink={handleStartSendLink}
        initialMode={sendModalInitialMode}
        preselectedFiles={droppedFiles}
      />

      {/* Global drag-and-drop overlay */}
      {isWindowDragging && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md border-4 border-dashed border-cyan-400 flex flex-col items-center justify-center pointer-events-none p-6 text-center animate-in fade-in">
          <div className="w-20 h-20 rounded-3xl bg-cyan-500/20 border border-cyan-400 text-cyan-400 flex items-center justify-center mb-4 animate-bounce">
            <UploadCloud className="w-10 h-10" />
          </div>
          <h2 className="text-2xl font-bold text-white">Upuść pliki tutaj, aby wysłać</h2>
          <p className="text-sm text-cyan-300 mt-2">
            Automatyczny transfer P2P bez limitu wielkości do urządzeń w sieci LAN/Wi-Fi
          </p>
        </div>
      )}

      {/* File extraction / loading progress overlay */}
      <FileLoadingOverlay
        isOpen={isExtractingFiles}
        progress={extractingProgress}
        title="Wczytywanie i przygotowywanie plików..."
        onCancel={() => {
          setIsExtractingFiles(false);
          setExtractingProgress(null);
        }}
      />

      <ConnectPeerModal
        isOpen={isConnectModalOpen}
        onClose={() => setIsConnectModalOpen(false)}
        networkName={localPeer.networkName}
        connectionType={localPeer.connectionType}
        pairCode={localPeer.pairCode}
        onPairByCode={(code) => {
          if (managerRef.current) {
            managerRef.current.pairByCode(code);
          }
        }}
      />

      <PWAInstallModal
        isOpen={isInstallModalOpen}
        onClose={() => setIsInstallModalOpen(false)}
      />

      <ReceiveSaveModal
        isOpen={isReceiveSaveModalOpen}
        transfers={pendingSaveTransfers}
        onClose={() => {
          setIsReceiveSaveModalOpen(false);
          setPendingSaveTransfers([]);
        }}
        currentSaveMode={receiveSaveMode}
        onUpdateSaveMode={handleUpdateSaveMode}
        onFilesSaved={(savedLocations) => {
          setTransfers((prev) =>
            prev.map((t) => (savedLocations[t.id] ? { ...t, savedLocation: savedLocations[t.id] } : t))
          );
        }}
      />

      {/* Offline PWA Indicator */}
      {!isOnline && (
        <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-xl bg-amber-500 text-slate-950 px-3.5 py-2 text-xs font-bold shadow-xl border border-amber-400 backdrop-blur-sm animate-fade-in">
          <span className="h-2 w-2 rounded-full bg-slate-950 animate-ping" />
          <span>Tryb Offline (PWA) — transfer w lokalnej sieci Wi-Fi/LAN działa bez Internetu!</span>
        </div>
      )}
    </div>
  );
}
