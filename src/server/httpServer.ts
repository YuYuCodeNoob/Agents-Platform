import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import type { GatewayConfig } from '../config/index.js';
import { Router } from './router.js';

export class HttpServer {
  private server: ReturnType<typeof createServer>;
  public router: Router;

  constructor(private config: GatewayConfig) {
    this.router = new Router();
    this.server = createServer((req, res) => this.handleRequest(req, res));
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Agent-Id, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    await this.router.handle(req, res);
  }

  start(): void {
    this.server.listen(this.config.port, this.config.host, () => {
      console.log(`[Gateway Proxy] HTTP server listening on http://${this.config.host}:${this.config.port}`);
    });
  }

  stop(): void {
    this.server.close();
  }
}
