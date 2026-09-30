// Meeting engine: owns the signaling socket, one RTCPeerConnection per peer (mesh),
// local media (mic / camera / screen), and the remote-control protocol.
// React subscribes through useMeeting() — this file has no React in it.
import { AgentBridge } from './agent.js';

// Fallback only — the server's /api/ice supplies the real list (incl. TURN, set via env vars).
const DEFAULT_ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

const KINDS = ['mic', 'camera', 'screen'];

export class Meeting {
  constructor({ room, name }) {
    this.room = room;
    this.name = name;
    this.listeners = new Set();
    this.conns = new Map(); // peerId -> { pc, dc, polite, makingOffer, ignoreOffer, senders }
    this.local = { mic: null, camera: null, screen: null };
    this.iceServers = DEFAULT_ICE;
    this.agent = new AgentBridge((status) => this.set({ agent: status }));

    this.state = {
      status: 'connecting', // connecting | joined | closed
      error: null,
      selfId: null,
      peers: [], // [{ id, name, host, state }] incl. self
      remote: {}, // peerId -> { [streamId]: MediaStream }
      links: {}, // peerId -> RTCPeerConnection.connectionState
      me: { muted: false, video: false, sharing: false, screenAudio: false, surface: null, streams: {} },
      local: { camera: null, screen: null },
      // Remote control
      canControl: [], // peers who granted ME control of their screen
      controllers: [], // peers I granted control of MY screen
      requests: [], // incoming requests awaiting my answer
      pending: [], // my outgoing requests
      agent: 'off', // off | connecting | on
      lastInputFrom: null,
    };
  }

  // ---------- store ----------
  subscribe = (fn) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.state;
  set(patch) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  // ---------- lifecycle ----------
  async start() {
    try {
      this.local.mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      this.set({ me: { ...this.state.me, muted: true } });
    }

    try {
      const res = await fetch('/api/ice');
      if (res.ok) this.iceServers = (await res.json()).iceServers;
    } catch {}

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws.onopen = () => this.send({ type: 'join', room: this.room, name: this.name });
    this.ws.onmessage = (e) => this.onMessage(JSON.parse(e.data));
    this.ws.onclose = () => {
      if (this.state.status !== 'closed') this.set({ status: 'closed', error: 'Disconnected from server' });
    };
  }

  leave() {
    this.set({ status: 'closed' });
    for (const id of [...this.conns.keys()]) this.dropPeer(id);
    for (const s of Object.values(this.local)) s?.getTracks().forEach((t) => t.stop());
    this.agent.close();
    this.ws?.close();
  }

  send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  publishState() {
    const streams = {};
    for (const k of KINDS) if (this.local[k]) streams[k] = this.local[k].id;
    const me = { ...this.state.me, streams };
    this.set({ me });
    this.send({ type: 'state', state: me });
  }

  // ---------- signaling ----------
  onMessage(msg) {
    switch (msg.type) {
      case 'welcome':
        this.set({ selfId: msg.id, status: 'joined' });
        this.publishState();
        break;
      case 'roster':
        this.onRoster(msg.peers);
        break;
      case 'signal':
        this.onSignal(msg.from, msg.data);
        break;
      case 'control':
        this.onControl(msg.from, msg.action);
        break;
      case 'error':
        this.set({ error: msg.message, status: 'closed' });
        break;
    }
  }

  onRoster(peers) {
    const self = this.state.selfId;
    const ids = new Set(peers.map((p) => p.id));
    for (const id of this.conns.keys()) if (!ids.has(id)) this.dropPeer(id);
    for (const p of peers) if (p.id !== self) this.getConn(p.id);

    // Screen owner stopped sharing -> any control I had over it is gone.
    const sharing = new Set(peers.filter((p) => p.state?.sharing).map((p) => p.id));
    this.set({
      peers,
      canControl: this.state.canControl.filter((id) => sharing.has(id)),
      pending: this.state.pending.filter((id) => sharing.has(id)),
    });
  }

  dropPeer(id) {
    const c = this.conns.get(id);
    if (c) {
      c.pc.close();
      this.conns.delete(id);
    }
    const { [id]: _, ...remote } = this.state.remote;
    const { [id]: __, ...links } = this.state.links;
    const without = (arr) => arr.filter((x) => x !== id);
    this.set({
      remote,
      links,
      canControl: without(this.state.canControl),
      controllers: without(this.state.controllers),
      requests: without(this.state.requests),
      pending: without(this.state.pending),
    });
  }

  getConn(id) {
    let c = this.conns.get(id);
    if (c) return c;

    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    // Exactly one side of each pair is the initiator: it creates the data channel and sends the
    // first offer. The other side waits for that handshake before adding its own tracks, so the
    // two never offer at the same time on join (that glare caused an endless renegotiation loop).
    const initiator = this.state.selfId > id;
    c = {
      pc,
      polite: !initiator,
      ready: initiator, // may we add tracks yet?
      makingOffer: false,
      ignoreOffer: false,
      senders: { mic: [], camera: [], screen: [] },
      dc: null,
    };
    this.conns.set(id, c);

    // "Perfect negotiation" — either side may add/remove tracks at any time.
    pc.onnegotiationneeded = async () => {
      try {
        c.makingOffer = true;
        await pc.setLocalDescription();
        this.send({ type: 'signal', to: id, data: { description: pc.localDescription } });
      } catch (err) {
        console.error('negotiation', err);
      } finally {
        c.makingOffer = false;
      }
    };
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.send({ type: 'signal', to: id, data: { candidate } });
    };
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') pc.restartIce();
    };
    pc.onconnectionstatechange = () => {
      if (this.conns.get(id)?.pc === pc) this.set({ links: { ...this.state.links, [id]: pc.connectionState } });
    };
    pc.ontrack = ({ track, streams }) => {
      const stream = streams[0] ?? new MediaStream([track]);
      const mine = this.state.remote[id] ?? {};
      this.set({ remote: { ...this.state.remote, [id]: { ...mine, [stream.id]: stream } } });
      // Re-render when a track is added to / removed from a known stream (e.g. screen audio).
      stream.onaddtrack = stream.onremovetrack = () => this.set({ remote: { ...this.state.remote } });
    };

    // Low-latency, ordered channel for mouse/keyboard input.
    const useChannel = (dc) => {
      c.dc = dc;
      dc.onmessage = (e) => this.onInput(id, e.data);
    };
    if (initiator) {
      useChannel(pc.createDataChannel('control', { ordered: true }));
      for (const kind of KINDS) this.addKind(c, kind);
    } else {
      pc.ondatachannel = (e) => useChannel(e.channel);
    }
    return c;
  }

  async onSignal(from, { description, candidate }) {
    const c = this.getConn(from);
    const { pc } = c;
    try {
      if (description) {
        const collision = description.type === 'offer' && (c.makingOffer || pc.signalingState !== 'stable');
        c.ignoreOffer = !c.polite && collision;
        if (c.ignoreOffer) return;
        await pc.setRemoteDescription(description);
        if (description.type === 'offer') {
          await pc.setLocalDescription();
          this.send({ type: 'signal', to: from, data: { description: pc.localDescription } });
          if (!c.ready) {
            // First handshake done — now it's safe to send our own media (renegotiates cleanly).
            c.ready = true;
            for (const kind of KINDS) this.addKind(c, kind);
          }
        }
      } else if (candidate) {
        try {
          await pc.addIceCandidate(candidate);
        } catch (err) {
          if (!c.ignoreOffer) throw err;
        }
      }
    } catch (err) {
      console.error('signal', err);
    }
  }

  // ---------- local media ----------
  addKind(c, kind) {
    const stream = this.local[kind];
    if (!c.ready || !stream || c.senders[kind].length) return;
    c.senders[kind] = stream.getTracks().map((t) => c.pc.addTrack(t, stream));
  }

  removeKind(kind) {
    for (const c of this.conns.values()) {
      for (const s of c.senders[kind]) {
        try {
          c.pc.removeTrack(s);
        } catch {}
      }
      c.senders[kind] = [];
    }
  }

  async toggleMute() {
    if (!this.local.mic) {
      try {
        this.local.mic = await navigator.mediaDevices.getUserMedia({ audio: true });
        for (const c of this.conns.values()) this.addKind(c, 'mic');
      } catch {
        return this.set({ error: 'Microphone permission denied' });
      }
      this.set({ me: { ...this.state.me, muted: false } });
      return this.publishState();
    }
    const muted = !this.state.me.muted;
    this.local.mic.getAudioTracks().forEach((t) => (t.enabled = !muted));
    this.set({ me: { ...this.state.me, muted } });
    this.publishState();
  }

  async toggleVideo() {
    if (this.local.camera) {
      this.local.camera.getTracks().forEach((t) => t.stop());
      this.removeKind('camera');
      this.local.camera = null;
      this.set({ me: { ...this.state.me, video: false }, local: { ...this.state.local, camera: null } });
      return this.publishState();
    }
    try {
      this.local.camera = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
    } catch {
      return this.set({ error: 'Camera permission denied' });
    }
    for (const c of this.conns.values()) this.addKind(c, 'camera');
    this.set({ me: { ...this.state.me, video: true }, local: { ...this.state.local, camera: this.local.camera } });
    this.publishState();
  }

  async shareScreen({ audio }) {
    if (this.local.screen) this.stopShare();
    const UNSUPPORTED =
      "This browser can't share your screen (embedded browsers like VS Code's don't support it). " +
      `Open ${location.href} in Chrome or Edge.`;
    if (!navigator.mediaDevices?.getDisplayMedia) return this.set({ error: UNSUPPORTED });
    if (!window.isSecureContext) return this.set({ error: 'Screen sharing needs HTTPS (or localhost).' });

    let stream;
    const asked = performance.now();
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30 } },
        audio, // browser shows an "Also share audio" toggle when true
        systemAudio: audio ? 'include' : 'exclude',
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'include',
        monitorTypeSurfaces: 'include',
      });
    } catch (err) {
      // A real "Cancel" in the picker takes the user a moment. An instant rejection means the
      // browser never showed a picker at all (blocked by policy / embedded browser).
      const instant = performance.now() - asked < 400;
      if (err.name === 'NotAllowedError' && !instant) return; // user cancelled the picker
      console.error('getDisplayMedia', err);
      return this.set({ error: err.name === 'NotAllowedError' ? UNSUPPORTED : `Couldn't share screen: ${err.message}` });
    }
    const video = stream.getVideoTracks()[0];
    video.contentHint = 'detail';
    video.onended = () => this.stopShare();

    this.local.screen = stream;
    for (const c of this.conns.values()) this.addKind(c, 'screen');
    this.set({
      me: {
        ...this.state.me,
        sharing: true,
        screenAudio: stream.getAudioTracks().length > 0,
        surface: video.getSettings().displaySurface ?? 'monitor',
      },
      local: { ...this.state.local, screen: stream },
    });
    this.publishState();
  }

  stopShare() {
    if (!this.local.screen) return;
    this.local.screen.getTracks().forEach((t) => t.stop());
    this.removeKind('screen');
    this.local.screen = null;
    for (const id of this.state.controllers) this.send({ type: 'control', to: id, action: 'revoke' });
    for (const id of this.state.requests) this.send({ type: 'control', to: id, action: 'deny' });
    this.set({
      me: { ...this.state.me, sharing: false, screenAudio: false, surface: null },
      local: { ...this.state.local, screen: null },
      controllers: [],
      requests: [],
    });
    this.publishState();
  }

  // ---------- remote control: permission protocol (via signaling server) ----------
  // viewer --request--> owner --grant|deny--> viewer
  // owner --revoke--> viewer         viewer --release--> owner
  requestControl(id) {
    if (this.state.pending.includes(id) || this.state.canControl.includes(id)) return;
    this.send({ type: 'control', to: id, action: 'request' });
    this.set({ pending: [...this.state.pending, id] });
  }

  answerRequest(id, allow) {
    this.set({ requests: this.state.requests.filter((x) => x !== id) });
    if (!allow || !this.local.screen) return this.send({ type: 'control', to: id, action: 'deny' });
    this.send({ type: 'control', to: id, action: 'grant' });
    this.set({ controllers: [...new Set([...this.state.controllers, id])] });
    if (this.state.agent === 'off') this.agent.connect();
  }

  revokeControl(id) {
    this.send({ type: 'control', to: id, action: 'revoke' });
    this.set({ controllers: this.state.controllers.filter((x) => x !== id) });
    this.agent.releaseAll();
  }

  releaseControl(id) {
    this.send({ type: 'control', to: id, action: 'release' });
    this.set({ canControl: this.state.canControl.filter((x) => x !== id) });
  }

  onControl(from, action) {
    const without = (arr) => arr.filter((x) => x !== from);
    switch (action) {
      case 'request':
        if (!this.local.screen) return this.send({ type: 'control', to: from, action: 'deny' });
        if (!this.state.requests.includes(from)) this.set({ requests: [...this.state.requests, from] });
        break;
      case 'grant':
        this.set({ pending: without(this.state.pending), canControl: [...new Set([...this.state.canControl, from])] });
        break;
      case 'deny':
        this.set({ pending: without(this.state.pending) });
        break;
      case 'revoke':
        this.set({ canControl: without(this.state.canControl) });
        break;
      case 'release':
        this.set({ controllers: without(this.state.controllers) });
        this.agent.releaseAll();
        break;
    }
  }

  // ---------- remote control: input events (via DataChannel) ----------
  sendInput(id, event) {
    if (!this.state.canControl.includes(id)) return;
    const dc = this.conns.get(id)?.dc;
    if (dc?.readyState === 'open') dc.send(JSON.stringify(event));
  }

  onInput(from, raw) {
    // Hard gate: only peers I explicitly granted can drive my machine.
    if (!this.state.controllers.includes(from) || !this.local.screen) return;
    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }
    this.agent.send(event);
    if (this.state.lastInputFrom !== from) this.set({ lastInputFrom: from });
  }

  connectAgent() {
    this.agent.connect();
  }
}
