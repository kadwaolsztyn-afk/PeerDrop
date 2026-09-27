/**
 * Wake Lock & Keep-Alive Manager for PeerDrop
 * 
 * Prevents mobile devices (iOS Safari, Android Chrome), tablets (iPad, Android),
 * and laptops/PCs from dimming, screen-locking, sleeping, or suspending background
 * JavaScript execution / WebSockets / WebRTC during active file transfers.
 *
 * Strategies:
 * 1. Screen Wake Lock API (navigator.wakeLock)
 * 2. Silent HTML5 Video Stream fallback (NoSleep / iOS Safari background keep-alive)
 * 3. Silent Web Audio Context buffer loop (prevents mobile OS thread freezing)
 * 4. beforeunload prevention (prevents accidental tab closure or navigation)
 */

type WakeLockSentinel = any;

class DeviceKeepAliveManager {
  private wakeLockSentinel: WakeLockSentinel | null = null;
  private isRequested: boolean = false;
  private hiddenVideo: HTMLVideoElement | null = null;
  private audioContext: AudioContext | null = null;
  private audioSource: AudioBufferSourceNode | null = null;
  private beforeUnloadHandler: ((e: BeforeUnloadEvent) => void) | null = null;
  private visibilityHandler: (() => void) | null = null;
  private listeners: Set<(isActive: boolean) => void> = new Set();

  constructor() {
    if (typeof window === 'undefined') return;

    // Handle visibility changes: re-request lock if page becomes visible again
    this.visibilityHandler = () => {
      if (document.visibilityState === 'visible' && this.isRequested) {
        this.acquireScreenWakeLock();
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  public subscribe(listener: (isActive: boolean) => void): () => void {
    this.listeners.add(listener);
    listener(this.isRequested);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    this.listeners.forEach((fn) => fn(this.isRequested));
  }

  /**
   * Activate all keep-alive mechanisms: Screen Wake Lock, Silent Video, Silent Audio, beforeunload.
   */
  public async enableKeepAlive(): Promise<boolean> {
    if (this.isRequested) return true;
    this.isRequested = true;
    this.notify();

    // 1. Screen Wake Lock API
    await this.acquireScreenWakeLock();

    // 2. iOS Safari & Android Silent Video Fallback
    this.startSilentVideoKeepAlive();

    // 3. Silent Web Audio Buffer (prevents browser tab throttling)
    this.startSilentAudioKeepAlive();

    // 4. Protect against accidental close/refresh
    this.enableBeforeUnloadProtection();

    return true;
  }

  /**
   * Release keep-alive mechanisms when transfers are completed or cancelled.
   */
  public disableKeepAlive() {
    if (!this.isRequested) return;
    this.isRequested = false;
    this.notify();

    // Release Screen Wake Lock
    if (this.wakeLockSentinel) {
      try {
        this.wakeLockSentinel.release();
      } catch (err) {
        // Ignored
      }
      this.wakeLockSentinel = null;
    }

    // Stop silent video
    if (this.hiddenVideo) {
      try {
        this.hiddenVideo.pause();
        if (this.hiddenVideo.parentNode) {
          this.hiddenVideo.parentNode.removeChild(this.hiddenVideo);
        }
      } catch (err) {
        // Ignored
      }
      this.hiddenVideo = null;
    }

    // Stop silent audio
    if (this.audioSource) {
      try {
        this.audioSource.stop();
        this.audioSource.disconnect();
      } catch (err) {
        // Ignored
      }
      this.audioSource = null;
    }

    // Remove beforeunload
    this.disableBeforeUnloadProtection();
  }

  private async acquireScreenWakeLock(): Promise<boolean> {
    if (typeof navigator !== 'undefined' && 'wakeLock' in navigator && (navigator as any).wakeLock) {
      try {
        this.wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
        if (this.wakeLockSentinel) {
          this.wakeLockSentinel.addEventListener('release', () => {
            if (this.isRequested && document.visibilityState === 'visible') {
              // Try to re-acquire immediately if released unexpectedly
              this.acquireScreenWakeLock();
            }
          });
          return true;
        }
      } catch (err: any) {
        // Usually happens if battery saver is strictly enforced or permission denied
        console.warn('Screen WakeLock request failed (fallback engaged):', err?.message || err);
      }
    }
    return false;
  }

  private startSilentVideoKeepAlive() {
    if (typeof document === 'undefined' || this.hiddenVideo) return;

    try {
      // Create a canvas stream or empty video to keep iOS Safari & Android mobile media session awake
      const canvas = document.createElement('canvas');
      canvas.width = 16;
      canvas.height = 16;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, 16, 16);
      }

      // Check for canvas captureStream support
      const stream = (canvas as any).captureStream ? (canvas as any).captureStream(1) : null;
      if (stream) {
        const video = document.createElement('video');
        video.setAttribute('playsinline', 'true');
        video.setAttribute('webkit-playsinline', 'true');
        video.setAttribute('muted', 'true');
        video.muted = true;
        video.loop = true;
        video.style.position = 'fixed';
        video.style.top = '-9999px';
        video.style.left = '-9999px';
        video.style.width = '1px';
        video.style.height = '1px';
        video.style.opacity = '0.001';
        video.style.pointerEvents = 'none';
        video.srcObject = stream;
        document.body.appendChild(video);

        video.play().catch(() => {
          // In some browsers autoplay requires user interaction, handled gracefully
        });
        this.hiddenVideo = video;
      }
    } catch (err) {
      // Fallback silent video creation failed, non-fatal
    }
  }

  private startSilentAudioKeepAlive() {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;

      if (!this.audioContext || this.audioContext.state === 'closed') {
        this.audioContext = new AudioCtx();
      }

      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch(() => {});
      }

      // Create 1-second silent buffer looping continuously
      const buffer = this.audioContext.createBuffer(1, this.audioContext.sampleRate, this.audioContext.sampleRate);
      const source = this.audioContext.createBufferSource();
      source.buffer = buffer;
      source.loop = true;

      // Connect through a zero-gain node so zero audio is emitted
      const gainNode = this.audioContext.createGain();
      gainNode.gain.value = 0.0001; // Inaudible near-zero amplitude
      source.connect(gainNode);
      gainNode.connect(this.audioContext.destination);

      source.start(0);
      this.audioSource = source;
    } catch (err) {
      // Web Audio may require user gesture on first interaction
    }
  }

  private enableBeforeUnloadProtection() {
    if (this.beforeUnloadHandler) return;
    this.beforeUnloadHandler = (e: BeforeUnloadEvent) => {
      if (this.isRequested) {
        e.preventDefault();
        e.returnValue = 'Trwa przesyłanie plików w PeerDrop. Opuszczenie strony przerwie transfer.';
        return e.returnValue;
      }
    };
    window.addEventListener('beforeunload', this.beforeUnloadHandler);
  }

  private disableBeforeUnloadProtection() {
    if (this.beforeUnloadHandler) {
      window.removeEventListener('beforeunload', this.beforeUnloadHandler);
      this.beforeUnloadHandler = null;
    }
  }

  public isActive(): boolean {
    return this.isRequested;
  }
}

export const deviceKeepAlive = new DeviceKeepAliveManager();
