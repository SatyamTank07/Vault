export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const AUTH_TOKEN_KEY = 'vault_auth_token';
export const UNAUTHORIZED_EVENT = 'vault:unauthorized';

export interface CurrentUser {
  id: string;
  mobile_number: string;
  is_mobile_verified: boolean;
  has_set_vault: boolean;
  encrypted_master_seed: string | null;
  created_at: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: CurrentUser;
}

interface ApiFetchOptions {
  auth?: boolean;
  suppressUnauthorizedEvent?: boolean;
}

export function getAuthToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

export function setAuthToken(token: string) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

export function clearAuthToken() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
}

export async function apiFetch(
  path: string,
  init: RequestInit = {},
  options: ApiFetchOptions = {},
): Promise<Response> {
  const url = path.startsWith('http') ? path : `${API_BASE_URL}${path}`;
  const headers = new Headers(init.headers ?? {});

  if (options.auth !== false) {
    const token = getAuthToken();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, {
    ...init,
    headers,
  });

  if (response.status === 401 && options.auth !== false && !options.suppressUnauthorizedEvent) {
    window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
  }

  return response;
}

export async function getErrorMessage(response: Response, fallback = 'Request failed.'): Promise<string> {
  try {
    const data = await response.json();
    if (typeof data?.detail === 'string') {
      return data.detail;
    }
    if (typeof data?.message === 'string') {
      return data.message;
    }
  } catch {
    return fallback;
  }

  return fallback;
}

export function isProtectedUploadUrl(url: string): boolean {
  return url.includes('/api/uploads/');
}

function normalizeAssetUrl(url: string): URL {
  return new URL(url, API_BASE_URL);
}

export function removeAccessTokenFromUrl(url: string): string {
  try {
    const normalizedUrl = normalizeAssetUrl(url);
    if (!isProtectedUploadUrl(normalizedUrl.pathname)) {
      return normalizedUrl.toString();
    }
    normalizedUrl.searchParams.delete('access_token');
    return normalizedUrl.toString();
  } catch {
    return url;
  }
}

export function appendAccessTokenToUrl(url: string): string {
  try {
    const normalizedUrl = normalizeAssetUrl(removeAccessTokenFromUrl(url));
    if (!isProtectedUploadUrl(normalizedUrl.pathname)) {
      return normalizedUrl.toString();
    }

    const token = getAuthToken();
    if (token) {
      normalizedUrl.searchParams.set('access_token', token);
    }
    return normalizedUrl.toString();
  } catch {
    return url;
  }
}

function transformProtectedHtml(html: string, transform: (src: string) => string): string {
  if (!html || typeof DOMParser === 'undefined') {
    return html;
  }

  const parser = new DOMParser();
  const document = parser.parseFromString(html, 'text/html');
  const images = Array.from(document.querySelectorAll('img'));

  images.forEach((image) => {
    const src = image.getAttribute('src');
    if (!src) return;
    image.setAttribute('src', transform(src));
  });

  return document.body.innerHTML;
}

export function decorateProtectedHtml(html: string): string {
  return transformProtectedHtml(html, appendAccessTokenToUrl);
}

export function stripProtectedAssetTokens(html: string): string {
  return transformProtectedHtml(html, removeAccessTokenFromUrl);
}
