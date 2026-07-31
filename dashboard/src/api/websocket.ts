// Use relative path — Vite dev proxy and Nginx production proxy handle routing
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL = `${protocol}//${window.location.host}/ws`;

export type WsMessage =
  | { type: 'balance'; data: import('../api/client').Balance }
  | { type: 'opportunity'; data: import('../api/client').Opportunity }
  | { type: 'trade'; data: import('../api/client').Trade }
  | { type: 'position'; data: import('../api/client').Position }
  | { type: 'dex_latency'; data: import('../api/client').DexLatency[] }
  | { type: 'system_metrics'; data: import('../api/client').SystemMetrics }
  | { type: 'pnl_update'; data: import('../api/client').PnlSummary }
  | { type: 'ping' };

type MessageHandler = (msg: WsMessage) => void;

export class RealtimeClient {
  private ws: WebSocket | null = null;
  private handlers = new Set<MessageHandler>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private url: string;
  private _connected = false;

  constructor(url = WS_URL) {
    this.url = url;
  }

  get connected() {
    return this._connected;
  }

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this._connected = true;
      this.notifyHandlers({ type: 'ping' } as WsMessage); // triggers connection state update

      // Ping every 30s to keep alive
      this.pingTimer = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 30000);
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as WsMessage;
        this.notifyHandlers(msg);
      } catch {
        // ignore non-JSON messages
      }
    };

    this.ws.onclose = () => {
      this._connected = false;
      this.cleanup();
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  disconnect() {
    this.cleanup();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this._connected = false;
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  private notifyHandlers(msg: WsMessage) {
    for (const handler of this.handlers) {
      try {
        handler(msg);
      } catch {
        // handler error - don't let one break others
      }
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 3000);
  }

  private cleanup() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}

// Singleton
export const realtimeClient = new RealtimeClient();