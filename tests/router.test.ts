import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { Router } from '../src/server/router.js';
import type { IncomingMessage, ServerResponse } from 'http';

describe('Router', () => {
  test('matches exact path', async () => {
    const router = new Router();
    let called = false;
    router.get('/gateway/health', async () => { called = true; });

    const req = { method: 'GET', url: '/gateway/health', headers: {} } as unknown as IncomingMessage;
    const res = { writeHead: () => {}, end: () => {} } as unknown as ServerResponse;
    await router.handle(req, res);
    expect(called).toBe(true);
  });

  test('matches path with params', async () => {
    const router = new Router();
    let captured: Record<string, string> = {};
    router.get('/gateway/agents/:id', async (_req, _res, params) => { captured = params; });

    const req = { method: 'GET', url: '/gateway/agents/agent_123', headers: {} } as unknown as IncomingMessage;
    const res = { writeHead: () => {}, end: () => {} } as unknown as ServerResponse;
    await router.handle(req, res);
    expect(captured.id).toBe('agent_123');
  });

  test('returns 404 for unmatched routes', async () => {
    const router = new Router();
    const req = { method: 'GET', url: '/nonexistent', headers: {} } as unknown as IncomingMessage;
    const res = {
      writeHead: (status: number, _headers: unknown) => { (res as any).statusCode = status; },
      end: (data: string) => { (res as any).body = data; },
    } as unknown as ServerResponse;
    await router.handle(req, res);
    expect((res as any).statusCode).toBe(404);
  });
});
