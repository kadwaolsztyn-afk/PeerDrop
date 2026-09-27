import { useState, useEffect } from 'react';
import { X, Copy, Check, ExternalLink, Laptop, RefreshCw, Sparkles, QrCode } from 'lucide-react';
import QRCode from 'qrcode';
import { PeerDropLogo } from './PeerDropLogo';
import { getCleanPeerDropUrl, getWorkingAppUrl } from '../utils/appUrl';

interface ConnectPeerModalProps {
  isOpen: boolean;
  onClose: () => void;
  networkName: string;
  connectionType: 'wifi' | 'ethernet';
  pairCode?: string;
  onPairByCode?: (code: string) => void;
}

export function ConnectPeerModal({
  isOpen,
  onClose,
  networkName,
  connectionType,
  pairCode,
  onPairByCode,
}: ConnectPeerModalProps) {
  const [copied, setCopied] = useState(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const [targetPin, setTargetPin] = useState('');
  const [pinStatus, setPinStatus] = useState<'idle' | 'pairing' | 'success' | 'error'>('idle');
  const [pinFeedback, setPinFeedback] = useState<string>('');

  const displayUrl = typeof window !== 'undefined' ? getCleanPeerDropUrl() : 'https://peerdrop.app';
  const workingUrl = typeof window !== 'undefined' ? getWorkingAppUrl() : 'https://peerdrop.app';

  const handleDirectPinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (targetPin.trim() && onPairByCode) {
      setPinStatus('pairing');
      onPairByCode(targetPin.trim());
      setTargetPin('');
      setPinStatus('success');
      setPinFeedback('Wysłano sygnał parowania PIN!');
      setTimeout(() => {
        setPinStatus('idle');
        setPinFeedback('');
      }, 4000);
    }
  };

  useEffect(() => {
    if (isOpen && workingUrl) {
      QRCode.toDataURL(workingUrl, {
        width: 220,
        margin: 1,
        color: {
          dark: '#020617',
          light: '#ffffff',
        },
      })
        .then((dataUri) => setQrCodeDataUrl(dataUri))
        .catch((err) => console.error('Error generating modal QR code:', err));
    }
  }, [isOpen, workingUrl]);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(displayUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 bg-slate-900/95 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <PeerDropLogo variant="icon" size="md" className="shrink-0" />
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-slate-100 truncate">
                Połącz Drugie Urządzenie
              </h2>
              <p className="text-xs text-slate-400 truncate">
                PeerDrop P2P · Bezpośrednie parowanie telefon / PC
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 transition-colors p-1.5 rounded-lg hover:bg-slate-800 cursor-pointer shrink-0"
            title="Zamknij"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1">
          {/* Visual QR Code Display */}
          <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 flex flex-col items-center justify-center space-y-2.5">
            <div className="w-44 h-44 bg-white p-2.5 rounded-2xl shadow-md flex items-center justify-center">
              {qrCodeDataUrl ? (
                <img
                  src={qrCodeDataUrl}
                  alt="Kod QR do połączenia z aplikacją PeerDrop"
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="flex items-center justify-center text-slate-400">
                  <RefreshCw className="w-6 h-6 animate-spin text-cyan-500" />
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-cyan-300 font-medium">
              <QrCode className="w-3.5 h-3.5 text-cyan-400" />
              <span>Zeskanuj aparatem w telefonie</span>
            </div>
            <span className="text-[11px] text-slate-400 text-center leading-relaxed">
              Otwórz aplikację aparatem w smartfonie lub tablecie, aby połączyć od razu.
            </span>
          </div>

          {/* PIN badge */}
          {pairCode && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/25 rounded-2xl text-center flex flex-col items-center justify-center gap-1">
              <span className="text-xs text-slate-400">Twój 4-cyfrowy kod PIN:</span>
              <span className="text-2xl font-black font-mono text-emerald-400 tracking-widest">
                #{pairCode}
              </span>
            </div>
          )}

          {/* Quick PIN Connect Form */}
          {onPairByCode && (
            <div className="p-3.5 bg-slate-950 rounded-2xl border border-slate-800 space-y-2">
              <label className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider block">
                Połącz kodem PIN z drugiego urządzenia:
              </label>
              <form onSubmit={handleDirectPinSubmit} className="flex items-center gap-2">
                <input
                  type="text"
                  maxLength={4}
                  placeholder="Wpisz 4 cyfry PIN..."
                  value={targetPin}
                  onChange={(e) => setTargetPin(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500 font-mono text-center tracking-widest"
                />
                <button
                  type="submit"
                  disabled={!targetPin.trim() || pinStatus === 'pairing'}
                  className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-slate-950 font-bold text-xs transition-colors shrink-0 shadow-md shadow-cyan-500/20 flex items-center gap-1.5 cursor-pointer"
                >
                  {pinStatus === 'pairing' ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Łączenie...</span>
                    </>
                  ) : (
                    <span>Połącz PIN</span>
                  )}
                </button>
              </form>
              {pinFeedback && (
                <div className="text-[11px] text-cyan-300 bg-cyan-950/40 border border-cyan-800/40 rounded-lg px-2.5 py-1 text-center font-medium animate-fadeIn">
                  {pinFeedback}
                </div>
              )}
            </div>
          )}

          {/* Link block */}
          <div className="space-y-1.5 text-left">
            <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
              Link do aplikacji PeerDrop:
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={displayUrl}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none truncate"
              />
              <button
                type="button"
                onClick={handleCopy}
                className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors shrink-0 flex items-center justify-center gap-1.5 text-xs font-semibold cursor-pointer min-w-[90px]"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400">Skopiowano</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Kopiuj</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Network requirements note */}
          <div className="p-3.5 rounded-2xl bg-cyan-950/30 border border-cyan-900/40 text-left text-xs text-cyan-300 space-y-1">
            <div className="font-semibold flex items-center gap-1.5 text-cyan-200">
              <Laptop className="w-3.5 h-3.5 shrink-0" />
              <span>Wymaganie lokalnej sieci Wi-Fi / LAN:</span>
            </div>
            <p className="text-slate-400 leading-relaxed text-[11px]">
              Upewnij się, że drugie urządzenie jest podłączone do sieci <strong className="text-slate-200">{networkName}</strong> ({connectionType === 'wifi' ? 'Wi-Fi' : 'Kabel LAN'}). Urządzenia połączą się natychmiast automatycznie!
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 sm:p-5 border-t border-slate-800 bg-slate-900/95 flex flex-col sm:flex-row items-center justify-between gap-2.5">
          <button
            type="button"
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.open(workingUrl, '_blank');
              }
            }}
            className="w-full sm:w-auto px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500/20 to-cyan-500/20 hover:from-emerald-500/30 hover:to-cyan-500/30 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-sm cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>Przetestuj transfer (2. okno)</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto px-5 py-2 text-xs font-bold rounded-xl bg-slate-800 text-slate-200 hover:bg-slate-700 transition-colors cursor-pointer text-center"
          >
            Zamknij
          </button>
        </div>
      </div>
    </div>
  );
}
