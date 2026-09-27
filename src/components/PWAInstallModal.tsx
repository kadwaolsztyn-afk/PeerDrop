import React, { useState } from 'react';
import {
  Download,
  Laptop,
  CheckCircle2,
  X,
  Sparkles,
  Smartphone,
  Tablet,
  Share,
  PlusSquare,
  Copy,
  ExternalLink,
  Check,
  ArrowDown,
  Info,
  Apple
} from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PWAInstallModal({ isOpen, onClose }: PWAInstallModalProps) {
  const { isInstallable, isInstalled, install, deviceCategory, isIOS, isSafariIOS } = usePWAInstall();
  const [activeTab, setActiveTab] = useState<'phone' | 'tablet' | 'desktop'>(deviceCategory);
  const [isCopied, setIsCopied] = useState(false);

  if (!isOpen) return null;

  const isInIframe = typeof window !== 'undefined' && window.self !== window.top;

  const handleInstallClick = async () => {
    if (isInstallable) {
      const ok = await install();
      if (ok) {
        onClose();
        return;
      }
    }
    if (isInIframe) {
      try {
        window.open(window.location.href, '_blank');
        onClose();
      } catch (err) {
        console.warn('Could not open top window:', err);
      }
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2500);
    } catch {}
  };

  const handleOpenInSafari = () => {
    try {
      window.open(window.location.href, '_blank');
    } catch (err) {
      console.warn('Cannot open top window:', err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 bg-slate-900/95 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-cyan-500/10 border border-cyan-500/25 flex items-center justify-center text-cyan-400 shrink-0">
              <Download className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-slate-100 truncate flex items-center gap-2">
                <span>Zainstaluj PeerDrop</span>
                {isIOS && (
                  <span className="px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 text-[10px] font-mono font-semibold">
                    iOS / iPhone
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-400 truncate">
                Działa jak natywna aplikacja na telefonie, tablecie i komputerze
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
            title="Zamknij"
            aria-label="Zamknij"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Device Category Tabs */}
        <div className="grid grid-cols-3 border-b border-slate-800 bg-slate-950/70 p-1.5 gap-1 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('phone')}
            className={`py-2 px-2 rounded-xl font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'phone'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5 shrink-0" />
            <span>Telefon</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('tablet')}
            className={`py-2 px-2 rounded-xl font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'tablet'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Tablet className="w-3.5 h-3.5 shrink-0" />
            <span>Tablet</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('desktop')}
            className={`py-2 px-2 rounded-xl font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              activeTab === 'desktop'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Laptop className="w-3.5 h-3.5 shrink-0" />
            <span>Komputer / PC</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1 text-xs">
          {/* Main Hero Card */}
          <div className="p-4 rounded-2xl bg-gradient-to-br from-cyan-950/40 via-slate-900 to-slate-950 border border-cyan-500/30 space-y-3 shadow-lg">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-sm font-bold text-white flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span>
                    {isIOS
                      ? 'Instalacja na Twoim iPhonie (Apple iOS)'
                      : activeTab === 'phone'
                      ? 'Natywna aplikacja na Twoim smartfonie'
                      : activeTab === 'tablet'
                      ? 'Wygodna aplikacja na Twoim tablecie'
                      : 'Natywny program na pulpicie i pasku zadań'}
                  </span>
                </div>
                <p className="text-slate-300 leading-relaxed text-[11px]">
                  Działa na pełnym ekranie bez pasków przeglądarki, z błyskawicznym uruchamianiem z ikony na ekranie głównym.
                </p>
              </div>

              <div className="w-12 h-12 rounded-2xl bg-slate-950 border border-cyan-500/30 flex items-center justify-center shrink-0 p-1.5 shadow-inner">
                <img src="/pwa-192x192.png" alt="PeerDrop Icon" className="w-full h-full object-contain rounded-xl" />
              </div>
            </div>

            {/* Action Buttons: If on iOS vs Android/Desktop */}
            {isInstalled ? (
              <div className="p-2.5 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="font-semibold">Aplikacja jest już zainstalowana na tym urządzeniu!</span>
              </div>
            ) : isIOS ? (
              /* iOS Special Flow */
              <div className="space-y-2.5 pt-1">
                <div className="p-3 rounded-xl bg-blue-950/50 border border-blue-500/40 text-blue-200 text-xs space-y-1.5">
                  <div className="font-bold flex items-center gap-1.5 text-blue-100">
                    <Info className="w-4 h-4 text-cyan-400 shrink-0" />
                    <span>Dlaczego na iPhonie nie ma 1-kliknięcia?</span>
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    Firma <strong>Apple</strong> ze względów bezpieczeństwa nie zezwala stronom WWW na automatyczną instalację jednym kliknięciem. Na iPhonie aplikację dodaje się przez wbudowany przycisk <strong>Udostępnij</strong> w Safari (trwa to 5 sekund):
                  </p>
                </div>

                {isInIframe && (
                  <div className="flex flex-col sm:flex-row gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleOpenInSafari}
                      className="flex-1 py-2 px-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-md cursor-pointer"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Otwórz w Safari</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleCopyLink}
                      className="py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs border border-slate-700 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                    >
                      {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
                      <span>{isCopied ? 'Skopiowano link!' : 'Kopiuj link'}</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              /* Android & Desktop 1-Click Install Button */
              <button
                type="button"
                onClick={handleInstallClick}
                className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-lg shadow-cyan-500/25 cursor-pointer active:scale-[0.98]"
              >
                <Download className="w-4 h-4" />
                <span>Zainstaluj teraz jednym kliknięciem</span>
              </button>
            )}
          </div>

          {/* IPHONE / IOS SPECIAL DETAILED SECTION */}
          {isIOS ? (
            <div className="space-y-3 animate-fade-in">
              <div className="flex items-center justify-between px-1">
                <h3 className="font-bold text-slate-100 text-xs uppercase tracking-wider flex items-center gap-1.5">
                  <Apple className="w-3.5 h-3.5 text-slate-300" />
                  <span>Jak dodać PeerDrop do ekranu iPhone'a:</span>
                </h3>
                <span className="text-[10px] text-cyan-400 font-mono font-bold bg-cyan-500/10 px-2 py-0.5 rounded-full border border-cyan-500/30">
                  Safari iOS
                </span>
              </div>

              {/* Step 1 */}
              <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 hover:border-cyan-500/40 transition-colors space-y-1.5">
                <div className="flex items-center gap-2.5 font-bold text-slate-100 text-xs">
                  <div className="w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 flex items-center justify-center text-xs font-mono font-bold shrink-0">
                    1
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span>Kliknij przycisk</span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-500/20 text-blue-300 border border-blue-500/40 font-mono text-[11px]">
                      <Share className="w-3 h-3 text-blue-400" /> Udostępnij
                    </span>
                    <span className="text-slate-400 font-normal">w Safari</span>
                  </div>
                </div>
                <p className="text-slate-400 text-[11px] leading-relaxed pl-8">
                  Przycisk <strong>Udostępnij</strong> (niebieski kwadrat ze strzałką w górę) znajduje się na <strong>dolnym pasku</strong> przeglądarki Safari (lub na górnym pasku w iPadzie).
                </p>
              </div>

              {/* Step 2 */}
              <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 hover:border-cyan-500/40 transition-colors space-y-1.5">
                <div className="flex items-center gap-2.5 font-bold text-slate-100 text-xs">
                  <div className="w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 flex items-center justify-center text-xs font-mono font-bold shrink-0">
                    2
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span>Przewiń w dół i wybierz</span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-mono text-[11px]">
                      <PlusSquare className="w-3 h-3 text-emerald-400" /> Do ekranu początkowego
                    </span>
                  </div>
                </div>
                <p className="text-slate-400 text-[11px] leading-relaxed pl-8">
                  Na liście opcji przewiń w dół i kliknij pozycję <strong>„Do ekranu początkowego”</strong> (w niektórych wersjach iOS: „Do ekranu głównego”).
                </p>
              </div>

              {/* Step 3 */}
              <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 hover:border-cyan-500/40 transition-colors space-y-1.5">
                <div className="flex items-center gap-2.5 font-bold text-slate-100 text-xs">
                  <div className="w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 flex items-center justify-center text-xs font-mono font-bold shrink-0">
                    3
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span>Kliknij</span>
                    <span className="px-2 py-0.5 rounded-md bg-cyan-500 text-slate-950 font-bold font-mono text-[11px]">
                      Dodaj
                    </span>
                    <span className="text-slate-400 font-normal">w prawym górnym rogu</span>
                  </div>
                </div>
                <p className="text-slate-400 text-[11px] leading-relaxed pl-8">
                  Zatwierdź nazwę <strong>PeerDrop</strong> – ikona aplikacji natychmiast pojawi się na pulpicie Twojego iPhone'a!
                </p>
              </div>

              {/* Bottom Visual Pointer for iPhone Safari */}
              <div className="p-3 rounded-2xl bg-gradient-to-r from-blue-950/60 to-cyan-950/60 border border-cyan-500/30 flex items-center justify-center gap-2 text-cyan-300 text-xs font-semibold text-center">
                <ArrowDown className="w-4 h-4 text-cyan-400 shrink-0 animate-bounce" />
                <span>Przycisk Udostępnij znajduje się poniżej na pasku Safari</span>
                <ArrowDown className="w-4 h-4 text-cyan-400 shrink-0 animate-bounce" />
              </div>
            </div>
          ) : (
            /* NON-IOS TABS (Android / Tablet / Desktop) */
            <>
              {/* Tab 1: TELEFON */}
              {activeTab === 'phone' && (
                <div className="space-y-3 animate-fade-in">
                  <h3 className="font-bold text-slate-200 text-xs uppercase tracking-wider px-1">
                    Instrukcja instalacji na telefonie:
                  </h3>

                  {/* Android */}
                  <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 font-bold text-slate-200">
                        <div className="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center text-[10px]">
                          1
                        </div>
                        <span>Android (Google Chrome / Samsung Internet):</span>
                      </div>
                      <span className="text-[10px] text-cyan-400 font-mono">Chrome</span>
                    </div>
                    <p className="text-slate-400 text-[11px] leading-relaxed pl-7">
                      W prawym górnym rogu kliknij menu <strong>⋮ (trzy kropki)</strong> i wybierz <strong>„Zainstaluj aplikację”</strong> (lub <strong>„Dodaj do ekranu głównego”</strong>). Ikona PeerDrop pojawi się na pulpicie telefonu!
                    </p>
                  </div>

                  {/* iPhone iOS */}
                  <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 font-bold text-slate-200">
                        <div className="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center text-[10px]">
                          2
                        </div>
                        <span>iPhone (Apple Safari):</span>
                      </div>
                      <span className="text-[10px] text-cyan-400 font-mono">iOS</span>
                    </div>
                    <p className="text-slate-400 text-[11px] leading-relaxed pl-7">
                      W dolnym pasku przeglądarki Safari kliknij ikonę <strong>Udostępnij <Share className="inline w-3 h-3 text-cyan-400" /></strong> (kwadrat ze strzałką w górę), przewiń w dół i wybierz <strong>„Do ekranu początkowego” <PlusSquare className="inline w-3 h-3 text-cyan-400" /></strong>.
                    </p>
                  </div>
                </div>
              )}

              {/* Tab 2: TABLET */}
              {activeTab === 'tablet' && (
                <div className="space-y-3 animate-fade-in">
                  <h3 className="font-bold text-slate-200 text-xs uppercase tracking-wider px-1">
                    Instrukcja instalacji na tablecie:
                  </h3>

                  {/* iPad */}
                  <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 font-bold text-slate-200">
                        <div className="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center text-[10px]">
                          1
                        </div>
                        <span>Apple iPad (iPadOS Safari):</span>
                      </div>
                      <span className="text-[10px] text-cyan-400 font-mono">iPadOS</span>
                    </div>
                    <p className="text-slate-400 text-[11px] leading-relaxed pl-7">
                      W prawym górnym rogu Safari kliknij przycisk <strong>Udostępnij <Share className="inline w-3 h-3 text-cyan-400" /></strong>, a następnie wybierz <strong>„Do ekranu początkowego”</strong>.
                    </p>
                  </div>

                  {/* Android Tablet */}
                  <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 font-bold text-slate-200">
                        <div className="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center text-[10px]">
                          2
                        </div>
                        <span>Tablet z Androidem (Samsung Galaxy Tab / Lenovo / inne):</span>
                      </div>
                      <span className="text-[10px] text-cyan-400 font-mono">Android</span>
                    </div>
                    <p className="text-slate-400 text-[11px] leading-relaxed pl-7">
                      W Chrome kliknij menu <strong>⋮ (trzy kropki)</strong> w prawym rogu i wybierz <strong>„Zainstaluj aplikację”</strong>.
                    </p>
                  </div>
                </div>
              )}

              {/* Tab 3: KOMPUTER / PC */}
              {activeTab === 'desktop' && (
                <div className="space-y-3 animate-fade-in">
                  <h3 className="font-bold text-slate-200 text-xs uppercase tracking-wider px-1">
                    Instrukcja instalacji na komputerze:
                  </h3>

                  {/* Google Chrome */}
                  <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 font-bold text-slate-200">
                        <div className="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center text-[10px]">
                          1
                        </div>
                        <span>Google Chrome / Brave / Opera:</span>
                      </div>
                      <span className="text-[10px] text-cyan-400 font-mono">Windows / Mac / Linux</span>
                    </div>
                    <p className="text-slate-400 text-[11px] leading-relaxed pl-7">
                      Na pasku adresu po prawej stronie kliknij ikonę <strong>Zainstaluj aplikację</strong> (komputerek ze strzałką) lub kliknij menu <strong>⋮ (trzy kropki)</strong> → <strong>Zapisz i udostępnij</strong> → <strong>Zainstaluj stronę jako aplikację</strong>.
                    </p>
                  </div>

                  {/* Microsoft Edge */}
                  <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 font-bold text-slate-200">
                        <div className="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center text-[10px]">
                          2
                        </div>
                        <span>Microsoft Edge:</span>
                      </div>
                      <span className="text-[10px] text-cyan-400 font-mono">Windows / Mac</span>
                    </div>
                    <p className="text-slate-400 text-[11px] leading-relaxed pl-7">
                      Na pasku adresu kliknij ikonę <strong>Dostępna aplikacja</strong> lub kliknij menu <strong>…</strong> → <strong>Aplikacje</strong> → <strong>Zainstaluj tę witrynę jako aplikację</strong>.
                    </p>
                  </div>
                </div>
              )}
            </>
          )}

          {/* PWA Benefits Grid */}
          <div className="pt-2 border-t border-slate-800/80">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
              <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex flex-col items-center text-center gap-1">
                <span className="text-cyan-400 font-bold">Pełny Ekran</span>
                <span className="text-slate-400">Bez pasków adresu</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex flex-col items-center text-center gap-1">
                <span className="text-cyan-400 font-bold">100% Offline</span>
                <span className="text-slate-400">Działa w LAN bez WWW</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex flex-col items-center text-center gap-1">
                <span className="text-cyan-400 font-bold">Szybki Start</span>
                <span className="text-slate-400">Z pulpitu telefonu</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex flex-col items-center text-center gap-1">
                <span className="text-cyan-400 font-bold">Bez Sklepu</span>
                <span className="text-slate-400">Bez App Store / Play</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/95 flex items-center justify-between gap-3">
          <span className="text-[11px] text-slate-400 truncate">
            {isIOS
              ? 'W Safari: Udostępnij → Do ekranu początkowego → Dodaj'
              : 'Aplikacja PeerDrop zajmuje mniej niż 3 MB pamięci'}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors cursor-pointer shrink-0"
          >
            Rozumiem
          </button>
        </div>
      </div>
    </div>
  );
}
