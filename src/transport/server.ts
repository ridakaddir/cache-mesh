import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Op, SnapshotEntry } from '../store/types.js';
import { type Logger, noopLogger } from '../util/logger.js';
import { NS_HEADER, SIG_HEADER, TS_HEADER, verify } from './auth.js';

export type SyncServerOptions<V> = {
  port: number;
  host?: string;
  namespace: string;
  hmacSecret: string;
  onOp: (op: Op<V>) => void;
  snapshot: () => Iterable<SnapshotEntry<V>>;
  logger?: Logger;
  /** Max request body in bytes. Default 2 MiB. */
  maxBodyBytes?: number;
};

const DEFAULT_MAX_BODY = 2 * 1024 * 1024;

export class SyncServer<V> {
  private server: Server | undefined;
  private readonly logger: Logger;
  private readonly maxBody: number;

  constructor(private readonly opts: SyncServerOptions<V>) {
    this.logger = opts.logger ?? noopLogger;
    this.maxBody = opts.maxBodyBytes ?? DEFAULT_MAX_BODY;
  }

  async start(): Promise<void> {
    if (this.server) return;
    const server = createServer((req, res) => {
      this.handle(req, res).catch((err) => {
        this.logger.error('request handler threw', err);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.end();
        } else {
          res.end();
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.opts.port, this.opts.host ?? '0.0.0.0', () => {
        server.off('error', reject);
        resolve();
      });
    });
    this.server = server;
  }

  async stop(): Promise<void> {
    const s = this.server;
    if (!s) return;
    this.server = undefined;
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }

  address(): { port: number } | undefined {
    const addr = this.server?.address();
    if (addr && typeof addr === 'object') return { port: addr.port };
    return undefined;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? '';
    const method = req.method ?? 'GET';

    if (method === 'GET' && url === '/sync/health') {
      res.statusCode = 200;
      res.setHeader('content-type', 'text/plain');
      res.end('ok');
      return;
    }

    const ns = header(req, NS_HEADER);
    if (ns !== this.opts.namespace) {
      res.statusCode = 404;
      res.end();
      return;
    }

    if (method === 'POST' && url === '/sync/op') {
      const body = await readBody(req, this.maxBody);
      if (body === null) {
        res.statusCode = 413;
        res.end();
        return;
      }
      const v = verify({
        secret: this.opts.hmacSecret,
        ts: header(req, TS_HEADER),
        sig: header(req, SIG_HEADER),
        method,
        path: url,
        body,
      });
      if (!v.ok) {
        this.logger.warn(`/sync/op auth rejected: ${v.reason}`);
        res.statusCode = 401;
        res.end();
        return;
      }
      let op: Op<V>;
      try {
        op = JSON.parse(body) as Op<V>;
      } catch {
        res.statusCode = 400;
        res.end();
        return;
      }
      try {
        this.opts.onOp(op);
      } catch (err) {
        this.logger.error('onOp threw', err);
      }
      res.statusCode = 204;
      res.end();
      return;
    }

    if (method === 'GET' && url === '/sync/snapshot') {
      const v = verify({
        secret: this.opts.hmacSecret,
        ts: header(req, TS_HEADER),
        sig: header(req, SIG_HEADER),
        method,
        path: url,
        body: '',
      });
      if (!v.ok) {
        res.statusCode = 401;
        res.end();
        return;
      }
      res.statusCode = 200;
      res.setHeader('content-type', 'application/x-ndjson');
      for (const entry of this.opts.snapshot()) {
        res.write(JSON.stringify(entry));
        res.write('\n');
      }
      res.end();
      return;
    }

    res.statusCode = 404;
    res.end();
  }
}

function header(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  if (Array.isArray(v)) return v[0];
  return v;
}

async function readBody(req: IncomingMessage, max: number): Promise<string | null> {
  let size = 0;
  const parts: Buffer[] = [];
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
    size += buf.length;
    if (size > max) return null;
    parts.push(buf);
  }
  return Buffer.concat(parts).toString('utf8');
}
