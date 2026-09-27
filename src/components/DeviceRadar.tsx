import React, { useState, useEffect, useRef } from 'react';
import {
  Laptop,
  Smartphone,
  Tablet,
  Send,
  Copy,
  Check,
  Edit2,
  RefreshCw,
  Hash,
  Upload,
  Wifi
} from 'lucide-react';
import { PeerDevice, DeviceType } from '../types';
import { extractFilesFromDataTransfer, processFileListWithProgress, FileLoadProgress } from '../utils/fileExtractor';
import { formatBytes } from '../utils/format';
import { FileLoadingOverlay } from './FileLoadingOverlay';

interface DeviceRadarProps {
  localPeer: PeerDevice;
  peers: PeerDevice[];
  onSelectPeerToSend: (peer: PeerDevice) => void;
  onDropFilesOnPeer: (peer: PeerDevice, files: File[]) => void;
  onUpdateLocalName?: (newName: string) => void;
  onReannounce?: () => void;
  onPairByCode?: (code: string) => void;
}

export function DeviceRadar({
  localPeer,
  peers,
  onSelectPeerToSend,
  onDropFilesOnPeer,
  onUpdateLocalName,
  onReannounce,
  onPairByCode
}: DeviceRadarProps) {
  const [dragOverPeerId, setDragOverPeerId] = useState<string | null>(null);
  const [isDropZoneActive, setIsDropZoneActive] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [customName, setCustomName] = useState(localPeer.name);
  const [isPinCopied, setIsPinCopied] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isExtractingFiles, setIsExtractingFiles] = useState(false);
  const [extractProgress, setExtractProgress] = useState<FileLoadProgress | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Sync customName if localPeer.name changes from outside
  useEffect(() => {
    setCustomName(localPeer.name);
  }, [localPeer.name]);

  // Strictly deduplicated peers list to ensure no device is ever displayed twice
  const deduplicatedPeers = React.useMemo(() => {
    const list: PeerDevice[] = [];
    const seen = new Set<string>();

    for (const p of peers) {
      if (!p || !p.id) continue;
      // Filter out self
      if (p.id === localPeer.id) continue;
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      list.push(p);
    }
    return list;
  }, [peers, localPeer.id]);

  const getDeviceIcon = (type: DeviceType, className = 'w-6 h-6') => {
    switch (type) {
      case 'phone':
        return <Smartphone className={className} />;
      case 'tablet':
        return <Tablet className={className} />;
      case 'laptop':
      case 'desktop':
      default:
        return <Laptop className={className} />;
    }
  };

  // Deterministic stable coordinates for discovered devices on radar screen
  const getRadarCoordinates = (_peerId: string, idx: number, total: number) => {
    // Distribute angles evenly around radar with an angular offset away from top/bottom center text
    const angleStep = 360 / Math.max(1, total);
    // Start at 38° so blips sit naturally in diagonal quadrants rather than directly top or bottom
    const finalAngleDeg = (38 + idx * angleStep) % 360;
    const rad = (finalAngleDeg * Math.PI) / 180;

    // Radius safely inside radar screen boundaries (never clipped)
    const radius = total === 1 ? 92 : (total === 2 ? 88 : 82);

    const x = Math.round(Math.cos(rad) * radius);
    const y = Math.round(Math.sin(rad) * radius);

    return { x, y, angle: finalAngleDeg };
  };

  const handleDragOverPeer = (e: React.DragEvent, peerId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverPeerId(peerId);
  };

  const handleDragLeavePeer = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverPeerId(null);
  };

  const handleDropOnPeer = async (e: React.DragEvent, peer: PeerDevice) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverPeerId(null);
    setIsExtractingFiles(true);
    try {
      const files = await extractFilesFromDataTransfer(e.dataTransfer, (prog) => {
        setExtractProgress(prog);
      });
      if (files && files.length > 0) {
        onDropFilesOnPeer(peer, files);
      }
    } catch {
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        onDropFilesOnPeer(peer, Array.from(e.dataTransfer.files));
      }
    } finally {
      setTimeout(() => {
        setIsExtractingFiles(false);
        setExtractProgress(null);
      }, 300);
    }
  };

  const handleGeneralDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDropZoneActive(false);
    const target = deduplicatedPeers.length > 0 ? deduplicatedPeers[0] : localPeer;
    setIsExtractingFiles(true);
    try {
      const files = await extractFilesFromDataTransfer(e.dataTransfer, (prog) => {
        setExtractProgress(prog);
      });
      if (files && files.length > 0) {
        onDropFilesOnPeer(target, files);
      }
    } catch {
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        onDropFilesOnPeer(target, Array.from(e.dataTransfer.files));
      }
    } finally {
      setTimeout(() => {
        setIsExtractingFiles(false);
        setExtractProgress(null);
      }, 300);
    }
  };

  const copyPairCode = () => {
    if (localPeer.pairCode) {
      navigator.clipboard.writeText(localPeer.pairCode);
      setIsPinCopied(true);
      setTimeout(() => setIsPinCopied(false), 2000);
    }
  };

  const handleSaveName = () => {
    setIsEditingName(false);
    if (customName.trim() && onUpdateLocalName) {
      onUpdateLocalName(customName.trim());
    }
  };

  const handleManualRefresh = () => {
    setIsRefreshing(true);
    if (onReannounce) onReannounce();
    setTimeout(() => setIsRefreshing(false), 800);
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const target = deduplicatedPeers.length > 0 ? deduplicatedPeers[0] : localPeer;
      const incoming = e.target.files;
      setIsExtractingFiles(true);
      try {
        const processed = await processFileListWithProgress(incoming, (prog) => {
          setExtractProgress(prog);
        });
        if (processed && processed.length > 0) {
          onDropFilesOnPeer(target, processed);
        }
      } catch (err) {
        console.error('Error loading files in radar:', err);
        onDropFilesOnPeer(target, Array.from(incoming));
      } finally {
        setTimeout(() => {
          setIsExtractingFiles(false);
          setExtractProgress(null);
        }, 300);
      }
      e.target.value = '';
    }
  };

  const handleFolderInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const target = deduplicatedPeers.length > 0 ? deduplicatedPeers[0] : localPeer;
      const incoming = e.target.files;
      setIsExtractingFiles(true);
      try {
        const processed = await processFileListWithProgress(incoming, (prog) => {
          setExtractProgress(prog);
        });
        if (processed && processed.length > 0) {
          onDropFilesOnPeer(target, processed);
        }
      } catch (err) {
        console.error('Error loading folder files in radar:', err);
        onDropFilesOnPeer(target, Array.from(incoming));
      } finally {
        setTimeout(() => {
          setIsExtractingFiles(false);
          setExtractProgress(null);
        }, 300);
      }
      e.target.value = '';
    }
  };

  return (
    <div className="w-full">
      {/* Hidden file & folder inputs for general dropzone */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileInputChange}
        multiple
        className="hidden"
        tabIndex={-1}
      />
      <input
        type="file"
        ref={folderInputRef}
        onChange={handleFolderInputChange}
        multiple
        {...({ webkitdirectory: '', directory: '' } as any)}
        className="hidden"
        tabIndex={-1}
      />

      {/* Main 2-Column Responsive Layout for Screen Width */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN (5 of 12 cols on desktop): Radar & This Device */}
        <div className="lg:col-span-5 space-y-4">
          {/* Radar Container */}
          <div className="rounded-3xl bg-slate-900/90 border border-slate-800 p-5 shadow-xl relative overflow-hidden flex flex-col items-center">
            {/* Top Bar inside Radar Card */}
            <div className="w-full flex items-center justify-between mb-3 px-1">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
                </span>
                <span className="text-xs font-bold text-slate-200 uppercase tracking-wider font-mono">
                  RADAR P2P
                </span>
                <span className="text-[10px] text-cyan-400/80 font-mono hidden sm:inline">
                  [LAN MESH]
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-slate-400">
                  {peers.length} {peers.length === 1 ? 'w zasięgu' : 'w zasięgu'}
                </span>
                <button
                  onClick={handleManualRefresh}
                  disabled={isRefreshing}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                  title="Wymuś odświeżenie listy urządzeń"
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${isRefreshing ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {/* Radar Circle Screen (High-tech HUD) */}
            <div className="relative w-72 h-72 sm:w-80 sm:h-80 rounded-full border border-cyan-500/30 bg-slate-950/95 flex items-center justify-center overflow-hidden my-1 shadow-[0_0_50px_-12px_rgba(6,182,212,0.25)] select-none">
              {/* Outer compass degree markers */}
              <span className="absolute top-1.5 text-[9px] font-mono font-bold text-cyan-500/70 tracking-widest pointer-events-none">
                000° N
              </span>
              <span className="absolute bottom-1.5 text-[9px] font-mono font-bold text-cyan-500/70 tracking-widest pointer-events-none">
                180° S
              </span>
              <span className="absolute right-2 text-[9px] font-mono font-bold text-cyan-500/70 tracking-widest pointer-events-none">
                090°
              </span>
              <span className="absolute left-2 text-[9px] font-mono font-bold text-cyan-500/70 tracking-widest pointer-events-none">
                270°
              </span>

              {/* Concentric Telemetry Rings (High-precision SVG) */}
              <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 320 320">
                {/* Diagonal lines */}
                <line x1="32" y1="32" x2="288" y2="288" stroke="rgba(6, 182, 212, 0.08)" strokeWidth="1" strokeDasharray="2 4" />
                <line x1="288" y1="32" x2="32" y2="288" stroke="rgba(6, 182, 212, 0.08)" strokeWidth="1" strokeDasharray="2 4" />
                
                {/* Crosshairs */}
                <line x1="0" y1="160" x2="320" y2="160" stroke="rgba(6, 182, 212, 0.15)" strokeWidth="1" />
                <line x1="160" y1="0" x2="160" y2="320" stroke="rgba(6, 182, 212, 0.15)" strokeWidth="1" />

                {/* Range Rings */}
                <circle cx="160" cy="160" r="140" fill="none" stroke="rgba(6, 182, 212, 0.2)" strokeWidth="1" strokeDasharray="4 6" />
                <circle cx="160" cy="160" r="105" fill="none" stroke="rgba(6, 182, 212, 0.18)" strokeWidth="1" />
                <circle cx="160" cy="160" r="70" fill="none" stroke="rgba(6, 182, 212, 0.22)" strokeWidth="1" strokeDasharray="2 4" />
                <circle cx="160" cy="160" r="35" fill="none" stroke="rgba(6, 182, 212, 0.28)" strokeWidth="1" />
              </svg>

              {/* Sonar Acoustic Pulse Wave 1 */}
              <div className="absolute w-24 h-24 rounded-full border border-cyan-400/40 animate-sonar-1 pointer-events-none" />
              {/* Sonar Acoustic Pulse Wave 2 */}
              <div className="absolute w-24 h-24 rounded-full border border-cyan-400/25 animate-sonar-2 pointer-events-none" />

              {/* Continuous Smooth 360° Conic Sweep Needle */}
              <div className="absolute inset-0 rounded-full radar-sweep-cone animate-radar-sweep pointer-events-none" />

              {/* Local Device in Center */}
              <div className="relative z-10 flex flex-col items-center pointer-events-none">
                <div className="relative w-10 h-10 rounded-2xl bg-gradient-to-br from-cyan-400 to-cyan-600 text-slate-950 flex items-center justify-center shadow-lg shadow-cyan-500/50 border-2 border-cyan-200">
                  {getDeviceIcon(localPeer.deviceType, 'w-5 h-5')}
                  {/* Glowing center indicator */}
                  <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-slate-950 shadow-sm"></span>
                </div>
                <span className="text-[9px] font-bold text-cyan-300 mt-1 bg-slate-950/90 px-2 py-0.5 rounded-full border border-cyan-500/40 shadow-md whitespace-nowrap">
                  To urządzenie
                </span>
              </div>

              {/* Discovered Peers with Stable Radial Placement & Sonar Blip */}
              {deduplicatedPeers.map((peer, idx) => {
                const { x, y } = getRadarCoordinates(peer.id, idx, deduplicatedPeers.length);

                return (
                  <div
                    key={peer.id}
                    style={{
                      position: 'absolute',
                      top: '50%',
                      left: '50%',
                      transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`,
                      transition: 'transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1)'
                    }}
                    className="z-20 flex flex-col items-center group cursor-pointer"
                    onClick={() => onSelectPeerToSend(peer)}
                    onDragOver={(e) => handleDragOverPeer(e, peer.id)}
                    onDragLeave={handleDragLeavePeer}
                    onDrop={(e) => handleDropOnPeer(e, peer)}
                    title={`Kliknij, aby wysłać do: ${peer.name}`}
                  >
                    {/* Discovered Sonar Blip Pulse Ring */}
                    <div className="relative w-10 h-10 rounded-xl bg-slate-900 border-2 border-emerald-400 text-emerald-400 flex items-center justify-center shadow-lg group-hover:scale-115 group-hover:border-cyan-400 group-hover:text-cyan-400 transition-all animate-blip">
                      {getDeviceIcon(peer.deviceType, 'w-5 h-5')}
                      <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-slate-950"></span>
                    </div>
                    <span className="text-[9px] font-semibold text-slate-100 mt-1 px-1.5 py-0.5 rounded-md bg-slate-950/95 border border-slate-800 truncate max-w-[76px] shadow-sm group-hover:border-cyan-500/60 whitespace-nowrap">
                      {peer.name}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Local Device Identity Box */}
            <div className="w-full mt-4 p-4 rounded-2xl bg-slate-950/70 border border-slate-800">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0">
                    {getDeviceIcon(localPeer.deviceType, 'w-5 h-5')}
                  </div>
                  <div className="min-w-0 flex-1">
                    {isEditingName ? (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <input
                          type="text"
                          value={customName}
                          onChange={(e) => setCustomName(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
                          className="bg-slate-900 border border-cyan-500 rounded px-2 py-0.5 text-xs text-white focus:outline-none w-36"
                          autoFocus
                        />
                        <button
                          onClick={handleSaveName}
                          className="px-2 py-0.5 bg-cyan-500 text-slate-950 text-xs rounded font-bold cursor-pointer"
                        >
                          OK
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-xs font-bold text-white truncate max-w-[160px] sm:max-w-xs">
                          {localPeer.name}
                        </span>
                        <button
                          onClick={() => setIsEditingName(true)}
                          className="text-slate-500 hover:text-cyan-400 transition-colors shrink-0 cursor-pointer p-0.5"
                          title="Edytuj nazwę urządzenia"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                    <div className="text-[11px] text-slate-400 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="text-slate-300 font-medium truncate max-w-[130px] sm:max-w-none">
                        {localPeer.modelDetails || localPeer.os}
                      </span>
                      <span>·</span>
                      <span className="text-cyan-400 font-mono shrink-0">{localPeer.ip}</span>
                    </div>
                  </div>
                </div>

                {/* PIN Code badge */}
                {localPeer.pairCode && (
                  <button
                    onClick={copyPairCode}
                    className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center hover:opacity-80 transition-opacity shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-800/80 sm:border-none w-full sm:w-auto cursor-pointer"
                    title="Kliknij, aby skopiować swój 4-cyfrowy PIN"
                  >
                    <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">Twój PIN</span>
                    <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-mono text-xs font-bold">
                      <Hash className="w-3 h-3" />
                      <span>{localPeer.pairCode}</span>
                      {isPinCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-2.5 h-2.5 text-slate-400" />}
                    </div>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN (7 of 12 cols on desktop): Device List & Sending Operations */}
        <div className="lg:col-span-7 space-y-4">
          {/* Header of Device List */}
          <div className="p-4 rounded-3xl bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="text-sm font-bold text-white">
                Dostępne Urządzenia
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 text-xs font-mono font-bold">
                {deduplicatedPeers.length}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400 hidden sm:inline">
                {deduplicatedPeers.length > 0 ? 'Wybierz urządzenie, aby przesłać plik' : 'Skanowanie sieci...'}
              </span>
              <button
                onClick={handleManualRefresh}
                disabled={isRefreshing}
                title="Wyszukaj wszystkie dostępne urządzenia w sieci"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 border border-slate-700/80 text-xs font-semibold text-cyan-400 transition-all cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                <span>{isRefreshing ? 'Wykrywanie...' : 'Skanuj'}</span>
              </button>
            </div>
          </div>

          {/* List of Discovered Peers */}
          {deduplicatedPeers.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {deduplicatedPeers.map((peer) => {
                const isDragOver = dragOverPeerId === peer.id;

                return (
                  <div
                    key={peer.id}
                    onDragOver={(e) => handleDragOverPeer(e, peer.id)}
                    onDragLeave={handleDragLeavePeer}
                    onDrop={(e) => handleDropOnPeer(e, peer)}
                    className={`p-4 rounded-3xl bg-slate-900/90 border transition-all duration-200 flex flex-col justify-between ${
                      isDragOver
                        ? 'border-cyan-400 bg-cyan-950/40 scale-[1.02] shadow-xl shadow-cyan-500/25 ring-2 ring-cyan-400/50'
                        : 'border-slate-800 hover:border-slate-700 shadow-md'
                    }`}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-2.5">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                            {getDeviceIcon(peer.deviceType, 'w-5 h-5')}
                          </div>
                          <div className="min-w-0">
                            <h3 className="text-xs font-bold text-white truncate">
                              {peer.name}
                            </h3>
                            <div className="text-[11px] text-slate-400 mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                              <span className="text-slate-300 font-medium">{peer.modelDetails || peer.os}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 text-[10px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full shrink-0">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                          <span>Gotowy</span>
                        </div>
                      </div>

                      {/* Precise Device Specs Tags */}
                      <div className="flex flex-wrap items-center gap-1 text-[10px] text-slate-400 mb-2.5">
                        <span className="px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 font-mono text-cyan-300">
                          {peer.ip}
                        </span>
                        {peer.pairCode && (
                          <span className="px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 font-mono text-emerald-400">
                            PIN: #{peer.pairCode}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="pt-2.5 border-t border-slate-800/80 mt-1">
                      <button
                        onClick={() => onSelectPeerToSend(peer)}
                        className={`w-full py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                          isDragOver
                            ? 'bg-cyan-400 text-slate-950 shadow-lg'
                            : 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-md shadow-cyan-500/20'
                        }`}
                      >
                        <Send className="w-3.5 h-3.5 shrink-0" />
                        <span>{isDragOver ? 'Upuść tutaj!' : 'Wyślij na to urządzenie'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          {/* Dedicated Fast Drop Zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDropZoneActive(true);
            }}
            onDragLeave={() => setIsDropZoneActive(false)}
            onDrop={handleGeneralDrop}
            className={`p-6 rounded-3xl border-2 border-dashed transition-all flex flex-col items-center justify-center text-center ${
              isDropZoneActive
                ? 'border-cyan-400 bg-cyan-950/30 scale-[1.01]'
                : 'border-slate-800 hover:border-slate-700 bg-slate-900/60'
            }`}
          >
            <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 mb-3 shadow-inner">
              <Upload className="w-6 h-6 animate-bounce" />
            </div>
            <h4 className="text-sm font-bold text-white">
              Przeciągnij i upuść pliki tutaj
            </h4>
            <p className="text-xs text-slate-400 mt-1 max-w-sm">
              Obsługa pojedynczych plików oraz całych folderów bez limitu wielkości.
            </p>
          </div>

          {/* When 0 peers: Clean Status */}
          {peers.length === 0 && (
            <div className="p-8 rounded-3xl bg-slate-900/70 border border-slate-800 text-center space-y-3 shadow-xl">
              <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center mx-auto">
                <Wifi className="w-6 h-6 animate-pulse" />
              </div>
              <h4 className="text-sm font-bold text-white">
                Brak innych urządzeń w sieci
              </h4>
              <p className="text-xs text-slate-400 max-w-sm mx-auto leading-relaxed">
                Radar aktywnie przeszukuje sieć Wi-Fi / LAN. Użyj przycisku <strong className="text-cyan-300 font-semibold">„Połącz”</strong> na górnej belce, aby połączyć drugi telefon lub komputer.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* File extraction / loading progress overlay */}
      <FileLoadingOverlay
        isOpen={isExtractingFiles}
        progress={extractProgress}
        title="Wczytywanie i przygotowywanie plików..."
        onCancel={() => {
          setIsExtractingFiles(false);
          setExtractProgress(null);
        }}
      />
    </div>
  );
}
