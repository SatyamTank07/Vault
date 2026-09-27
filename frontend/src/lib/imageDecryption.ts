import { useState, useEffect } from 'react';
import { apiFetch, isProtectedUploadUrl } from './api';
import { decryptImageBuffer, getActiveVaultKey } from './crypto';

// In-memory cache of decrypted blob URLs: maps normalized path (e.g., /api/uploads/<noteId>/<filename>) to blob: URL
const decryptedBlobUrlCache = new Map<string, string>();
const pendingDecryptionPromises = new Map<string, Promise<string>>();

/**
 * Extracts a normalized pathname from a URL (e.g. "/api/uploads/123/file.enc")
 * stripping origin and query parameters.
 */
export function extractUploadKey(url: string): string {
  if (!url) return '';
  try {
    const parsed = new URL(url, 'http://localhost');
    return parsed.pathname;
  } catch {
    return url.split('?')[0];
  }
}

/**
 * Retrieves a cached decrypted blob URL for a given server image path if available.
 */
export function getCachedDecryptedUrl(url: string): string | null {
  if (!url) return null;
  const key = extractUploadKey(url);
  return decryptedBlobUrlCache.get(key) || null;
}

/**
 * Caches an ephemeral decrypted blob URL for a server URL.
 */
export function cacheDecryptedBlobUrl(serverUrl: string, blobUrl: string): void {
  if (!serverUrl || !blobUrl) return;
  const key = extractUploadKey(serverUrl);
  decryptedBlobUrlCache.set(key, blobUrl);
}

/**
 * Clears and revokes all decrypted object URLs in memory.
 */
export function clearDecryptedImageCache(): void {
  decryptedBlobUrlCache.forEach((blobUrl) => {
    try {
      URL.revokeObjectURL(blobUrl);
    } catch {
      // ignore
    }
  });
  decryptedBlobUrlCache.clear();
  pendingDecryptionPromises.clear();
}

/**
 * Fetches an encrypted image from the backend, decrypts it client-side with the vault key,
 * and creates an ephemeral object URL.
 */
export async function fetchAndDecryptImage(
  url: string,
  key?: CryptoKey | null
): Promise<string> {
  const cleanKey = extractUploadKey(url);
  const cached = decryptedBlobUrlCache.get(cleanKey);
  if (cached) {
    return cached;
  }

  const inFlight = pendingDecryptionPromises.get(cleanKey);
  if (inFlight) {
    return inFlight;
  }

  const promise = (async () => {
    try {
      const response = await apiFetch(cleanKey);
      if (!response.ok) {
        throw new Error(`Failed to load image: ${response.status} ${response.statusText}`);
      }

      const buffer = await response.arrayBuffer();
      const cryptoKey = key || getActiveVaultKey();

      let blob: Blob;
      if (cryptoKey) {
        blob = await decryptImageBuffer(buffer, cryptoKey);
      } else {
        const contentType = response.headers.get('content-type') || 'image/png';
        blob = new Blob([buffer], { type: contentType });
      }

      const blobUrl = URL.createObjectURL(blob);
      decryptedBlobUrlCache.set(cleanKey, blobUrl);
      return blobUrl;
    } finally {
      pendingDecryptionPromises.delete(cleanKey);
    }
  })();

  pendingDecryptionPromises.set(cleanKey, promise);
  return promise;
}

/**
 * Replaces all /api/uploads/ image sources in an HTML string with cached decrypted blob URLs if available.
 */
export function replaceHtmlWithDecryptedImages(html: string): string {
  if (!html || typeof DOMParser === 'undefined' || !html.includes('/api/uploads/')) {
    return html;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const images = Array.from(doc.querySelectorAll('img'));
  let modified = false;

  images.forEach((img) => {
    const src = img.getAttribute('src');
    if (!src || !isProtectedUploadUrl(src)) return;

    const key = extractUploadKey(src);
    const cached = decryptedBlobUrlCache.get(key);
    if (cached && img.getAttribute('src') !== cached) {
      img.setAttribute('src', cached);
      modified = true;
    }
  });

  return modified ? doc.body.innerHTML : html;
}

/**
 * React hook to decrypt all /api/uploads/ images in an HTML content string.
 * Returns the HTML string with decrypted blob: URLs substituted.
 */
export function useDecryptedHtml(html: string, cryptoKey?: CryptoKey | null): string {
  const [renderedHtml, setRenderedHtml] = useState<string>(() => replaceHtmlWithDecryptedImages(html));

  useEffect(() => {
    let isMounted = true;
    const current = replaceHtmlWithDecryptedImages(html);
    setRenderedHtml(current);

    if (!html || typeof DOMParser === 'undefined' || !html.includes('/api/uploads/')) {
      return;
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const images = Array.from(doc.querySelectorAll('img'));
    const uncachedUrls: string[] = [];

    images.forEach((img) => {
      const src = img.getAttribute('src');
      if (src && isProtectedUploadUrl(src)) {
        const key = extractUploadKey(src);
        if (!decryptedBlobUrlCache.has(key) && !uncachedUrls.includes(src)) {
          uncachedUrls.push(src);
        }
      }
    });

    if (uncachedUrls.length === 0) {
      return;
    }

    const key = cryptoKey || getActiveVaultKey();
    Promise.all(
      uncachedUrls.map((url) =>
        fetchAndDecryptImage(url, key).catch((err) => {
          console.error('Failed to decrypt note image:', url, err);
          return null;
        })
      )
    ).then(() => {
      if (isMounted) {
        setRenderedHtml(replaceHtmlWithDecryptedImages(html));
      }
    });

    return () => {
      isMounted = false;
    };
  }, [html, cryptoKey]);

  return renderedHtml;
}

/**
 * React hook to decrypt a single image URL.
 */
export function useDecryptedImageUrl(
  src: string,
  cryptoKey?: CryptoKey | null
): { blobUrl: string | null; loading: boolean; error: boolean } {
  const isProtected = isProtectedUploadUrl(src);
  const initialCached = isProtected ? getCachedDecryptedUrl(src) : src;

  const [blobUrl, setBlobUrl] = useState<string | null>(initialCached);
  const [loading, setLoading] = useState<boolean>(isProtected && !initialCached);
  const [error, setError] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;

    if (!isProtected) {
      setBlobUrl(src);
      setLoading(false);
      setError(false);
      return;
    }

    const cached = getCachedDecryptedUrl(src);
    if (cached) {
      setBlobUrl(cached);
      setLoading(false);
      setError(false);
      return;
    }

    setLoading(true);
    setError(false);

    const key = cryptoKey || getActiveVaultKey();
    fetchAndDecryptImage(src, key)
      .then((decryptedUrl) => {
        if (isMounted) {
          setBlobUrl(decryptedUrl);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error('Failed to decrypt image URL:', src, err);
        if (isMounted) {
          setError(true);
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [src, cryptoKey, isProtected]);

  return { blobUrl, loading, error };
}
