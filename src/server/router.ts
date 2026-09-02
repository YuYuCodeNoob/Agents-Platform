import type { IncomingMessage, ServerResponse } from 'http';

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>
) => Promise<void>;

interface Route {
  method: string;
  pattern: string;
  handler: RouteHandler;
}

export class Router {
  private routes: Route[] = [];

  add(method: string, pattern: string, handler: RouteHandler): void {
    this.routes.push({ method, pattern, handler });
  }

  get(pattern: string, handler: RouteHandler): void {
    this.add('GET', pattern, handler);
  }

  post(pattern: string, handler: RouteHandler): void {
    this.add('POST', pattern, handler);
  }

  put(pattern: string, handler: RouteHandler): void {
    this.add('PUT', pattern, handler);
  }

  delete(pattern: string, handler: RouteHandler): void {
    this.add('DELETE', pattern, handler);
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? 'GET';
    const url = req.url ?? '/';

    for (const route of this.routes) {
      if (route.method !== method) continue;

      const params = matchRoute(route.pattern, url);
      if (params !== null) {
        try {
          await route.handler(req, res, params);
        } catch (err) {
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal server error' }));
          }
          console.error('[Router] Handler error:', err);
        }
        return;
      }
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
}

function matchRoute(pattern: string, url: string): Record<string, string> | null {
  const patternParts = pattern.split('/').filter(Boolean);
  const urlParts = url.split('?')[0].split('/').filter(Boolean);

  if (patternParts.length !== urlParts.length && !pattern.endsWith('*')) return null;

  const params: Record<string, string> = {};

  for (let i = 0; i < patternParts.length; i++) {
    const p = patternParts[i];

    if (p === '*' && i === patternParts.length - 1) {
      return params;
    }

    if (p.startsWith(':')) {
      const key = p.slice(1);
      if (i < urlParts.length) {
        params[key] = decodeURIComponent(urlParts[i]);
      }
      continue;
    }

    if (p.endsWith('/*')) {
      const prefix = p.slice(0, -2);
      if (urlParts[i] !== prefix) return null;
      return params;
    }

    if (p !== urlParts[i]) return null;
  }

  if (pattern.endsWith('/*') && patternParts[patternParts.length - 1] === '*') {
    return params;
  }

  return params;
}
