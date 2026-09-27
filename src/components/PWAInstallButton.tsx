import React, { useState } from 'react';
import { ArrowDownToLine, CheckCircle2 } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { PWAInstallModal } from './PWAInstallModal';

interface PWAInstallButtonProps {
  className?: string;
}

export function PWAInstallButton({ className = '' }: PWAInstallButtonProps) {
  const { isInstallable, isInstalled, install, deviceCategory, isIOS } = usePWAInstall();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleClick = async () => {
    // On iPhone/iPad (iOS), Apple does not support 1-click web install API; show the iOS guide
    if (isIOS) {
      setIsModalOpen(true);
      return;
    }

    // If browser prompt is directly ready, invoke it with 1 click
    if (isInstallable) {
      const success = await install();
      if (success) {
        return;
      }
    }

    // If running inside an iframe (like AI Studio preview), opening top window directly
    // enables Chrome's native 1-click PWA installation without copying or creating links
    const isInIframe = typeof window !== 'undefined' && window.self !== window.top;
    if (isInIframe && deviceCategory === 'desktop') {
      try {
        const topWin = window.open(window.location.href, '_blank');
        if (topWin) {
          return;
        }
      } catch (err) {
        console.warn('Could not open top window:', err);
      }
    }

    // Otherwise show the visual guide modal
    setIsModalOpen(true);
  };

  if (isInstalled) {
    return (
      <>
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className={`cursor-pointer h-8 sm:h-9 px-2 sm:px-2.5 rounded-lg sm:rounded-xl border border-emerald-500/30 bg-emerald-950/20 text-emerald-300 text-xs font-medium flex items-center justify-center gap-1.5 transition-all hover:bg-emerald-950/40 shrink-0 ${className}`}
          title="Aplikacja PeerDrop działa w trybie natywnym na Twoim urządzeniu (kliknij, aby otworzyć opcje instalacji)"
          aria-label="Aplikacja zainstalowana"
        >
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" strokeWidth={2.2} />
          <span className="text-[11px] sm:text-xs">Zainstalowano</span>
        </button>
        <PWAInstallModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={`cursor-pointer h-8 sm:h-9 px-2.5 sm:px-3 rounded-lg sm:rounded-xl border border-cyan-500/50 bg-gradient-to-r from-cyan-500/20 to-blue-500/20 hover:from-cyan-500/30 hover:to-blue-500/30 text-cyan-300 text-xs font-bold flex items-center justify-center gap-1.5 transition-all shadow-sm hover:border-cyan-400 active:scale-95 group shrink-0 whitespace-nowrap ${className}`}
        title="Zainstaluj PeerDrop na telefonie, tablecie lub komputerze (ikona na pulpicie i ekranie głównym)"
        aria-label="Zainstaluj aplikację PeerDrop"
      >
        <ArrowDownToLine className="w-3.5 h-3.5 text-cyan-400 group-hover:translate-y-0.5 transition-transform shrink-0" strokeWidth={2.4} />
        <span className="text-[11px] sm:text-xs">Zainstaluj</span>
        <span className="hidden xl:inline"> aplikację</span>
      </button>

      <PWAInstallModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </>
  );
}
