/**
 * File Saver Utility
 * Supports:
 * - Native Directory Picker (showDirectoryPicker) to pick destination folder once for an entire transfer
 * - Native "Save As" (showSaveFilePicker) where user chooses exact OS directory and filename
 * - Automatic saving of all subsequent files from the same transfer into the same chosen folder
 * - Direct download to default Downloads folder
 * - File preview in new window or modal
 * - Filename sanitization & extension handling
 */

export function isSaveFilePickerSupported(): boolean {
  return typeof window !== 'undefined' && 'showSaveFilePicker' in window;
}

export function isDirectoryPickerSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export function isAndroidDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android/i.test(navigator.userAgent);
}

export function isWebShareSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function' && typeof navigator.canShare === 'function';
}

const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  pdf: 'application/pdf',
  zip: 'application/zip',
  apk: 'application/vnd.android.package-archive',
  txt: 'text/plain',
  json: 'application/json',
  csv: 'text/csv',
  html: 'text/html',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export function getMimeTypeForFileName(fileName: string, fallbackMime = 'application/octet-stream'): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  return EXT_TO_MIME[ext] || fallbackMime;
}

/**
 * Share file directly using native Android/iOS share sheet (Save to Drive, Files, Gallery, WhatsApp, etc.)
 */
export async function shareFileViaNativeSheet(blobOrUrl: Blob | string, fileName: string): Promise<boolean> {
  if (!isWebShareSupported()) return false;
  try {
    let blob: Blob;
    if (typeof blobOrUrl === 'string') {
      const res = await fetch(blobOrUrl);
      blob = await res.blob();
    } else {
      blob = blobOrUrl;
    }

    const mime = blob.type && blob.type !== 'application/octet-stream' ? blob.type : getMimeTypeForFileName(fileName);
    const file = new File([blob], fileName, { type: mime });

    if (navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: fileName,
      });
      return true;
    }
  } catch (err: any) {
    if (err?.name !== 'AbortError') {
      console.warn('Native share failed:', err);
    }
  }
  return false;
}

export interface ActiveTransferDestination {
  type: 'directory' | 'downloads';
  handle?: FileSystemDirectoryHandle;
  name: string;
  peerId?: string;
  createdAt: number;
}

// Active destination directory memory for current transfer session
let activeDestination: ActiveTransferDestination | null = null;
let activeTransferDirHandle: FileSystemDirectoryHandle | null = null;
let activeTransferDirName: string | null = null;
let activeTransferPeerId: string | null = null;
let lastTransferActionTimestamp = 0;

export function setActiveTransferDestination(dest: ActiveTransferDestination): void {
  activeDestination = dest;
  lastTransferActionTimestamp = Date.now();
  if (dest.type === 'directory' && dest.handle) {
    activeTransferDirHandle = dest.handle;
    activeTransferDirName = dest.name;
    activeTransferPeerId = dest.peerId || null;
  }
  try {
    sessionStorage.setItem('peerdrop_active_dest_type', dest.type);
    sessionStorage.setItem('peerdrop_active_dir_name', dest.name);
  } catch {
    // Ignore storage issues
  }
}

export function getActiveTransferDestination(_peerId?: string): ActiveTransferDestination | null {
  if (!activeDestination) return null;
  // Expire after 30 minutes of inactivity
  if (Date.now() - lastTransferActionTimestamp > 30 * 60 * 1000) {
    clearActiveTransferDestination();
    return null;
  }
  return activeDestination;
}

export function clearActiveTransferDestination(): void {
  activeDestination = null;
  activeTransferDirHandle = null;
  activeTransferDirName = null;
  activeTransferPeerId = null;
  try {
    sessionStorage.removeItem('peerdrop_active_dest_type');
    sessionStorage.removeItem('peerdrop_active_dir_name');
  } catch {
    // Ignore
  }
}

export async function saveTransferFile(
  dest: ActiveTransferDestination,
  blobOrUrl: Blob | string,
  fileName: string
): Promise<{ success: boolean; location: string }> {
  lastTransferActionTimestamp = Date.now();
  const safeName = fileName.trim() || 'plik';

  if (dest.type === 'directory' && dest.handle) {
    let blob: Blob;
    if (typeof blobOrUrl === 'string') {
      const res = await fetch(blobOrUrl);
      blob = await res.blob();
    } else {
      blob = blobOrUrl;
    }
    const res = await saveFileToDirectory(dest.handle, blob, safeName);
    return { success: res.success, location: dest.name };
  } else {
    // Default Downloads
    saveFileToDefaultDownloads(blobOrUrl, safeName);
    return { success: true, location: 'Folder Pobrane' };
  }
}

export function setTransferDestinationDirectory(
  dirHandle: FileSystemDirectoryHandle,
  peerId?: string
): void {
  setActiveTransferDestination({
    type: 'directory',
    handle: dirHandle,
    name: dirHandle.name,
    peerId: peerId || undefined,
    createdAt: Date.now()
  });
}

export function getTransferDestinationDirectory(peerId?: string): {
  handle: FileSystemDirectoryHandle;
  name: string;
} | null {
  if (!activeTransferDirHandle) return null;
  // If peerId was specified and doesn't match
  if (peerId && activeTransferPeerId && activeTransferPeerId !== peerId) return null;
  // Expire after 30 minutes of inactivity
  if (Date.now() - lastTransferActionTimestamp > 30 * 60 * 1000) {
    clearTransferDestinationDirectory();
    return null;
  }
  return {
    handle: activeTransferDirHandle,
    name: activeTransferDirName || 'Wybrany folder',
  };
}

export function clearTransferDestinationDirectory(): void {
  activeTransferDirHandle = null;
  activeTransferDirName = null;
  activeTransferPeerId = null;
  try {
    sessionStorage.removeItem('peerdrop_active_dir_name');
  } catch {
    // Ignore
  }
}

export function isSubframe(): boolean {
  try {
    return typeof window !== 'undefined' && window.self !== window.top;
  } catch {
    return true;
  }
}

export type DirectoryPickerResult =
  | { success: true; handle: FileSystemDirectoryHandle; name: string }
  | { success: false; cancelled: true }
  | { success: false; cancelled: false; reason: 'iframe_subframe' | 'unsupported' | 'security_blocked' | 'error'; message?: string };

/**
 * Prompts user to pick a destination folder once for this transfer batch.
 */
export async function promptDirectoryDestination(peerId?: string): Promise<DirectoryPickerResult> {
  if (isSubframe()) {
    return {
      success: false,
      cancelled: false,
      reason: 'iframe_subframe',
      message: 'W oknie podglądu iFrame przeglądarka blokuje bezpośredni dostęp do dysku. Pliki zostaną zapisane do Twojego folderu Pobrane.'
    };
  }
  if (!isDirectoryPickerSupported()) {
    return {
      success: false,
      cancelled: false,
      reason: 'unsupported',
      message: 'Twoja przeglądarka nie obsługuje bezpośredniego wyboru folderu na dysku. Pliki zostaną zapisane do Pobranych.'
    };
  }
  try {
    const dirHandle: FileSystemDirectoryHandle = await (window as any).showDirectoryPicker({
      id: 'peerdrop_transfers_folder',
      mode: 'readwrite',
      startIn: 'downloads',
    });
    setTransferDestinationDirectory(dirHandle, peerId);
    return { success: true, handle: dirHandle, name: dirHandle.name };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return { success: false, cancelled: true };
    }
    console.warn('showDirectoryPicker failed:', err);
    return {
      success: false,
      cancelled: false,
      reason: err?.name === 'SecurityError' ? 'security_blocked' : 'error',
      message: err?.message
    };
  }
}

/**
 * Saves a single file directly into a chosen FileSystemDirectoryHandle.
 */
export async function saveFileToDirectory(
  dirHandle: FileSystemDirectoryHandle,
  blob: Blob,
  fileName: string
): Promise<{ success: boolean; fileName: string }> {
  try {
    const cleanName = fileName.trim() || 'plik';
    const fileHandle = await (dirHandle as any).getFileHandle(cleanName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    return { success: true, fileName: cleanName };
  } catch (err) {
    console.error(`Failed saving ${fileName} to directory handle, falling back to download:`, err);
    saveFileToDefaultDownloads(blob, fileName);
    return { success: true, fileName };
  }
}

/**
 * Saves multiple files in batch into a chosen FileSystemDirectoryHandle.
 */
export async function saveMultipleFilesToDirectory(
  dirHandle: FileSystemDirectoryHandle,
  files: { blob: Blob; fileName: string }[]
): Promise<{ savedCount: number; totalCount: number }> {
  let savedCount = 0;
  for (const item of files) {
    const res = await saveFileToDirectory(dirHandle, item.blob, item.fileName);
    if (res.success) {
      savedCount++;
    }
  }
  return { savedCount, totalCount: files.length };
}

export interface SaveFileOptions {
  blob: Blob;
  suggestedName: string;
  fileType?: string;
}

/**
 * Prompts the native OS "Save As..." dialog allowing user to select directory and filename.
 * Falls back to standard download if File System Access API is not supported.
 * Returns true if saved, false if cancelled by user.
 */
export async function saveFileWithCustomDestination({
  blob,
  suggestedName,
  fileType,
}: SaveFileOptions): Promise<{ success: boolean; cancelled?: boolean; method: 'picker' | 'fallback' }> {
  const safeName = suggestedName.trim() || 'plik';

  if (isSaveFilePickerSupported()) {
    try {
      const ext = safeName.includes('.') ? safeName.split('.').pop() || '' : '';
      const mime = fileType || blob.type || 'application/octet-stream';

      const pickerOptions: any = {
        suggestedName: safeName,
      };

      if (ext) {
        pickerOptions.types = [
          {
            description: `Plik ${ext.toUpperCase()}`,
            accept: {
              [mime]: [`.${ext}`],
            },
          },
        ];
      }

      // Open native OS file picker
      const handle = await (window as any).showSaveFilePicker(pickerOptions);
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { success: true, method: 'picker' };
    } catch (err: any) {
      // User cancelled picker (AbortError)
      if (err?.name === 'AbortError') {
        return { success: false, cancelled: true, method: 'picker' };
      }
      console.warn('showSaveFilePicker failed, falling back to download link:', err);
      // Fall through to fallback
    }
  }

  // Fallback: standard browser download
  saveFileToDefaultDownloads(blob, safeName);
  return { success: true, method: 'fallback' };
}

/**
 * Downloads file to browser default Downloads folder via temporary <a> tag
 */
export function saveFileToDefaultDownloads(blobOrUrl: Blob | string, fileName: string): void {
  let url = '';
  let shouldRevoke = false;
  const safeName = fileName.trim() || 'pobrany_plik';

  if (typeof blobOrUrl === 'string') {
    url = blobOrUrl;
  } else {
    // Ensure blob has a valid MIME type matching its extension for Android Downloads & Gallery recognition
    let finalBlob = blobOrUrl;
    const properMime = getMimeTypeForFileName(safeName);
    if ((!blobOrUrl.type || blobOrUrl.type === 'application/octet-stream') && properMime !== 'application/octet-stream') {
      finalBlob = new Blob([blobOrUrl], { type: properMime });
    }
    url = URL.createObjectURL(finalBlob);
    shouldRevoke = true;
  }

  const a = document.createElement('a');
  a.href = url;
  a.download = safeName;
  a.target = '_self';
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();

  // Remove <a> element after click, but preserve blob URL for 3 minutes (180,000 ms)
  // so browser download manager can finish streaming large multi-megabyte/gigabyte files to disk without interruption!
  setTimeout(() => {
    try {
      if (document.body.contains(a)) {
        document.body.removeChild(a);
      }
    } catch {
      // ignore
    }
  }, 1000);

  if (shouldRevoke) {
    setTimeout(() => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }, 180000); // 3 minutes
  }
}

/**
 * Open file in a new tab for preview if supported (images, PDFs, media, text)
 */
export function openFilePreview(blobOrUrl: Blob | string): void {
  let url = '';
  if (typeof blobOrUrl === 'string') {
    url = blobOrUrl;
  } else {
    url = URL.createObjectURL(blobOrUrl);
  }

  window.open(url, '_blank', 'noopener,noreferrer');
}
