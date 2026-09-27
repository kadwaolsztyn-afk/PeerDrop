import { useEffect, useState } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(() => {
    if (typeof window !== 'undefined' && (window as any).__deferredPrompt) {
      return (window as any).__deferredPrompt;
    }
    return null;
  });
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isSafariIOS, setIsSafariIOS] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);
  const [isWindows, setIsWindows] = useState(false);
  const [isChromium, setIsChromium] = useState(false);
  const [deviceCategory, setDeviceCategory] = useState<'phone' | 'tablet' | 'desktop'>('desktop');

  useEffect(() => {
    // Check if early prompt was caught
    if ((window as any).__deferredPrompt) {
      setDeferredPrompt((window as any).__deferredPrompt);
    }

    // Detect standalone mode (already installed & running as standalone desktop/mobile app)
    const isStandalone =
      typeof window !== 'undefined' &&
      (window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
        document.referrer.includes('android-app://'));

    setIsInstalled(Boolean(isStandalone));

    if (typeof navigator !== 'undefined') {
      const ua = navigator.userAgent.toLowerCase();
      const ios = /iphone|ipad|ipod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const isSafari = ios && /safari/.test(ua) && !/crios|fxios|opios|mercury/i.test(ua);
      const android = /android/.test(ua);
      const win = /windows|win32|win64/.test(ua);
      const isTablet = /ipad|tablet/.test(ua) || (android && !/mobile/.test(ua));
      const isPhone = (ios && !/ipad/.test(ua)) || (android && /mobile/.test(ua));

      setIsIOS(ios);
      setIsSafariIOS(Boolean(isSafari));
      setIsAndroid(android);
      setIsWindows(win);
      setIsChromium(/chrome|crios|edge|edg/i.test(ua) && !/firefox|fxios/i.test(ua));

      if (isTablet) setDeviceCategory('tablet');
      else if (isPhone) setDeviceCategory('phone');
      else setDeviceCategory('desktop');
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      (window as any).__deferredPrompt = e;
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handlePromptAvailable = (e: any) => {
      if (e.detail) {
        setDeferredPrompt(e.detail);
      } else if ((window as any).__deferredPrompt) {
        setDeferredPrompt((window as any).__deferredPrompt);
      }
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      if (typeof window !== 'undefined') {
        (window as any).__deferredPrompt = null;
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('pwa-prompt-available', handlePromptAvailable);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('pwa-prompt-available', handlePromptAvailable);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const install = async (): Promise<boolean> => {
    const promptEvent = deferredPrompt || (typeof window !== 'undefined' ? (window as any).__deferredPrompt : null);
    if (!promptEvent) {
      return false;
    }
    try {
      await promptEvent.prompt();
      const { outcome } = await promptEvent.userChoice;
      if (outcome === 'accepted') {
        setIsInstalled(true);
        setDeferredPrompt(null);
        if (typeof window !== 'undefined') {
          (window as any).__deferredPrompt = null;
        }
        return true;
      }
      return false;
    } catch (err) {
      console.error('Install prompt error:', err);
      return false;
    }
  };

  return {
    isInstallable: Boolean(deferredPrompt),
    isInstalled,
    isIOS,
    isSafariIOS,
    isAndroid,
    isWindows,
    isChromium,
    deviceCategory,
    install,
    deferredPrompt,
  };
}
