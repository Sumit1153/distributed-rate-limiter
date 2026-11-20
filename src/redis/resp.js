import net from 'node:net';

export class RedisCommandError extends Error {}

// Minimal RESP2 codec, sufficient for PING and EVAL. Zero npm dependencies.
export function encodeCommand(args) {
  const chunks = [Buffer.from(`*${args.length}\r\n`)];
  for (const item of args) {
    const bytes = Buffer.from(String(item));
    chunks.push(Buffer.from(`$${bytes.length}\r\n`), bytes, Buffer.from('\r\n'));
  }
  return Buffer.concat(chunks);
}

export function parseReply(buffer, start = 0) {
  if (start >= buffer.length) return null;
  const kind = String.fromCharCode(buffer[start]);
  const end = buffer.indexOf('\r\n', start + 1);
  if (end === -1) return null;
  const header = buffer.toString('utf8', start + 1, end);
  const next = end + 2;
  if (kind === '+' || kind === '-' || kind === ':') {
    const value = kind === ':' ? Number(header) : kind === '-' ? new RedisCommandError(header) : header;
    return { value, offset: next };
  }
  if (kind === '$') {
    const len = Number(header);
    if (!Number.isSafeInteger(len) || len < -1) throw new Error('Invalid RESP bulk length');
    if (len === -1) return { value: null, offset: next };
    if (buffer.length < next + len + 2) return null;
    if (buffer[next + len] !== 13 || buffer[next + len + 1] !== 10) throw new Error('Invalid RESP bulk terminator');
    return { value: buffer.toString('utf8', next, next + len), offset: next + len + 2 };
  }
  if (kind === '*') {
    const len = Number(header);
    if (!Number.isSafeInteger(len) || len < -1 || len > 100000) throw new Error('Invalid RESP array length');
    if (len === -1) return { value: null, offset: next };
    const values = [];
    let at = next;
    for (let i = 0; i < len; i++) {
      const part = parseReply(buffer, at);
      if (!part) return null;
      values.push(part.value);
      at = part.offset;
    }
    return { value: values, offset: at };
  }
  throw new Error(`Unsupported RESP prefix: ${kind}`);
}

export class RedisRespClient {
  constructor({ url = 'redis://127.0.0.1:6379', timeoutMs = 500 } = {}) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'redis:') throw new Error('Only redis:// is supported');
    this.host = parsed.hostname;
    this.port = Number(parsed.port || 6379);
    this.timeoutMs = timeoutMs;
    this.socket = null;
    this.connecting = null;
    this.pending = [];
    this.buffer = Buffer.alloc(0);
    this.connected = false;
  }

  async ensureConnected() {
    if (this.connected && this.socket && !this.socket.destroyed) return;
    if (this.connecting) return this.connecting;
    this.connecting = new Promise((resolve, reject) => {
      const sock = net.createConnection({ host: this.host, port: this.port });
      this.socket = sock;
      this.buffer = Buffer.alloc(0);
      let settled = false;
      const startupTimeout = setTimeout(() => sock.destroy(new Error('Redis connect timeout')), this.timeoutMs);
      sock.once('connect', () => {
        clearTimeout(startupTimeout);
        this.connected = true;
        if (!settled) { settled = true; resolve(); }
      });
      sock.on('data', (data) => {
        this.buffer = Buffer.concat([this.buffer, data]);
        try {
          while (this.buffer.length) {
            const reply = parseReply(this.buffer);
            if (!reply) break;
            this.buffer = this.buffer.subarray(reply.offset);
            const entry = this.pending.shift();
            if (!entry) throw new Error('Unexpected Redis reply');
            clearTimeout(entry.timer);
            if (reply.value instanceof RedisCommandError) entry.reject(reply.value);
            else entry.resolve(reply.value);
          }
          if (this.buffer.length > 8 * 1024 * 1024) throw new Error('Redis response too large');
        } catch (error) { sock.destroy(error); }
      });
      const fail = (err) => {
        clearTimeout(startupTimeout);
        this.connected = false;
        if (this.socket === sock) this.socket = null;
        if (!settled) { settled = true; reject(err); }
        while (this.pending.length) {
          const entry = this.pending.shift();
          clearTimeout(entry.timer);
          entry.reject(err);
        }
      };
      sock.on('error', fail);
      sock.on('close', () => fail(new Error('Redis connection closed')));
    }).finally(() => { this.connecting = null; });
    return this.connecting;
  }

  async query(args) {
    await this.ensureConnected();
    const sock = this.socket;
    if (!sock || sock.destroyed) throw new Error('Redis unavailable');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => sock.destroy(new Error('Redis command timeout')), this.timeoutMs);
      this.pending.push({ resolve, reject, timer });
      try { sock.write(encodeCommand(args)); }
      catch (error) { sock.destroy(error); }
    });
  }

  async ping() { return this.query(['PING']); }
  close() { this.socket?.destroy(); }
}
