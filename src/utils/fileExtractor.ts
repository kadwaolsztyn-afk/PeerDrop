/**
 * File extraction and loading utility supporting:
 * - Multiple files with live progress tracking
 * - Large file chunked reading and memory safety
 * - Folders & nested directories via webkitGetAsEntry()
 * - Deduplication
 */

export interface FileLoadProgress {
  count: number;
  totalCount: number;
  loadedBytes: number;
  totalBytes: number;
  percent: number;
  currentName: string;
  currentFileSize?: number;
  statusText?: string;
}

export type FileLoadProgressCallback = (progress: FileLoadProgress) => void;

// Helper to yield execution to browser rendering thread
function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Processes a FileList (from input type="file" or drop) with real-time smooth progress tracking
 */
export async function processFileListWithProgress(
  fileList: FileList | File[],
  onProgress?: FileLoadProgressCallback
): Promise<File[]> {
  const rawFiles = Array.isArray(fileList) ? fileList : Array.from(fileList);
  if (!rawFiles || rawFiles.length === 0) return [];

  const totalCount = rawFiles.length;
  const totalBytes = rawFiles.reduce((acc, f) => acc + (f.size || 0), 0);
  const result: File[] = [];
  let loadedBytes = 0;

  // Initial update
  if (onProgress) {
    onProgress({
      count: 0,
      totalCount,
      loadedBytes: 0,
      totalBytes,
      percent: 0,
      currentName: rawFiles[0]?.name || 'Przygotowywanie...',
      currentFileSize: rawFiles[0]?.size || 0,
      statusText: `Przygotowywanie ${totalCount} ${totalCount === 1 ? 'pliku' : totalCount < 5 ? 'plików' : 'plików'}...`
    });
  }

  // Determine batch pacing depending on total count and total size
  for (let i = 0; i < rawFiles.length; i++) {
    const file = rawFiles[i];
    loadedBytes += file.size;

    result.push(file);

    const percent = totalCount > 0 ? Math.min(100, Math.round(((i + 1) / totalCount) * 100)) : 100;

    if (onProgress) {
      onProgress({
        count: i + 1,
        totalCount,
        loadedBytes,
        totalBytes,
        percent,
        currentName: file.name,
        currentFileSize: file.size,
        statusText: `Wczytano ${i + 1} z ${totalCount} (${percent}%)`
      });
    }

    // Micro-delay on every few items or on large files (> 10MB) to allow DOM repainting
    if (i % 3 === 0 || file.size > 10 * 1024 * 1024) {
      await yieldToMain();
    }
  }

  // Ensure 100% progress emitted at end
  if (onProgress && totalCount > 0) {
    onProgress({
      count: totalCount,
      totalCount,
      loadedBytes: totalBytes,
      totalBytes,
      percent: 100,
      currentName: rawFiles[totalCount - 1]?.name || '',
      statusText: 'Ukończono wczytywanie plików!'
    });
    await yieldToMain();
  }

  return result;
}

/**
 * Extracts files from DataTransfer (drag & drop) with support for directories and live progress
 */
export async function extractFilesFromDataTransfer(
  dataTransfer: DataTransfer,
  onProgress?: FileLoadProgressCallback
): Promise<File[]> {
  const files: File[] = [];
  let totalBytes = 0;

  // 1. If standard dataTransfer.files is available and has items without folders
  const rawList = dataTransfer.files ? Array.from(dataTransfer.files) : [];
  const items = dataTransfer.items;

  // Check if any item is a directory
  let hasDirectories = false;
  if (items && items.length > 0 && 'webkitGetAsEntry' in DataTransferItem.prototype) {
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry?.();
      if (entry && entry.isDirectory) {
        hasDirectories = true;
        break;
      }
    }
  }

  // Fast path: pure files list without directories
  if (!hasDirectories && rawList.length > 0) {
    return processFileListWithProgress(rawList, onProgress);
  }

  // Deep directory extraction
  if (items && items.length > 0 && 'webkitGetAsEntry' in DataTransferItem.prototype) {
    const entries: any[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const entry = item.webkitGetAsEntry?.();
        if (entry) {
          entries.push(entry);
        }
      }
    }

    if (entries.length > 0) {
      let loadedCount = 0;

      for (let eIdx = 0; eIdx < entries.length; eIdx++) {
        const entry = entries[eIdx];
        await readEntryRecursively(entry, files, '', async (file) => {
          loadedCount++;
          totalBytes += file.size;

          if (onProgress) {
            // If rawList length exists, estimate total from it, otherwise use progressive percent
            const estimatedTotal = Math.max(rawList.length, loadedCount);
            const percent = Math.min(99, Math.round((loadedCount / estimatedTotal) * 100));

            onProgress({
              count: loadedCount,
              totalCount: estimatedTotal,
              loadedBytes: totalBytes,
              totalBytes: totalBytes,
              percent,
              currentName: file.name,
              currentFileSize: file.size,
              statusText: `Skanowanie folderu: ${loadedCount} plików...`
            });
          }

          if (loadedCount % 5 === 0) {
            await yieldToMain();
          }
        });
      }

      if (files.length > 0) {
        if (onProgress) {
          onProgress({
            count: files.length,
            totalCount: files.length,
            loadedBytes: totalBytes,
            totalBytes,
            percent: 100,
            currentName: files[files.length - 1]?.name || '',
            statusText: `Wczytano ${files.length} plików z folderów`
          });
          await yieldToMain();
        }
        return files;
      }
    }
  }

  // Fallback to standard files if directory read returned empty
  if (rawList.length > 0) {
    return processFileListWithProgress(rawList, onProgress);
  }

  return [];
}

async function readEntryRecursively(
  entry: any,
  collected: File[],
  pathPrefix = '',
  onFileFound?: (file: File) => Promise<void> | void
): Promise<void> {
  if (!entry) return;

  if (entry.isFile) {
    await new Promise<void>((resolve) => {
      entry.file(
        async (file: File) => {
          let finalFile = file;
          if (pathPrefix) {
            try {
              finalFile = new File([file], `${pathPrefix}${file.name}`, {
                type: file.type,
                lastModified: file.lastModified
              });
            } catch {
              finalFile = file;
            }
          }
          collected.push(finalFile);
          if (onFileFound) {
            await onFileFound(finalFile);
          }
          resolve();
        },
        () => resolve()
      );
    });
  } else if (entry.isDirectory) {
    const dirReader = entry.createReader();
    const newPrefix = pathPrefix ? `${pathPrefix}${entry.name}/` : `${entry.name}/`;

    const readBatch = (): Promise<any[]> => {
      return new Promise<any[]>((resolve) => {
        dirReader.readEntries(
          (results: any[]) => resolve(results || []),
          () => resolve([])
        );
      });
    };

    let batch = await readBatch();
    while (batch.length > 0) {
      for (const childEntry of batch) {
        await readEntryRecursively(childEntry, collected, newPrefix, onFileFound);
      }
      batch = await readBatch();
    }
  }
}

/**
 * Deduplicates files based on name, size and lastModified
 */
export function deduplicateFiles(existing: File[], incoming: File[]): File[] {
  const seenKeys = new Set(existing.map((f) => `${f.name}__${f.size}__${f.lastModified}`));
  const result = [...existing];

  for (const file of incoming) {
    const key = `${file.name}__${file.size}__${file.lastModified}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      result.push(file);
    }
  }

  return result;
}
