// WebSocket link to the game server, with automatic reconnects.

export class Net {
  constructor(onMessage, onStatus) {
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.ws = null;
    this.open = false;
    this.retry = 0;
    this.rtt = 0;
    this.hello = null;
    this.connect();
    setInterval(() => this.ping(), 2000);
  }

  url() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  }

  connect() {
    let ws;
    try {
      ws = new WebSocket(this.url());
    } catch (e) {
      this.schedule();
      return;
    }
    this.ws = ws;
    this.onStatus('connecting');
    ws.onopen = () => {
      this.open = true;
      this.retry = 0;
      this.onStatus('online');
      if (this.hello) this.send(this.hello);
    };
    ws.onmessage = (e) => {
      let m;
      try {
        m = JSON.parse(e.data);
      } catch (err) {
        return;
      }
      if (m.t === 'pong') {
        this.rtt = Math.round(performance.now() - m.c);
        return;
      }
      this.onMessage(m);
    };
    ws.onclose = () => {
      const was = this.open;
      this.open = false;
      this.onStatus(was ? 'lost' : 'offline');
      this.schedule();
    };
    ws.onerror = () => {};
  }

  schedule() {
    this.retry++;
    setTimeout(() => this.connect(), Math.min(8000, 600 * this.retry));
  }

  send(obj) {
    if (this.open && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  setHello(obj) {
    this.hello = obj;
    this.send(obj);
  }

  ping() {
    this.send({ t: 'ping', c: performance.now(), rtt: this.rtt });
  }
}
