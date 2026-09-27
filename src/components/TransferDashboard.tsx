import { useState } from 'react';
import {
  ArrowUpRight,
  ArrowDownLeft,
  CheckCircle2,
  XCircle,
  Download,
  ShieldCheck,
  Zap,
  Gauge,
  Clock,
  HardDrive,
  Sun,
  FolderDown,
  Eye,
  Check,
  Layers,
  Files,
  RotateCw,
  AlertTriangle,
  Link2,
  ExternalLink,
  Copy,
  Share2
} from 'lucide-react';
import { FileTransfer } from '../types';
import { formatBytes, formatSpeed, formatDuration } from '../utils/format';
import {
  saveFileWithCustomDestination,
  saveFileToDefaultDownloads,
  openFilePreview,
  isSaveFilePickerSupported,
  isDirectoryPickerSupported,
  promptDirectoryDestination,
  saveFileToDirectory,
  setTransferDestinationDirectory,
  getActiveTransferDestination,
  clearActiveTransferDestination,
  isWebShareSupported,
  shareFileViaNativeSheet
} from '../utils/fileSaver';

interface TransferDashboardProps {
  transfers: FileTransfer[];
  onCancelTransfer: (transferId: string) => void;
  onClearCompleted: () => void;
  onOpenSaveOptions?: () => void;
  onRefreshTransfer?: (transferId: string) => void;
  onRefreshAllActive?: () => void;
  refreshingTransferIds?: string[];
}

export function TransferDashboard({
  transfers,
  onCancelTransfer,
  onClearCompleted,
  onOpenSaveOptions,
  onRefreshTransfer,
  onRefreshAllActive,
  refreshingTransferIds = [],
}: TransferDashboardProps) {
  const [savedStatus, setSavedStatus] = useState<Record<string, string>>({});
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);

  const handleCopyLink = async (transferId: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedLinkId(transferId);
      setTimeout(() => {
        setCopiedLinkId(null);
      }, 2500);
    } catch {
      // Fallback
    }
  };

  const handleOpenLink = (url: string) => {
    if (!url) return;
    const safeUrl = /^https?:\/\//i.test(url) ? url : 'https://' + url;
    window.open(safeUrl, '_blank', 'noopener,noreferrer');
  };
  const isPickerSupported = isSaveFilePickerSupported();
  const activeTransfers = transfers.filter(
    (t) => t.status === 'pending' || t.status === 'transferring' || t.status === 'encrypting' || t.status === 'decrypting'
  );
  const completedTransfers = transfers.filter((t) => t.status === 'completed' || t.status === 'error' || t.status === 'cancelled');

  const totalCurrentSpeed = activeTransfers.reduce((acc, t) => acc + (t.currentSpeed || 0), 0);
  const peakObservedSpeed = Math.max(...transfers.map((t) => t.peakSpeed || 0), 0);

  // Batch aggregate statistics across multiple or large transfers
  const totalBatchBytes = transfers.reduce((acc, t) => acc + (t.fileSize || 0), 0);
  const totalTransferredBytes = transfers.reduce((acc, t) => {
    if (t.status === 'completed') return acc + (t.fileSize || 0);
    return acc + (t.bytesTransferred || 0);
  }, 0);
  const overallBatchPercent = totalBatchBytes > 0
    ? Math.min(100, Math.round((totalTransferredBytes / totalBatchBytes) * 100))
    : 0;
  const completedCount = transfers.filter((t) => t.status === 'completed').length;
  const totalRemainingBytes = Math.max(0, totalBatchBytes - totalTransferredBytes);
  const totalBatchEtaSeconds = totalCurrentSpeed > 1000 ? Math.ceil(totalRemainingBytes / totalCurrentSpeed) : 0;
  const isMultipleFiles = transfers.length > 1;
  const isLargeBatch = totalBatchBytes >= 5 * 1024 * 1024;
  const showBatchProgress = activeTransfers.length > 0 && (isMultipleFiles || isLargeBatch);

  const getBlob = async (tx: FileTransfer): Promise<Blob | null> => {
    if (tx.blob) return tx.blob;
    if (tx.blobUrl) {
      try {
        const res = await fetch(tx.blobUrl);
        return await res.blob();
      } catch (err) {
        console.error('Failed to get blob from url:', err);
      }
    }
    return null;
  };

  const handleSaveAs = async (tx: FileTransfer) => {
    // If Directory Picker is supported, prompt destination folder once and save all sibling files from this transfer!
    const dirRes = await promptDirectoryDestination(tx.peerId);
    if (dirRes.success) {
      setTransferDestinationDirectory(dirRes.handle, tx.peerId);
      const blob = await getBlob(tx);
      if (blob) {
        await saveFileToDirectory(dirRes.handle, blob, tx.fileName);
      }
      setSavedStatus((prev) => ({
        ...prev,
        [tx.id]: `Zapisano w ${dirRes.name}`,
      }));

      // Rule: Save all remaining completed receive files from the same transfer in the exact same location!
      const siblingTransfers = transfers.filter(
        (t) =>
          t.direction === 'receive' &&
          t.status === 'completed' &&
          t.id !== tx.id &&
          (!tx.peerId || t.peerId === tx.peerId)
      );

      for (const sibling of siblingTransfers) {
        const sBlob = await getBlob(sibling);
        if (sBlob) {
          await saveFileToDirectory(dirRes.handle, sBlob, sibling.fileName);
          setSavedStatus((prev) => ({
            ...prev,
            [sibling.id]: `Zapisano w ${dirRes.name}`,
          }));
        }
      }
      return;
    }

    const blob = await getBlob(tx);
    if (blob) {
      const res = await saveFileWithCustomDestination({
        blob,
        suggestedName: tx.fileName,
        fileType: tx.fileType
      });
      if (res.success) {
        setSavedStatus((prev) => ({
          ...prev,
          [tx.id]: res.method === 'picker' ? 'Zapisano w folderze' : 'Pobrano'
        }));
      }
    } else if (tx.blobUrl) {
      saveFileToDefaultDownloads(tx.blobUrl, tx.fileName);
      setSavedStatus((prev) => ({ ...prev, [tx.id]: 'Pobrano' }));
    }
  };

  const handleDownload = async (tx: FileTransfer) => {
    const blob = await getBlob(tx);
    saveFileToDefaultDownloads(blob || tx.blobUrl!, tx.fileName);
    setSavedStatus((prev) => ({ ...prev, [tx.id]: 'Pobrano do Pobranych' }));
  };

  const handlePreview = async (tx: FileTransfer) => {
    const blob = await getBlob(tx);
    openFilePreview(blob || tx.blobUrl!);
  };

  const handleShare = async (tx: FileTransfer) => {
    const blob = await getBlob(tx);
    const source = blob || tx.blobUrl;
    if (source) {
      const ok = await shareFileViaNativeSheet(source, tx.fileName);
      if (ok) {
        setSavedStatus((prev) => ({ ...prev, [tx.id]: 'Udostępniono w systemie' }));
      }
    }
  };

  if (transfers.length === 0) {
    return null;
  }

  return (
    <div className="space-y-6">
      {/* Header and Speedometer Banner */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900/90 to-cyan-950/40 border border-slate-800 shadow-xl flex flex-wrap items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-inner">
            <Gauge className="w-7 h-7 animate-pulse" />
          </div>
          <div>
            <div className="text-xs uppercase font-bold tracking-wider text-cyan-400">
              Maksymalna Prędkość Transferu P2P
            </div>
            <div className="text-3xl font-extrabold text-slate-100 font-mono tracking-tight flex items-baseline gap-2">
              <span>{formatSpeed(totalCurrentSpeed)}</span>
              {totalCurrentSpeed > 0 && (
                <span className="text-xs text-emerald-400 font-sans font-medium">
                  Łącze zoptymalizowane
                </span>
              )}
            </div>
            <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-2">
              <span>Szczytowa prędkość: <strong className="text-slate-200 font-mono">{formatSpeed(peakObservedSpeed)}</strong></span>
              <span>·</span>
              <span>Aktywne transfery: <strong className="text-cyan-400">{activeTransfers.length}</strong></span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {activeTransfers.length > 0 && onRefreshAllActive && (
            <button
              type="button"
              onClick={onRefreshAllActive}
              className="text-xs font-semibold text-cyan-300 hover:text-white bg-cyan-950/60 hover:bg-cyan-900/60 border border-cyan-500/40 px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer active:scale-95 shadow-sm"
              title="Odśwież aktywne transfery: resetuje kanały WebRTC i wznawia przesyłanie plików"
            >
              <RotateCw className={`w-3.5 h-3.5 ${refreshingTransferIds.length > 0 ? 'animate-spin' : ''}`} />
              <span>Odśwież transfery</span>
            </button>
          )}

          {completedTransfers.length > 0 && (
            <button
              onClick={onClearCompleted}
              className="text-xs text-slate-400 hover:text-slate-200 transition-colors px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700/80"
            >
              Wyczyść ukończone ({completedTransfers.length})
            </button>
          )}
        </div>
      </div>

      {/* Active Keep-Alive & Anti-Sleep Protection Banner */}
      {activeTransfers.length > 0 && (
        <div className="p-4 rounded-2xl bg-amber-950/20 border border-amber-500/30 flex items-center justify-between gap-4 shadow-lg shadow-amber-950/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
              <Sun className="w-5 h-5 animate-spin [animation-duration:12s]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-xs sm:text-sm text-amber-300">
                  Ochrona ciągłości transferu aktywna
                </span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-500/20 border border-amber-500/40 text-amber-200 font-semibold">
                  WAKE-LOCK ON
                </span>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-300 mt-0.5">
                Ekran telefonu, tabletu lub laptopa nie wygasi się, a urządzenie nie przejdzie w stan uśpienia aż do ukończenia transferu.
              </p>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900/80 border border-slate-700/80 text-[11px] text-slate-300 font-mono shrink-0">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>SESJA CHRONIONA</span>
          </div>
        </div>
      )}

      {/* Aggregate Batch Progress for Multiple or Large Files */}
      {showBatchProgress && (
        <div className="p-5 rounded-2xl bg-gradient-to-r from-slate-900 via-cyan-950/30 to-slate-900 border border-cyan-500/35 shadow-xl space-y-3 animate-fade-in">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shrink-0 shadow-inner">
                <Layers className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  <span>{isMultipleFiles ? 'Łączny postęp wielu plików' : 'Postęp transferu dużego pliku'}</span>
                  {isMultipleFiles ? (
                    <span className="px-2 py-0.5 rounded-full bg-cyan-500/20 border border-cyan-500/40 text-[11px] font-mono text-cyan-300 font-semibold">
                      {completedCount} z {transfers.length} ukończono
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-[11px] font-mono text-emerald-300 font-semibold">
                      Strumień P2P AES-256
                    </span>
                  )}
                </h4>
                <p className="text-xs text-slate-400 mt-0.5">
                  {formatBytes(totalTransferredBytes)} z {formatBytes(totalBatchBytes)}
                  {isMultipleFiles ? ` · Łącznie ${transfers.length} plików w kolejce` : ' · Bezpośrednia transmisja danych'}
                </p>
              </div>
            </div>

            <div className="text-right">
              <div className="text-xl font-black font-mono text-cyan-400">
                {overallBatchPercent}%
              </div>
              {totalBatchEtaSeconds > 0 && (
                <div className="text-xs text-slate-400 flex items-center gap-1 font-mono justify-end mt-0.5">
                  <Clock className="w-3 h-3 text-slate-500" />
                  <span>Pozostało: {formatDuration(totalBatchEtaSeconds)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Batch Progress Bar */}
          <div className="space-y-1">
            <div className="w-full h-3 rounded-full bg-slate-950 overflow-hidden p-0.5 border border-slate-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-blue-500 to-emerald-400 transition-all duration-200 shadow-md shadow-cyan-500/30"
                style={{ width: `${overallBatchPercent}%` }}
              ></div>
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
              <span>Do przesłania: <strong className="text-slate-200 font-medium">{formatBytes(totalRemainingBytes)}</strong></span>
              <span>Prędkość sumaryczna: <strong className="text-cyan-400 font-bold">{formatSpeed(totalCurrentSpeed)}</strong></span>
            </div>
          </div>

          {/* Stalled transfers notice inside batch */}
          {activeTransfers.some((t) => t.isStalled) && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between gap-3 text-xs text-amber-200 animate-pulse mt-2">
              <div className="flex items-center gap-2 min-w-0">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="truncate sm:whitespace-normal">Wykryto spowolnienie lub zawieszenie transferu. Użyj opcji <strong>Odśwież</strong>, aby udrożnić połączenie.</span>
              </div>
              {onRefreshAllActive && (
                <button
                  type="button"
                  onClick={onRefreshAllActive}
                  className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold shrink-0 transition-colors cursor-pointer flex items-center gap-1.5 shadow-sm text-xs"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  <span>Odśwież teraz</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Active Transfers */}
      {activeTransfers.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
              <Zap className="w-4 h-4 text-cyan-400 animate-bounce" />
              <span>Trwające Transfery ({activeTransfers.length})</span>
            </h3>

            {onRefreshAllActive && (
              <button
                type="button"
                onClick={onRefreshAllActive}
                className="px-2.5 py-1 rounded-lg bg-slate-800/90 hover:bg-slate-700/90 border border-slate-700 text-slate-300 hover:text-white text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer"
                title="Odśwież i zresetuj kanały dla wszystkich aktywnych transferów"
              >
                <RotateCw className={`w-3.5 h-3.5 ${refreshingTransferIds.length > 0 ? 'animate-spin' : ''}`} />
                <span>Odśwież wszystkie</span>
              </button>
            )}
          </div>

          <div className="space-y-3">
            {activeTransfers.map((tx) => {
              const isSending = tx.direction === 'send';
              const isStalled = tx.isStalled || false;
              const isRefreshing = refreshingTransferIds.includes(tx.id);

              return (
                <div
                  key={tx.id}
                  className={`p-5 rounded-2xl bg-slate-900 border transition-all duration-200 shadow-lg space-y-4 ${
                    isStalled ? 'border-amber-500/40 bg-amber-950/15 shadow-amber-500/10' : 'border-slate-800'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                          isSending
                            ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                            : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        }`}
                      >
                        {isSending ? (
                          <ArrowUpRight className="w-5 h-5" />
                        ) : (
                          <ArrowDownLeft className="w-5 h-5" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-slate-100 text-sm flex flex-wrap items-center gap-1.5 min-w-0">
                          {tx.isLink && <Link2 className="w-4 h-4 text-emerald-400 shrink-0" />}
                          <span className="truncate max-w-[200px] sm:max-w-xs md:max-w-md">{tx.linkTitle || tx.fileName}</span>
                          <span className="text-[10px] text-slate-400 bg-slate-800 px-2 py-0.5 rounded font-mono shrink-0 whitespace-nowrap">
                            {tx.isLink ? 'LINK URL' : formatBytes(tx.fileSize)}
                          </span>
                          {isStalled && (
                            <span className="text-[10px] font-mono text-amber-300 bg-amber-500/20 border border-amber-500/40 px-2 py-0.5 rounded flex items-center gap-1 font-semibold animate-pulse shrink-0 whitespace-nowrap">
                              <AlertTriangle className="w-3 h-3 text-amber-400" />
                              Zawieszony (&gt;7s)
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-400 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-1 min-w-0">
                          <span className="whitespace-nowrap">{isSending ? 'Wysyłanie do:' : 'Odbieranie od:'}</span>
                          <strong className="text-slate-300 whitespace-nowrap">{tx.peerName}</strong>
                          {tx.linkUrl && (
                            <>
                              <span>·</span>
                              <span className="text-emerald-400 truncate max-w-[180px] sm:max-w-xs font-mono">
                                {tx.linkUrl}
                              </span>
                            </>
                          )}
                          <span>·</span>
                          <span className="text-emerald-400 flex items-center gap-1 whitespace-nowrap">
                            <ShieldCheck className="w-3 h-3" />
                            AES-256-GCM
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      {tx.status === 'pending' ? (
                        <div className="text-xs font-semibold text-amber-400/90 font-mono bg-amber-500/10 border border-amber-500/20 px-2 py-1 rounded-lg">
                          W kolejce...
                        </div>
                      ) : (
                        <>
                          <div className={`text-sm font-extrabold font-mono ${isStalled ? 'text-amber-400' : 'text-cyan-400'}`}>
                            {formatSpeed(tx.currentSpeed)}
                          </div>
                          <div className="text-xs text-slate-400 flex items-center gap-1 mt-0.5 justify-end">
                            <Clock className="w-3 h-3 text-slate-500" />
                            <span>ETA: {formatDuration(tx.etaSeconds)}</span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="space-y-1.5">
                    <div className="w-full h-2.5 rounded-full bg-slate-950 overflow-hidden p-0.5 border border-slate-800">
                      {tx.status === 'pending' ? (
                        <div className="h-full rounded-full bg-amber-500/30 w-full animate-pulse"></div>
                      ) : (
                        <div
                          className={`h-full rounded-full transition-all duration-150 ${
                            isStalled
                              ? 'bg-gradient-to-r from-amber-500 to-rose-400'
                              : 'bg-gradient-to-r from-cyan-500 to-emerald-400'
                          }`}
                          style={{ width: `${tx.progress}%` }}
                        ></div>
                      )}
                    </div>

                    <div className="flex items-center justify-between text-xs text-slate-400 flex-wrap gap-2">
                      <span className="font-mono">
                        {tx.status === 'pending'
                          ? `Oczekuje na transfer (${formatBytes(tx.fileSize)})`
                          : `${formatBytes(tx.bytesTransferred)} / ${formatBytes(tx.fileSize)} (${tx.progress}%)`}
                      </span>
                      <div className="flex items-center gap-2 sm:gap-3">
                        <span className="text-[11px] text-slate-500 font-mono hidden sm:inline">
                          {tx.status === 'pending'
                            ? `Pakiety: 0 / ${tx.chunksTotal}`
                            : `Pakiety: ${tx.chunksCompleted} / ${tx.chunksTotal}`}
                        </span>

                        {onRefreshTransfer && (
                          <button
                            type="button"
                            onClick={() => onRefreshTransfer(tx.id)}
                            disabled={isRefreshing}
                            className={`px-2.5 py-1 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer active:scale-95 ${
                              isStalled
                                ? 'bg-amber-500 text-slate-950 border-amber-400 hover:bg-amber-400 font-bold shadow-md shadow-amber-500/20'
                                : 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30 hover:bg-cyan-500/25'
                            }`}
                            title="Odśwież transfer: resetuje kanał P2P, wznawia transfer i naprawia zawieszenie"
                          >
                            <RotateCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-slate-950' : ''}`} />
                            <span>{isRefreshing ? 'Wznawianie...' : isStalled ? 'Odśwież i wznów' : 'Odśwież'}</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => onCancelTransfer(tx.id)}
                          className="text-slate-400 hover:text-rose-400 text-xs transition-colors px-2 py-1 rounded hover:bg-slate-800/60 cursor-pointer"
                        >
                          Anuluj
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Completed Transfers */}
      {completedTransfers.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Historia Transferów ({completedTransfers.length})</span>
            </h3>

            <div className="flex items-center gap-2">
              {onOpenSaveOptions && completedTransfers.some((t) => t.direction === 'receive' && (t.blob || t.blobUrl)) && (
                <button
                  type="button"
                  onClick={onOpenSaveOptions}
                  className="px-2.5 py-1 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-300 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                  title="Otwórz okno wyboru zapisu dla odebranych plików"
                >
                  <FolderDown className="w-3.5 h-3.5" />
                  <span>Opcje zapisu plików</span>
                </button>
              )}

              {onClearCompleted && (
                <button
                  type="button"
                  onClick={onClearCompleted}
                  className="text-xs text-slate-500 hover:text-slate-300 px-2 py-1 rounded hover:bg-slate-800/60 transition-colors cursor-pointer"
                >
                  Wyczyść historię
                </button>
              )}
            </div>
          </div>

          <div className="space-y-2">
            {completedTransfers.map((tx) => {
              const isSending = tx.direction === 'send';
              const isSuccess = tx.status === 'completed';

              return (
                <div
                  key={tx.id}
                  className="p-3.5 rounded-2xl bg-slate-900/60 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div
                      className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                        isSuccess
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : 'bg-rose-500/10 text-rose-400'
                      }`}
                    >
                      {isSuccess ? (
                        <CheckCircle2 className="w-4 h-4" />
                      ) : (
                        <XCircle className="w-4 h-4" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-slate-200 truncate flex items-center gap-2">
                        {tx.isLink && <Link2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                        <span className="truncate">{tx.linkTitle || tx.fileName}</span>
                        <span className="text-slate-500 font-mono text-[11px] shrink-0">
                          {tx.isLink ? 'LINK URL' : `(${formatBytes(tx.fileSize)})`}
                        </span>
                      </div>
                      <div className="text-slate-400 text-[11px] flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                        <span>{isSending ? `Wysłano do: ${tx.peerName}` : `Odebrano od: ${tx.peerName}`}</span>
                        {tx.linkUrl && (
                          <>
                            <span>·</span>
                            <span className="text-emerald-400 truncate max-w-[200px] sm:max-w-xs font-mono">
                              {tx.linkUrl}
                            </span>
                          </>
                        )}
                        <span>·</span>
                        {savedStatus[tx.id] || tx.savedLocation ? (
                          <span className="text-emerald-400 flex items-center gap-1 font-medium truncate max-w-[240px]">
                            <Check className="w-3 h-3 shrink-0" />
                            <span className="truncate">{savedStatus[tx.id] || `Zapisano w: ${tx.savedLocation}`}</span>
                          </span>
                        ) : (
                          <span className="text-cyan-400">
                            {isSending ? 'Wysłano pomyślnie' : 'Odebrano (P2P)'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-800/80 w-full sm:w-auto justify-end">
                    {/* For Links: Direct Open & Copy buttons */}
                    {tx.linkUrl && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleOpenLink(tx.linkUrl!)}
                          className="px-2.5 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 transition-colors flex items-center gap-1.5 font-semibold cursor-pointer active:scale-95 text-xs border border-emerald-500/30 shadow-sm"
                          title="Otwórz ten link w nowej karcie"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          <span>Otwórz link</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleCopyLink(tx.id, tx.linkUrl!)}
                          className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors flex items-center gap-1.5 font-medium cursor-pointer active:scale-95 text-xs border border-slate-700"
                          title="Kopiuj link do schowka"
                        >
                          {copiedLinkId === tx.id ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                              <span className="text-emerald-300 font-medium">Skopiowano!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5 text-slate-400" />
                              <span>Kopiuj</span>
                            </>
                          )}
                        </button>
                      </>
                    )}

                    {!isSuccess && onRefreshTransfer && (
                      <button
                        type="button"
                        onClick={() => onRefreshTransfer(tx.id)}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors flex items-center gap-1.5 font-medium cursor-pointer active:scale-95 text-xs border border-slate-700 hover:border-slate-600"
                        title="Spróbuj przesłać ten plik ponownie"
                      >
                        <RotateCw className="w-3.5 h-3.5 text-cyan-400" />
                        <span>Ponów</span>
                      </button>
                    )}

                    {(tx.blobUrl || tx.blob) && !tx.isLink && (
                      <>
                        {/* Option 1: Save As with folder picker */}
                        <button
                          type="button"
                          onClick={() => handleSaveAs(tx)}
                          className="px-2.5 py-1.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-300 transition-colors flex items-center gap-1.5 font-medium cursor-pointer active:scale-95 text-xs shadow-sm"
                          title="Wskaż dokładny folder na dysku (Dokumenty, Pulpit, Dysk zewnętrzny)"
                        >
                          <FolderDown className="w-3.5 h-3.5 text-cyan-400" />
                          <span>Zapisz jako...</span>
                        </button>

                        {/* Option 2: Direct download to Downloads */}
                        <button
                          type="button"
                          onClick={() => handleDownload(tx)}
                          className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors flex items-center gap-1.5 font-medium cursor-pointer active:scale-95 text-xs"
                          title="Pobierz natychmiast do domyślnego folderu Pobrane"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">Pobierz</span>
                        </button>

                        {/* Option 3: Android / Native Web Share */}
                        {isWebShareSupported() && (
                          <button
                            type="button"
                            onClick={() => handleShare(tx)}
                            className="p-1.5 sm:px-2 sm:py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors flex items-center gap-1.5 font-medium cursor-pointer active:scale-95 text-xs"
                            title="Udostępnij / Zapisz przez menu Androida (Dysk Google, Pliki, Galeria, WhatsApp)"
                          >
                            <Share2 className="w-3.5 h-3.5 text-cyan-400" />
                            <span className="hidden md:inline">Udostępnij</span>
                          </button>
                        )}

                        {/* Option 4: Preview */}
                        <button
                          type="button"
                          onClick={() => handlePreview(tx)}
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                          title="Otwórz podgląd pliku w przeglądarce"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
