// Bridge from the browser tab to the local desktop agent (agent/index.js).
// Browsers can't move the OS cursor, so the screen owner runs a tiny native helper
// on 127.0.0.1 that turns forwarded input events into real mouse/keyboard input.
export const AGENT_URL = 'ws://127.0.0.1:47800';

export class AgentBridge {
  constructor(onStatus) {
    this.onStatus = onStatus;
    this.ws = null;
  }

  connect() {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    this.onStatus('connecting');
    const ws = new WebSocket(AGENT_URL);
    this.ws = ws;
    ws.onopen = () => this.onStatus('on');
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      this.onStatus('off');
    };
    ws.onerror = () => ws.close();
  }

  send(event) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(event));
  }

  /** Lift any held buttons/keys, e.g. when control is revoked mid-drag. */
  releaseAll() {
    this.send({ t: 'reset' });
  }

  close() {
    this.releaseAll();
    this.ws?.close();
  }
}
