import type { IncomingMessage, ServerResponse } from 'http';

export async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

export async function readJsonBody<T = unknown>(req: IncomingMessage): Promise<T> {
  const body = await readBody(req);
  if (!body) return {} as T;
  return JSON.parse(body) as T;
}

export function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

export function getAgentId(req: IncomingMessage): string | undefined {
  return req.headers['x-agent-id'] as string | undefined;
}
