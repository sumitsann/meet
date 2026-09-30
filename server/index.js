// Signaling server: room roster, WebRTC signal relay, and control-request relay.
// Media never touches this server — peers connect to each other directly (mesh).
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const portFlag = process.argv.indexOf('--port');
const PORT = Number(portFlag > -1 ? process.argv[portFlag + 1] : process.env.PORT) || 3001;
const MAX_PEERS = 8; // mesh WebRTC gets expensive past this; switch to an SFU (LiveKit) for more
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

const app = express();

// ICE servers for WebRTC. STUN alone fails for many users on different networks,
// so in production set a TURN server (e.g. from metered.ca or your own coturn):
//   TURN_URLS=turn:host:3478,turns:host:443?transport=tcp  TURN_USERNAME=...  TURN_CREDENTIAL=...
app.get('/api/ice', (_req, res) => {
  const iceServers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (process.env.TURN_URLS) {
    iceServers.push({
      urls: process.env.TURN_URLS.split(',').map((s) => s.trim()),
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
    });
  }
  res.json({ iceServers });
});

app.use(express.static(dist));
app.use((_req, res) => res.sendFile(path.join(dist, 'index.html')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

/** roomId -> Map<peerId, { ws, id, name, joinedAt, state }> */
const rooms = new Map();

const send = (ws, msg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));

function roster(room) {
  const peers = [...room.values()].sort((a, b) => a.joinedAt - b.joinedAt);
  return peers.map((p, i) => ({ id: p.id, name: p.name, host: i === 0, state: p.state }));
}

function broadcastRoster(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const msg = { type: 'roster', peers: roster(room) };
  for (const p of room.values()) send(p.ws, msg);
}

wss.on('connection', (ws) => {
  let roomId = null;
  let self = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'join' && !self) {
      roomId = String(msg.room || '').slice(0, 64);
      if (!roomId) return;
      const room = rooms.get(roomId) ?? new Map();
      if (room.size >= MAX_PEERS) return send(ws, { type: 'error', message: 'Room is full' });
      rooms.set(roomId, room);
      self = {
        ws,
        id: crypto.randomUUID(),
        name: String(msg.name || 'Guest').slice(0, 40),
        joinedAt: Date.now(),
        state: {},
      };
      room.set(self.id, self);
      send(ws, { type: 'welcome', id: self.id });
      broadcastRoster(roomId);
      return;
    }
    if (!self) return;

    if (msg.type === 'state') {
      self.state = msg.state ?? {};
      broadcastRoster(roomId);
      return;
    }

    // Anything addressed to another peer (signal / control) is relayed, stamped with the sender.
    if (msg.to && (msg.type === 'signal' || msg.type === 'control')) {
      const target = rooms.get(roomId)?.get(msg.to);
      if (target) send(target.ws, { ...msg, to: undefined, from: self.id });
    }
  });

  ws.on('close', () => {
    if (!self) return;
    const room = rooms.get(roomId);
    room?.delete(self.id);
    if (room?.size === 0) rooms.delete(roomId);
    else broadcastRoster(roomId);
  });
});

server.listen(PORT, () => console.log(`Meet server on http://localhost:${PORT}`));
