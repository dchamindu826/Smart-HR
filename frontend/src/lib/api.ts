/**
 * The one way the web talks to the backend. Same-origin /api/v1, cookies carry
 * the session. On a 401 it refreshes once and retries. Errors come back as
 * ApiError with the backend's message, ready to show to the user.
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

type Json = Record<string, unknown> | unknown[] | null;

const BASE = '/api/v1';
let refreshing: Promise<boolean> | null = null;

async function refresh(platform: boolean): Promise<boolean> {
  if (platform) return false;
  if (!refreshing) {
    refreshing = fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include', headers: { 'x-smarthr-client': 'web', 'content-type': 'application/json' }, body: '{}' })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => setTimeout(() => (refreshing = null), 0));
  }
  return refreshing;
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: Json | FormData;
  signal?: AbortSignal;
  raw?: boolean; // return the Response (downloads)
}

export function qs(query?: RequestOptions['query']): string {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

async function request<T>(method: string, path: string, opts: RequestOptions = {}, retry = true): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData;
  const headers: Record<string, string> = { 'x-smarthr-client': 'web' };
  if (opts.body !== undefined && !isForm) headers['content-type'] = 'application/json';
  const res = await fetch(`${BASE}${path}${qs(opts.query)}`, {
    method,
    credentials: 'include',
    headers,
    body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
    signal: opts.signal,
    cache: 'no-store',
  });
  const platform = path.startsWith('/platform');
  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    if (await refresh(platform)) return request<T>(method, path, opts, false);
    if (typeof window !== 'undefined') {
      const here = window.location.pathname;
      const login = platform || here.startsWith('/admin') ? '/admin/login' : '/login';
      if (!here.startsWith(login)) window.location.href = `${login}?next=${encodeURIComponent(here + window.location.search)}`;
    }
  }
  if (opts.raw && res.ok) return res as unknown as T;
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const e = (data as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiError(res.status, e?.code ?? 'ERROR', e?.message ?? `Request failed (${res.status})`, e?.details);
  }
  return data as T;
}

export const api = {
  get: <T = unknown>(path: string, query?: RequestOptions['query'], signal?: AbortSignal) => request<T>('GET', path, { query, signal }),
  post: <T = unknown>(path: string, body?: Json | FormData) => request<T>('POST', path, { body: body ?? {} }),
  put: <T = unknown>(path: string, body?: Json) => request<T>('PUT', path, { body: body ?? {} }),
  patch: <T = unknown>(path: string, body?: Json) => request<T>('PATCH', path, { body: body ?? {} }),
  del: <T = unknown>(path: string, body?: Json) => request<T>('DELETE', path, { body: body ?? {} }),
  upload: <T = unknown>(path: string, file: File, fields: Record<string, string> = {}) => {
    const fd = new FormData();
    fd.append('file', file);
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    return request<T>('POST', path, { body: fd });
  },
};

/** Opens a backend file (xlsx, csv, pdf) as a download. */
export async function download(path: string, query?: RequestOptions['query'], fallbackName = 'download') {
  const res = await request<Response>('GET', path, { query, raw: true });
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const name = /filename="?([^";]+)"?/.exec(cd)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** URL for <img>/<iframe> of an authenticated backend file. */
export const fileUrl = (path: string, query?: RequestOptions['query']) => `${BASE}${path}${qs(query)}`;

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong.';
}
