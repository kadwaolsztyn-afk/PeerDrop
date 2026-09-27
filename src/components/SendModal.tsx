import React, { useState, useRef, useEffect } from 'react';
import {
  UploadCloud,
  File as FileIcon,
  FolderPlus,
  Plus,
  Trash2,
  X,
  Zap,
  Layers,
  HardDrive,
  Laptop,
  Smartphone,
  CheckCircle2,
  AlertCircle,
  Link2,
  Globe,
  Clipboard,
  ExternalLink
} from 'lucide-react';
import { PeerDevice } from '../types';
import { formatBytes } from '../utils/format';
import {
  extractFilesFromDataTransfer,
  processFileListWithProgress,
  deduplicateFiles,
  FileLoadProgress,
} from '../utils/fileExtractor';

interface SendModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetPeer: PeerDevice | null;
  allPeers: PeerDevice[];
  localPeer?: PeerDevice;
  onStartSend: (targetPeerId: string, files: File[]) => void;
  onSendLink?: (targetPeerId: string, url: string, title?: string) => void;
  preselectedFiles?: File[];
  initialMode?: 'files' | 'link';
}

export function SendModal({
  isOpen,
  onClose,
  targetPeer,
  allPeers,
  localPeer,
  onStartSend,
  onSendLink,
  preselectedFiles = [],
  initialMode = 'files',
}: SendModalProps) {
  const [activeTab, setActiveTab] = useState<'files' | 'link'>('files');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkTitle, setLinkTitle] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [selectedPeerId, setSelectedPeerId] = useState<string>('');
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isLoadingFiles, setIsLoadingFiles] = useState<boolean>(false);
  const [loadingProgress, setLoadingProgress] = useState<FileLoadProgress | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const prevIsOpenRef = useRef<boolean>(false);

  const deduplicatedPeers = React.useMemo(() => {
    const list: PeerDevice[] = [];
    const seen = new Set<string>();

    for (const p of allPeers) {
      if (!p || !p.id) continue;
      if (localPeer && p.id === localPeer.id) continue;
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      list.push(p);
    }
    return list;
  }, [allPeers, localPeer?.id]);

  // Sync state ONLY when modal opens (flips from false to true)
  useEffect(() => {
    const justOpened = isOpen && !prevIsOpenRef.current;
    prevIsOpenRef.current = isOpen;

    if (justOpened) {
      setActiveTab(initialMode || (preselectedFiles && preselectedFiles.length > 0 ? 'files' : 'files'));
      setIsLoadingFiles(false);
      setLoadingProgress(null);
      if (preselectedFiles && preselectedFiles.length > 0) {
        setFiles(preselectedFiles);
      } else {
        setFiles([]);
      }

      if (targetPeer?.id) {
        setSelectedPeerId(targetPeer.id);
      } else if (deduplicatedPeers.length > 0) {
        setSelectedPeerId(deduplicatedPeers[0].id);
      } else if (localPeer?.id) {
        setSelectedPeerId(localPeer.id);
      }
    } else if (isOpen) {
      if (selectedPeerId) {
        const stillValid = deduplicatedPeers.some((p) => p.id === selectedPeerId) || (localPeer && localPeer.id === selectedPeerId);
        if (!stillValid) {
          setSelectedPeerId(targetPeer?.id || deduplicatedPeers[0]?.id || localPeer?.id || '');
        }
      } else if (targetPeer?.id) {
        setSelectedPeerId(targetPeer.id);
      } else if (deduplicatedPeers.length > 0) {
        setSelectedPeerId(deduplicatedPeers[0].id);
      }
    }
  }, [isOpen, preselectedFiles, targetPeer, deduplicatedPeers, localPeer, selectedPeerId, initialMode]);

  if (!isOpen) return null;

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) {
        setLinkUrl(text.trim());
      }
    } catch {
      // Clipboard access blocked by browser permission
    }
  };

  const handleConfirmSendLink = () => {
    if (!linkUrl.trim()) return;
    const destinationId = selectedPeerId || targetPeer?.id || allPeers[0]?.id || localPeer?.id;
    if (!destinationId) return;

    onSendLink?.(destinationId, linkUrl.trim(), linkTitle.trim() || undefined);
    setLinkUrl('');
    setLinkTitle('');
    onClose();
  };

  const handleAppendFiles = (newIncomingFiles: File[]) => {
    if (!newIncomingFiles || newIncomingFiles.length === 0) return;
    setFiles((prev) => deduplicateFiles(prev, newIncomingFiles));
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const incoming = e.target.files;
      setIsLoadingFiles(true);
      try {
        const processed = await processFileListWithProgress(incoming, (prog) => {
          setLoadingProgress(prog);
        });
        if (processed && processed.length > 0) {
          handleAppendFiles(processed);
        }
      } catch (err) {
        console.error('Error loading files:', err);
        handleAppendFiles(Array.from(incoming));
      } finally {
        setTimeout(() => {
          setIsLoadingFiles(false);
          setLoadingProgress(null);
        }, 300);
      }
    }
    // Always reset input value so selecting the same or new files works every time
    e.target.value = '';
  };

  const handleFolderInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const incoming = e.target.files;
      setIsLoadingFiles(true);
      try {
        const processed = await processFileListWithProgress(incoming, (prog) => {
          setLoadingProgress(prog);
        });
        if (processed && processed.length > 0) {
          handleAppendFiles(processed);
        }
      } catch (err) {
        console.error('Error loading folder files:', err);
        handleAppendFiles(Array.from(incoming));
      } finally {
        setTimeout(() => {
          setIsLoadingFiles(false);
          setLoadingProgress(null);
        }, 300);
      }
    }
    e.target.value = '';
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    setIsLoadingFiles(true);

    try {
      const extracted = await extractFilesFromDataTransfer(e.dataTransfer, (prog) => {
        setLoadingProgress(prog);
      });
      if (extracted && extracted.length > 0) {
        handleAppendFiles(extracted);
      }
    } catch (err) {
      console.error('Failed to extract files on drop:', err);
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleAppendFiles(Array.from(e.dataTransfer.files));
      }
    } finally {
      setTimeout(() => {
        setIsLoadingFiles(false);
        setLoadingProgress(null);
      }, 300);
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const clearAllFiles = () => {
    setFiles([]);
  };

  const totalSize = files.reduce((acc, f) => acc + f.size, 0);

  const handleConfirmSend = () => {
    if (files.length === 0) return;
    const destinationId = selectedPeerId || targetPeer?.id || allPeers[0]?.id || localPeer?.id;
    if (!destinationId) return;

    onStartSend(destinationId, files);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Hidden inputs outside the clickable dropzone to prevent event recursion */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFileInputChange}
          className="hidden"
          tabIndex={-1}
        />
        <input
          ref={folderInputRef}
          type="file"
          multiple
          {...({ webkitdirectory: '', directory: '' } as any)}
          onChange={handleFolderInputChange}
          className="hidden"
          tabIndex={-1}
        />

        {/* Header */}
        <div className="p-5 sm:p-6 border-b border-slate-800/80 bg-slate-900/90 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl border flex items-center justify-center transition-colors ${
              activeTab === 'link'
                ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
                : 'bg-cyan-500/10 border-cyan-500/20 text-cyan-400'
            }`}>
              {activeTab === 'link' ? <Link2 className="w-5 h-5" /> : <UploadCloud className="w-5 h-5" />}
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-semibold text-slate-100">
                {activeTab === 'link' ? 'Wyślij Link / Adres URL' : 'Wyślij Pliki Bez Limitu Wielkości'}
              </h2>
              <p className="text-xs text-slate-400">
                {activeTab === 'link'
                  ? 'Natychmiastowe otwarcie linku na telefonie lub innym PC · P2P Direct'
                  : 'Pojedyncze pliki oraz całe foldery bez limitu wielkości'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 transition-colors p-1 rounded-lg hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs: Files vs Link */}
        <div className="flex border-b border-slate-800 bg-slate-950/60 px-5 pt-2.5 gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('files')}
            className={`px-4 py-2.5 text-xs font-semibold rounded-t-xl border-t border-x transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'files'
                ? 'bg-slate-900 border-slate-800 text-cyan-300 shadow-sm'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <UploadCloud className="w-4 h-4" />
            <span>Pliki i foldery</span>
            {files.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-cyan-500/20 text-cyan-300 text-[10px] font-mono">
                {files.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('link')}
            className={`px-4 py-2.5 text-xs font-semibold rounded-t-xl border-t border-x transition-all flex items-center gap-2 cursor-pointer ${
              activeTab === 'link'
                ? 'bg-slate-900 border-slate-800 text-emerald-300 shadow-sm'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Link2 className="w-4 h-4 text-emerald-400" />
            <span>Wyślij Link / URL</span>
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-400 font-mono">
              NOWOŚĆ
            </span>
          </button>
        </div>

        {/* Content */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-4 flex-1">
          {/* Target device picker */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
              Urządzenie docelowe:
            </label>
            {deduplicatedPeers.length > 0 ? (
              <select
                value={selectedPeerId}
                onChange={(e) => setSelectedPeerId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-cyan-500 transition-colors cursor-pointer"
              >
                {deduplicatedPeers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.ip}) · {p.linkSpeed || 'Wi-Fi / LAN'}
                  </option>
                ))}
                {localPeer && (
                  <option value={localPeer.id}>
                    Lokalny test pętli zwrotnej (To urządzenie: {localPeer.name})
                  </option>
                )}
              </select>
            ) : (
              <div className="space-y-2">
                <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-300 flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <span className="font-semibold block">Brak innego urządzenia w sieci!</span>
                    <span className="text-[11px] text-slate-400 leading-relaxed block">
                      Aby przesłać dane na telefon lub drugi komputer, otwórz ten adres na drugim urządzeniu w tej samej sieci Wi-Fi/LAN.
                    </span>
                  </div>
                </div>

                {localPeer && (
                  <div className="p-3 bg-cyan-950/40 border border-cyan-800/40 rounded-xl text-xs flex items-center justify-between text-slate-300">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-cyan-400" />
                      <span>Wybrano: <strong>Lokalny test (Self-Loopback)</strong></span>
                    </div>
                    <span className="text-[10px] bg-cyan-500/20 text-cyan-300 px-2 py-0.5 rounded font-mono">
                      Testuj transfer
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {activeTab === 'link' ? (
            /* Link sending mode */
            <div className="space-y-4 animate-in fade-in">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
                    Adres strony lub link (URL):
                  </label>
                  <button
                    type="button"
                    onClick={handlePasteClipboard}
                    className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <Clipboard className="w-3.5 h-3.5" />
                    <span>Wklej ze schowka</span>
                  </button>
                </div>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                    <Globe className="w-4 h-4 text-emerald-400" />
                  </div>
                  <input
                    type="url"
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    placeholder="https://example.com/artykul lub dowolny link..."
                    className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 pl-10 pr-10 py-3 rounded-xl text-sm text-slate-100 placeholder-slate-500 focus:outline-none transition-colors"
                    autoFocus
                  />
                  {linkUrl && (
                    <button
                      type="button"
                      onClick={() => setLinkUrl('')}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-500 hover:text-slate-300 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
                  Tytuł lub notatka do linku (opcjonalnie):
                </label>
                <input
                  type="text"
                  value={linkTitle}
                  onChange={(e) => setLinkTitle(e.target.value)}
                  placeholder="np. Ciekawy artykuł, Przepis, Wideo do obejrzenia..."
                  className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 px-3.5 py-2.5 rounded-xl text-sm text-slate-100 placeholder-slate-500 focus:outline-none transition-colors"
                />
              </div>

              {/* Link Live Preview */}
              {linkUrl.trim() && (
                <div className="p-3.5 rounded-xl bg-slate-950 border border-emerald-500/30 space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Podgląd przesyłanego linku</span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800/80 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-200 truncate">
                        {linkTitle.trim() || linkUrl.trim()}
                      </div>
                      <div className="text-[11px] font-mono text-slate-400 truncate mt-0.5">
                        {linkUrl.trim()}
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 text-[10px] font-mono shrink-0">
                      URL
                    </span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Files mode */
            <>
              {/* Active File Loading Progress Indicator */}
              {isLoadingFiles && (
            <div className="p-4 rounded-2xl bg-gradient-to-r from-slate-900 via-cyan-950/40 to-slate-900 border border-cyan-500/50 space-y-3 animate-fade-in shadow-xl shadow-cyan-950/40">
              <div className="flex items-center justify-between text-xs">
                <span className="text-cyan-300 font-bold flex items-center gap-2">
                  <div className="w-3.5 h-3.5 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin shrink-0"></div>
                  <span>Wczytywanie i przygotowywanie plików...</span>
                </span>
                <span className="font-mono text-cyan-400 font-black text-sm">
                  {loadingProgress?.percent || 0}%
                </span>
              </div>
              {/* Real percentage progress bar */}
              <div className="w-full h-2.5 rounded-full bg-slate-950 overflow-hidden border border-cyan-900/60 p-0.5 shadow-inner">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-blue-500 to-emerald-400 transition-all duration-150 ease-out shadow-sm shadow-cyan-500/50"
                  style={{ width: `${loadingProgress?.percent || 0}%` }}
                ></div>
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                <span className="truncate max-w-[280px]">
                  Plik {loadingProgress?.count || 0} z {loadingProgress?.totalCount || 0} ·{' '}
                  <span className="text-slate-200">{loadingProgress?.currentName || 'Skanowanie...'}</span>
                </span>
                <span className="text-cyan-300 shrink-0 font-medium">
                  {formatBytes(loadingProgress?.loadedBytes || 0)} / {formatBytes(loadingProgress?.totalBytes || 0)}
                </span>
              </div>
            </div>
          )}

          {/* Drag & Drop Zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all flex flex-col items-center justify-center ${
              isDragging
                ? 'border-cyan-400 bg-cyan-950/40 scale-[1.01]'
                : 'border-slate-800 hover:border-slate-700 bg-slate-950/60'
            }`}
          >
            <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center mb-2.5">
              <UploadCloud className="w-6 h-6" />
            </div>
            <div className="text-sm font-semibold text-slate-200">
              Przeciągnij i upuść pliki lub folder tutaj
            </div>
            <p className="text-xs text-slate-400 mt-1 max-w-sm">
              Możesz załączyć wiele plików jednocześnie (wideo, zdjęcia, archiwa, dokumenty).
            </p>

            {/* Quick Action Buttons to choose files or folders */}
            <div className="flex flex-wrap items-center justify-center gap-2.5 mt-4">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-300 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer active:scale-95 shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Wybierz pliki</span>
              </button>
              <button
                type="button"
                onClick={() => folderInputRef.current?.click()}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer active:scale-95"
              >
                <FolderPlus className="w-3.5 h-3.5 text-amber-400" />
                <span>Wybierz cały folder</span>
              </button>
            </div>
          </div>

          {/* Files List when 1 or more files are attached */}
          {files.length > 0 && (
            <div className="space-y-2 p-3 rounded-2xl bg-slate-950/70 border border-slate-800/90">
              <div className="flex items-center justify-between text-xs text-slate-400 px-1">
                <span className="font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                  <span>Załączone pliki</span>
                  <span className="px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-400 font-mono text-[11px] font-bold">
                    {files.length}
                  </span>
                </span>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-cyan-400 font-semibold">
                    {formatBytes(totalSize)}
                  </span>
                  <button
                    type="button"
                    onClick={clearAllFiles}
                    className="text-rose-400 hover:text-rose-300 text-[11px] flex items-center gap-1 transition-colors cursor-pointer"
                    title="Wyczyść całą listę załączonych plików"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Wyczyść wszystko</span>
                  </button>
                </div>
              </div>

              <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1 divide-y divide-slate-800/40">
                {files.map((file, idx) => (
                  <div
                    key={`${file.name}_${file.size}_${idx}`}
                    className="pt-1.5 first:pt-0 flex items-center justify-between text-xs text-slate-200 group"
                  >
                    <div className="flex items-center gap-2 min-w-0 pr-2">
                      <FileIcon className="w-4 h-4 text-cyan-400 shrink-0" />
                      <span className="truncate font-medium" title={file.name}>
                        {file.name}
                      </span>
                      <span className="text-slate-500 font-mono shrink-0 text-[11px]">
                        ({formatBytes(file.size)})
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeFile(idx)}
                      className="text-slate-500 hover:text-rose-400 transition-colors p-1 rounded hover:bg-slate-800/60 cursor-pointer shrink-0"
                      title="Usuń ten plik z listy"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Add more files toolbar within list */}
              <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs">
                <span className="text-[11px] text-slate-400">
                  Możesz dobrać kolejne pliki w każdej chwili:
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-400 text-[11px] font-medium flex items-center gap-1 transition-all cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Dodaj pliki</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => folderInputRef.current?.click()}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 text-[11px] font-medium flex items-center gap-1 transition-all cursor-pointer"
                  >
                    <FolderPlus className="w-3 h-3" />
                    <span>Dodaj folder</span>
                  </button>
                </div>
              </div>
            </div>
          )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 sm:p-6 border-t border-slate-800 bg-slate-900/90 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
          >
            Anuluj
          </button>
          {activeTab === 'link' ? (
            <button
              type="button"
              onClick={handleConfirmSendLink}
              disabled={!linkUrl.trim() || (!selectedPeerId && allPeers.length === 0 && !localPeer)}
              className="px-5 py-2.5 rounded-xl font-semibold text-sm bg-emerald-500 text-slate-950 hover:bg-emerald-400 active:scale-[0.98] transition-all flex items-center gap-2 shadow-lg shadow-emerald-500/25 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <ExternalLink className="w-4 h-4" />
              <span>Wyślij Link na urządzenie</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleConfirmSend}
              disabled={files.length === 0 || (!selectedPeerId && allPeers.length === 0 && !localPeer)}
              className="px-5 py-2.5 rounded-xl font-semibold text-sm bg-cyan-500 text-slate-950 hover:bg-cyan-400 active:scale-[0.98] transition-all flex items-center gap-2 shadow-lg shadow-cyan-500/25 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <Zap className="w-4 h-4" />
              <span>
                {files.length === 0
                  ? 'Załącz pliki, aby wysłać'
                  : `Wyślij ${files.length} ${files.length === 1 ? 'plik' : files.length < 5 ? 'pliki' : 'plików'} (${formatBytes(totalSize)})`}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
