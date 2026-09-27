import { UploadCloud, File, Layers, Zap } from 'lucide-react';
import { FileLoadProgress } from '../utils/fileExtractor';
import { formatBytes } from '../utils/format';

interface FileLoadingOverlayProps {
  isOpen: boolean;
  progress: FileLoadProgress | null;
  title?: string;
  onCancel?: () => void;
}

export function FileLoadingOverlay({
  isOpen,
  progress,
  title = 'Wczytywanie i przygotowywanie plików...',
  onCancel,
}: FileLoadingOverlayProps) {
  if (!isOpen) return null;

  const count = progress?.count || 0;
  const totalCount = progress?.totalCount || 0;
  const loadedBytes = progress?.loadedBytes || 0;
  const totalBytes = progress?.totalBytes || 0;
  const percent = progress?.percent !== undefined ? Math.min(100, Math.max(0, progress.percent)) : 0;
  const isLargeFile = (progress?.currentFileSize || 0) > 25 * 1024 * 1024;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="file-loading-title"
      className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in"
    >
      <div className="w-full max-w-md p-6 sm:p-7 rounded-3xl bg-slate-900 border border-cyan-500/40 shadow-2xl shadow-cyan-950/50 text-center space-y-5">
        {/* Animated icon with pulsing ring */}
        <div className="relative w-16 h-16 mx-auto flex items-center justify-center">
          <div className="absolute inset-0 rounded-2xl bg-cyan-500/20 animate-ping opacity-40"></div>
          <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 relative shadow-inner">
            <UploadCloud className="w-8 h-8 animate-pulse text-cyan-400" />
          </div>
        </div>

        {/* Title & subtitle */}
        <div className="space-y-1">
          <h3 id="file-loading-title" className="text-base sm:text-lg font-bold text-white tracking-tight">
            {title}
          </h3>
          <p className="text-xs text-slate-400">
            {progress?.statusText || 'Przygotowywanie strumienia do transferu P2P...'}
          </p>
        </div>

        {/* Real Progress Counter & Bar */}
        <div className="space-y-2.5">
          <div className="flex items-baseline justify-between text-xs font-mono">
            <div className="flex items-center gap-1.5 text-cyan-300 font-semibold">
              <Layers className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span>
                {totalCount > 1 ? (
                  <>
                    Plik <strong className="text-white">{count}</strong> z <strong className="text-white">{totalCount}</strong>
                  </>
                ) : (
                  <span>Wczytywanie danych</span>
                )}
              </span>
            </div>
            <div className="text-xl sm:text-2xl font-black text-cyan-400 font-mono tracking-tight">
              {percent}%
            </div>
          </div>

          {/* Smooth Real-Width Progress Bar */}
          <div className="w-full h-3 rounded-full bg-slate-950 overflow-hidden border border-slate-800 p-0.5 shadow-inner">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-blue-500 to-emerald-400 transition-all duration-150 ease-out shadow-md shadow-cyan-500/40"
              style={{ width: `${percent}%` }}
            />
          </div>

          {/* Bytes summary */}
          <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
            <span>
              Wczytano: <strong className="text-slate-200">{formatBytes(loadedBytes)}</strong>
            </span>
            {totalBytes > 0 && (
              <span>
                Łącznie: <strong className="text-cyan-300">{formatBytes(totalBytes)}</strong>
              </span>
            )}
          </div>
        </div>

        {/* Current Active File Info */}
        {progress?.currentName && (
          <div className="p-3 rounded-2xl bg-slate-950/80 border border-slate-800 text-left flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-cyan-400 shrink-0">
                <File className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-200 truncate font-mono" title={progress.currentName}>
                  {progress.currentName}
                </div>
                <div className="text-[10px] text-slate-400 flex items-center gap-1.5">
                  {progress.currentFileSize !== undefined && (
                    <span>{formatBytes(progress.currentFileSize)}</span>
                  )}
                  {isLargeFile && (
                    <span className="text-amber-400 font-medium flex items-center gap-0.5">
                      <Zap className="w-2.5 h-2.5" />
                      Duży plik
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Optional Cancel Button */}
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="text-xs text-slate-400 hover:text-slate-200 transition-colors pt-1 cursor-pointer"
          >
            Anuluj wczytywanie
          </button>
        )}
      </div>
    </div>
  );
}
