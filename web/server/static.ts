/**
 * Static files of the built client (web/dist). Vite's content-hashed /assets/ are cached for a
 * year; everything else (index.html above all) revalidates on every load so a rebuilt client is
 * picked up at once. Text assets are gzipped once per file version, off the event loop. Request
 * paths resolve inside the root only: dot segments, encoded separators and dotfiles never match.
 */
import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';

const gzipAsync = promisify(gzip);

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.glb': 'model/gltf-binary',
  '.bin': 'application/octet-stream',
};

/** Worth gzipping (fonts and images are compressed already). */
const COMPRESSIBLE: Record<string, true> = {
  '.html': true,
  '.js': true,
  '.mjs': true,
  '.css': true,
  '.json': true,
  '.map': true,
  '.webmanifest': true,
  '.txt': true,
  '.svg': true,
  '.wasm': true,
};

const IMMUTABLE = 'public, max-age=31536000, immutable';
const REVALIDATE = 'no-cache';

interface CachedFile {
  mtimeMs: number;
  size: number;
  etag: string;
  body: Buffer;
  gz: Buffer | null;
}

export type StaticHandler = (req: IncomingMessage, res: ServerResponse, pathname: string) => Promise<void>;

/** `pathname` is the request path already split from its query (still percent-encoded). */
export function createStaticHandler(rootDir: string): StaticHandler {
  const root = resolve(rootDir);
  const cache = new Map<string, Promise<CachedFile>>();

  async function load(file: string, mtimeMs: number, size: number): Promise<CachedFile> {
    const body = await readFile(file);
    const ext = extname(file);
    const gz = Object.hasOwn(COMPRESSIBLE, ext) && body.length > 1024 ? await gzipAsync(body, { level: 9 }) : null;
    return { mtimeMs, size, etag: `W/"${size.toString(36)}-${Math.floor(mtimeMs).toString(36)}"`, body, gz };
  }

  return async (req, res, pathname) => {
    const file = resolveInside(root, pathname);
    const info = file === null ? null : await stat(file).catch(() => null);
    if (file === null || info === null || !info.isFile()) {
      if (pathname === '/' || pathname === '/index.html') {
        send(res, 503, 'text/plain; charset=utf-8', 'The client is not built yet: run `npm run build` in web/ (./host.sh does it for you).\n');
      } else {
        send(res, 404, 'text/plain; charset=utf-8', 'Not found\n');
      }
      return;
    }
    let pending = cache.get(file);
    const known = pending ? await pending.catch(() => null) : null;
    if (!pending || !known || known.mtimeMs !== info.mtimeMs || known.size !== info.size) {
      pending = load(file, info.mtimeMs, info.size);
      cache.set(file, pending);
    }
    const entry = await pending.catch(() => null);
    if (!entry) {
      cache.delete(file);
      send(res, 404, 'text/plain; charset=utf-8', 'Not found\n');
      return;
    }
    const ext = extname(file);
    const headers: Record<string, string> = {
      'Content-Type': Object.hasOwn(CONTENT_TYPES, ext) ? CONTENT_TYPES[ext] : 'application/octet-stream',
      'Cache-Control': pathname.startsWith('/assets/') ? IMMUTABLE : REVALIDATE,
      ETag: entry.etag,
      'Last-Modified': new Date(entry.mtimeMs).toUTCString(),
      'X-Content-Type-Options': 'nosniff',
    };
    if (entry.gz) headers.Vary = 'Accept-Encoding';
    if (req.headers['if-none-match'] === entry.etag) {
      res.writeHead(304, headers);
      res.end();
      return;
    }
    const accepts = req.headers['accept-encoding'];
    const zipped = entry.gz !== null && typeof accepts === 'string' && /\bgzip\b/.test(accepts);
    const body = zipped && entry.gz ? entry.gz : entry.body;
    if (zipped) headers['Content-Encoding'] = 'gzip';
    headers['Content-Length'] = String(body.length);
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  };
}

/** Absolute file for a request path, or null when it is malformed or would leave `root`. */
function resolveInside(root: string, pathname: string): string | null {
  let path: string;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (path.includes('\0') || !path.startsWith('/')) return null;
  if (path.endsWith('/')) path += 'index.html';
  // '..' and '.' segments, and dotfiles (e.g. Vite's .vite/ manifests), are never public.
  for (const segment of path.split('/')) if (segment.startsWith('.')) return null;
  const file = resolve(root, `.${path}`);
  return file.startsWith(root + sep) ? file : null;
}

export function send(res: ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': String(Buffer.byteLength(body)),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}
