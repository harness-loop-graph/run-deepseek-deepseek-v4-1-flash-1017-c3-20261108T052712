/**
 * Browser download helper (EP-14).
 *
 * The attachment bytes always arrive through the authenticated API client, so
 * the file is saved from an object URL that only this page can read; the URL
 * is revoked as soon as the browser has started the download (RF-17).
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Give the browser a tick to start the transfer before revoking the URL.
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** Human-readable size of an attachment (`12.3 kB`, `1.2 MB`). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} kB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
