import React, { useState, useEffect } from 'react';
import {
  FolderDown,
  Download,
  CheckCircle2,
  FolderCheck,
  Sparkles,
  FileText,
  Image as ImageIcon,
  Film,
  Music,
  Archive,
  FileCode,
  X,
  Loader2,
  Check,
  AlertCircle,
  Share2
} from 'lucide-react';
import { FileTransfer, ReceiveSaveMode } from '../types';
import { formatBytes } from '../utils/format';
import {
  saveFileToDefaultDownloads,
  isDirectoryPickerSupported,
  promptDirectoryDestination,
  setActiveTransferDestination,
  saveTransferFile,
  getActiveTransferDestination,
  isSubframe,
  isAndroidDevice,
  isWebShareSupported,
  shareFileViaNativeSheet
} from '../utils/fileSaver';

interface ReceiveSaveModalProps {
  isOpen: boolean;
  transfers: FileTransfer[];
  onClose: () => void;
  currentSaveMode: ReceiveSaveMode;
  onUpdateSaveMode: (mode: ReceiveSaveMode) => void;
  onFilesSaved?: (savedLocations: Record<string, string>) => void;
}

export function ReceiveSaveModal({
  isOpen,
  transfers,
  onClose,
  currentSaveMode,
  onUpdateSaveMode,
  onFilesSaved,
}: ReceiveSaveModalProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [chosenLocation, setChosenLocation] = useState<string | null>(null);
  const [savedMap, setSavedMap] = useState<Record<string, string>>({});
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);
  const [saveProgress, setSaveProgress] = useState<{
    current: number;
    total: number;
    fileName: string;
    percent: number;
  } | null>(null);
  const transfersRef = React.useRef(transfers);

  useEffect(() => {
    transfersRef.current = transfers;
  }, [transfers]);

  useEffect(() => {
    if (isOpen) {
      setIsProcessing(false);
      setFeedbackNotice(null);
      setSaveProgress(null);
      const existing = getActiveTransferDestination(transfers[0]?.peerId);
      if (existing) {
        setChosenLocation(existing.name);
      } else {
        setChosenLocation(null);
      }
    }
  }, [isOpen, transfers]);

  if (!isOpen || transfers.length === 0) return null;

  const totalSize = transfers.reduce((acc, t) => acc + (t.fileSize || 0), 0);
  const senderName = transfers[0]?.peerName || 'Urządzenie zdalne';
  const peerId = transfers[0]?.peerId;
  const isDirectorySupported = isDirectoryPickerSupported() && !isSubframe();

  const getFileIcon = (fileName: string, fileType: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'heic'].includes(ext) || fileType.startsWith('image/')) {
      return <ImageIcon className="w-4 h-4 text-cyan-400 shrink-0" />;
    }
    if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext) || fileType.startsWith('video/')) {
      return <Film className="w-4 h-4 text-indigo-400 shrink-0" />;
    }
    if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'].includes(ext) || fileType.startsWith('audio/')) {
      return <Music className="w-4 h-4 text-emerald-400 shrink-0" />;
    }
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
      return <Archive className="w-4 h-4 text-amber-400 shrink-0" />;
    }
    if (['js', 'ts', 'jsx', 'tsx', 'html', 'css', 'json', 'py', 'c', 'cpp'].includes(ext)) {
      return <FileCode className="w-4 h-4 text-purple-400 shrink-0" />;
    }
    return <FileText className="w-4 h-4 text-blue-400 shrink-0" />;
  };

  const isAndroid = isAndroidDevice();
  const canShare = isWebShareSupported();

  // Option: Save all files to default downloads (Download folder)
  const handleSaveToDownloads = async (customLabel = isAndroid ? 'Pamięć telefonu (Pobrane)' : 'Folder Pobrane') => {
    setIsProcessing(true);
    try {
      const activeDest = {
        type: 'downloads' as const,
        name: customLabel,
        peerId,
        createdAt: Date.now(),
      };
      setActiveTransferDestination(activeDest);
      setChosenLocation(customLabel);

      const newSavedMap: Record<string, string> = { ...savedMap };
      const itemsToSave = transfersRef.current && transfersRef.current.length > 0 ? transfersRef.current : transfers;
      // On Android Chrome, multi-download requires ~700ms between triggers so browser queue doesn't discard them
      const downloadDelay = isAndroid ? 700 : 300;

      for (let i = 0; i < itemsToSave.length; i++) {
        const tx = itemsToSave[i];
        setSaveProgress({
          current: i + 1,
          total: itemsToSave.length,
          fileName: tx.fileName,
          percent: Math.round(((i + 1) / itemsToSave.length) * 100),
        });
        if (tx.blob) {
          saveFileToDefaultDownloads(tx.blob, tx.fileName);
        } else if (tx.blobUrl) {
          saveFileToDefaultDownloads(tx.blobUrl, tx.fileName);
        }
        newSavedMap[tx.id] = customLabel;

        if (i < itemsToSave.length - 1) {
          await new Promise((r) => setTimeout(r, downloadDelay));
        }
      }

      setSavedMap(newSavedMap);
      if (onFilesSaved) {
        onFilesSaved(newSavedMap);
      }

      setTimeout(() => {
        onClose();
      }, 1400);
    } catch (err) {
      console.error('Error saving to downloads:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  // Option (Android & Mobile): Share via native Android sheet to Google Drive, Files, WhatsApp, etc.
  const handleShareFiles = async () => {
    setIsProcessing(true);
    try {
      const itemsToSave = transfersRef.current && transfersRef.current.length > 0 ? transfersRef.current : transfers;
      const newSavedMap: Record<string, string> = { ...savedMap };
      for (const tx of itemsToSave) {
        const source = tx.blob || tx.blobUrl;
        if (source) {
          const ok = await shareFileViaNativeSheet(source, tx.fileName);
          if (ok) {
            newSavedMap[tx.id] = 'Zapisano / Udostępniono';
          }
        }
      }
      setSavedMap(newSavedMap);
      if (onFilesSaved) {
        onFilesSaved(newSavedMap);
      }
      setTimeout(() => onClose(), 1200);
    } catch (err) {
      console.warn('Share failed:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  // Option 1: Select directory on disk and save ALL files from this transfer there
  const handleSelectDirectory = async () => {
    setIsProcessing(true);
    setFeedbackNotice(null);

    try {
      const result = await promptDirectoryDestination(peerId);

      if (result.success) {
        const dirName = result.name || 'Wybrany folder';
        const activeDest = {
          type: 'directory' as const,
          handle: result.handle,
          name: dirName,
          peerId,
          createdAt: Date.now(),
        };
        setActiveTransferDestination(activeDest);
        setChosenLocation(dirName);

        const newSavedMap: Record<string, string> = { ...savedMap };
        const itemsToSave = transfersRef.current && transfersRef.current.length > 0 ? transfersRef.current : transfers;

        for (let i = 0; i < itemsToSave.length; i++) {
          const tx = itemsToSave[i];
          setSaveProgress({
            current: i + 1,
            total: itemsToSave.length,
            fileName: tx.fileName,
            percent: Math.round(((i + 1) / itemsToSave.length) * 100),
          });
          const source = tx.blob || tx.blobUrl;
          if (source) {
            const saveRes = await saveTransferFile(activeDest, source, tx.fileName);
            newSavedMap[tx.id] = saveRes.location;
          }
        }

        setSavedMap(newSavedMap);
        if (onFilesSaved) {
          onFilesSaved(newSavedMap);
        }

        setTimeout(() => {
          onClose();
        }, 1400);
        return;
      }

      if (result.cancelled) {
        // User clicked cancel in native OS dialog
        setIsProcessing(false);
        setFeedbackNotice('Anulowano wybór folderu. Możesz kliknąć ponownie lub wybrać zapis w Pobranych.');
        return;
      }

      // If showDirectoryPicker is restricted (iFrame, sandbox, unsupported OS):
      // Automatically and reliably save files to Downloads so user's action always succeeds!
      setFeedbackNotice('W tym oknie przeglądarki pliki zostają automatycznie zapisane do folderu Pobrane.');
      await handleSaveToDownloads('Folder Pobrane');
    } catch (err) {
      console.warn('Fallback to downloads due to:', err);
      await handleSaveToDownloads('Folder Pobrane');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 bg-slate-900/95 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/25 flex items-center justify-center text-cyan-400">
              <FolderDown className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <span>Wybór miejsca zapisu</span>
                <span className="px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-400 text-xs font-mono font-semibold">
                  {transfers.length} {transfers.length === 1 ? 'plik' : 'plików'}
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Od: <strong className="text-slate-300 font-medium">{senderName}</strong> · Łącznie {formatBytes(totalSize)}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
            title="Zamknij (pliki pozostaną w historii)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1">
          {/* Live Saving Progress for Multiple/Large Files */}
          {isProcessing && saveProgress && (
            <div className="p-4 rounded-xl bg-cyan-950/50 border border-cyan-500/40 space-y-2 animate-fade-in shadow-lg">
              <div className="flex items-center justify-between text-xs">
                <span className="text-cyan-300 font-bold flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                  <span>Zapisywanie plików na dysku: {saveProgress.current} z {saveProgress.total}</span>
                </span>
                <span className="font-mono text-cyan-400 font-extrabold text-sm">{saveProgress.percent}%</span>
              </div>
              <div className="w-full h-2.5 rounded-full bg-slate-950 overflow-hidden border border-cyan-900/60 p-0.5">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-150"
                  style={{ width: `${saveProgress.percent}%` }}
                ></div>
              </div>
              <div className="text-[11px] text-slate-400 truncate font-mono">
                Plik: <span className="text-slate-200">{saveProgress.fileName}</span>
              </div>
            </div>
          )}

          {/* Automatic Transfer Guarantee Banner */}
          <div className="p-3.5 rounded-xl bg-cyan-950/40 border border-cyan-500/30 flex items-start gap-3">
            <Sparkles className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
            <div className="text-xs text-slate-300 leading-relaxed">
              <strong className="text-cyan-300 font-semibold block mb-0.5">Automatyczny zapis całego transferu:</strong>
              Wybierz miejsce raz – ten oraz <strong>wszystkie pliki w tym transferze zapiszą się w to miejsce automatycznie</strong> bez ponownych pytań.
            </div>
          </div>

          {/* Feedback notice if cancelled or notice */}
          {feedbackNotice && !chosenLocation && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>{feedbackNotice}</span>
            </div>
          )}

          {/* Success state if location was selected and files are being saved */}
          {chosenLocation && (
            <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-500/40 flex items-center justify-between text-xs animate-fade-in">
              <div className="flex items-center gap-2.5 text-emerald-300 min-w-0">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                <div className="min-w-0">
                  <div className="font-semibold text-emerald-200">
                    Lokalizacja transferu: <span className="font-mono">{chosenLocation}</span>
                  </div>
                  <div className="text-[11px] text-emerald-400/90 truncate">
                    Wszystkie pliki w tym transferze zapisują się w to miejsce automatycznie.
                  </div>
                </div>
              </div>
              <span className="text-[10px] text-emerald-300 font-mono bg-emerald-500/20 px-2 py-0.5 rounded-full shrink-0">
                Zapisano
              </span>
            </div>
          )}

          {/* Selection options */}
          <div className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 px-0.5">
              Gdzie zapisać pliki z tego transferu?
            </div>

            {isAndroid ? (
              <>
                {/* Android Option 1: Direct phone downloads */}
                <div
                  onClick={() => {
                    if (!isProcessing) handleSaveToDownloads('Pamięć telefonu (Pobrane)');
                  }}
                  className={`w-full text-left p-4 rounded-xl border transition-all flex items-start justify-between gap-3 group cursor-pointer active:scale-[0.99] ${
                    chosenLocation === 'Pamięć telefonu (Pobrane)' || chosenLocation === 'Folder Pobrane'
                      ? 'bg-emerald-950/40 border-emerald-500/60 ring-1 ring-emerald-500/30'
                      : 'bg-slate-950/70 hover:bg-slate-900 border-slate-800 hover:border-emerald-500/50'
                  }`}
                >
                  <div className="flex items-start gap-3.5 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-emerald-400 shrink-0 group-hover:scale-105 transition-transform mt-0.5">
                      <Download className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-slate-100">
                          Pamięć telefonu (Folder Pobrane)
                        </span>
                        <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full font-mono font-semibold">
                          Zalecane na Androidzie
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                        Zapisz pliki bezpośrednio w folderze Pobrane (Download). Zdjęcia i filmy pojawią się od razu w Galerii i Menedżerze Plików.
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 mt-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!isProcessing) handleSaveToDownloads('Pamięć telefonu (Pobrane)');
                      }}
                      disabled={isProcessing}
                      className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition-colors shadow-sm block text-center cursor-pointer"
                    >
                      {isProcessing ? 'Zapisywanie...' : 'Zapisz pliki'}
                    </button>
                  </div>
                </div>

                {/* Android Option 2: Native Share / Save Sheet */}
                {canShare && (
                  <div
                    onClick={() => {
                      if (!isProcessing) handleShareFiles();
                    }}
                    className="w-full text-left p-4 rounded-xl border bg-slate-950/70 hover:bg-slate-900 border-slate-800 hover:border-cyan-500/50 transition-all flex items-start justify-between gap-3 group cursor-pointer active:scale-[0.99]"
                  >
                    <div className="flex items-start gap-3.5 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/25 flex items-center justify-center text-cyan-400 shrink-0 group-hover:scale-105 transition-transform mt-0.5">
                        <Share2 className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold text-slate-100">
                            Menu systemowe Androida
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                          Otwórz systemowe menu: zapisz na Dysku Google, w wybranym folderze aplikacji Pliki, Galerii lub wyślij do innej aplikacji.
                        </p>
                      </div>
                    </div>
                    <div className="shrink-0 mt-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!isProcessing) handleShareFiles();
                        }}
                        disabled={isProcessing}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold text-xs transition-colors block text-center cursor-pointer"
                      >
                        {isProcessing ? 'Udostępnianie...' : 'Otwórz menu'}
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                {/* Desktop Option 1: Select directory on disk */}
                <div
                  onClick={() => {
                    if (!isProcessing) handleSelectDirectory();
                  }}
                  className={`w-full text-left p-4 rounded-xl border transition-all flex items-start justify-between gap-3 group cursor-pointer active:scale-[0.99] ${
                    chosenLocation && chosenLocation !== 'Folder Pobrane'
                      ? 'bg-cyan-950/40 border-cyan-500/60 ring-1 ring-cyan-500/30'
                      : 'bg-slate-950/70 hover:bg-slate-900 border-slate-800 hover:border-cyan-500/50'
                  }`}
                >
                  <div className="flex items-start gap-3.5 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/25 flex items-center justify-center text-cyan-400 shrink-0 group-hover:scale-105 transition-transform mt-0.5">
                      <FolderCheck className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-slate-100">
                          Wskaż folder na dysku
                        </span>
                        <span className="text-[10px] bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 px-2 py-0.5 rounded-full font-mono font-semibold">
                          Zalecane
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                        Wskaż dowolny folder (np. Zdjęcia, Dokumenty, Nowy Folder). Wszystkie odebrane i kolejne pliki z tego transferu trafią bezpośrednio do niego.
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 mt-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!isProcessing) handleSelectDirectory();
                      }}
                      disabled={isProcessing}
                      className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs transition-colors shadow-sm block text-center cursor-pointer"
                    >
                      {isProcessing ? 'Zapisywanie...' : 'Wybierz folder'}
                    </button>
                  </div>
                </div>

                {/* Desktop Option 2: Default Downloads folder */}
                <div
                  onClick={() => {
                    if (!isProcessing) handleSaveToDownloads('Folder Pobrane');
                  }}
                  className={`w-full text-left p-4 rounded-xl border transition-all flex items-start justify-between gap-3 group cursor-pointer active:scale-[0.99] ${
                    chosenLocation === 'Folder Pobrane'
                      ? 'bg-emerald-950/40 border-emerald-500/60 ring-1 ring-emerald-500/30'
                      : 'bg-slate-950/70 hover:bg-slate-900 border-slate-800 hover:border-emerald-500/50'
                  }`}
                >
                  <div className="flex items-start gap-3.5 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-emerald-400 shrink-0 group-hover:scale-105 transition-transform mt-0.5">
                      <Download className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-slate-100">
                          Folder Pobrane (Domyślny)
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                        Zapisz ten i wszystkie kolejne pliki z tego transferu bezpośrednio do domyślnego folderu Pobrane w przeglądarce bez pytania o każdy plik.
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 mt-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!isProcessing) handleSaveToDownloads('Folder Pobrane');
                      }}
                      disabled={isProcessing}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold text-xs transition-colors block text-center cursor-pointer"
                    >
                      {isProcessing ? 'Zapisywanie...' : 'Zapisz w Pobranych'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* List of files in this transfer */}
          <div className="space-y-2 pt-1">
            <div className="text-xs font-semibold text-slate-400 flex items-center justify-between">
              <span>Pliki w tym transferze ({transfers.length}):</span>
              <span className="text-[11px] font-mono text-slate-500">{formatBytes(totalSize)}</span>
            </div>

            <div className="max-h-40 overflow-y-auto space-y-1.5 p-2 rounded-xl bg-slate-950/80 border border-slate-800 scrollbar-thin">
              {transfers.map((tx) => {
                const isSaved = Boolean(savedMap[tx.id] || chosenLocation);
                const loc = savedMap[tx.id] || chosenLocation;
                return (
                  <div
                    key={tx.id}
                    className="p-2 rounded-lg bg-slate-900/60 border border-slate-800/80 flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {getFileIcon(tx.fileName, tx.fileType)}
                      <span className="truncate font-medium text-slate-200" title={tx.fileName}>
                        {tx.fileName}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono text-slate-400 text-[11px]">
                        {formatBytes(tx.fileSize)}
                      </span>
                      {isSaved ? (
                        <span className="flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                          <Check className="w-3 h-3" />
                          <span className="truncate max-w-[120px]">{loc}</span>
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-500">Oczekuje na wybór</span>
                      )}

                      {/* Direct single file download button */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          const source = tx.blob || tx.blobUrl;
                          if (source) {
                            saveFileToDefaultDownloads(source, tx.fileName);
                            setSavedMap((prev) => ({ ...prev, [tx.id]: 'Folder Pobrane' }));
                          }
                        }}
                        className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-cyan-300 transition-colors cursor-pointer"
                        title="Pobierz ten pojedynczy plik"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>

                      {canShare && (
                        <button
                          type="button"
                          onClick={async (e) => {
                            e.stopPropagation();
                            const source = tx.blob || tx.blobUrl;
                            if (source) {
                              const ok = await shareFileViaNativeSheet(source, tx.fileName);
                              if (ok) {
                                setSavedMap((prev) => ({ ...prev, [tx.id]: 'Udostępniono' }));
                              }
                            }
                          }}
                          className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-cyan-300 transition-colors cursor-pointer"
                          title="Udostępnij przez Androida"
                        >
                          <Share2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/95 flex items-center justify-between gap-3">
          <div className="text-[11px] text-slate-500">
            {isProcessing ? (
              <span className="flex items-center gap-1.5 text-cyan-400 font-medium">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Pobieranie i zapisywanie plików w toku...</span>
              </span>
            ) : chosenLocation ? (
              <span className="text-emerald-400 flex items-center gap-1 font-medium">
                <Check className="w-3.5 h-3.5" />
                <span>Wszystkie pliki zapisane automatycznie</span>
              </span>
            ) : (
              <span>Kliknij opcję, aby zapisać wszystkie pliki</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors cursor-pointer"
            >
              {chosenLocation ? 'Gotowe' : 'Anuluj'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
