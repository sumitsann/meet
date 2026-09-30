# Meet — screen sharing + remote control (React)

A small Meet-style app: several people can share screens at once, each viewer picks which screens to watch, and a sharer can let someone control their computer.

```
Browser A (React) ──WebRTC P2P (screen/cam/mic + "control" DataChannel)── Browser B (React)
      │                                                                        │
      └──────── WebSocket: room roster, SDP/ICE relay, control requests ───────┘
                              server/index.js
Browser B (sharer) ──ws://127.0.0.1:47800──> agent/index.js ──> real OS mouse/keyboard
```

## Run it

```bash
npm install
npm run dev          # signaling server :3001 + Vite :5173
```

Open http://localhost:5173, enter a name, and share the URL (`/#room-id`) with others.

Production: `npm run build && npm start` serves everything on `$PORT` (default 3001).
Screen capture needs **HTTPS** on anything other than localhost.

## Deploy publicly

Requirements: **HTTPS** (browsers only allow screen capture on secure pages), a host that supports
**WebSockets** and a long-running Node process (so not Vercel/Netlify static hosting), and a **TURN server**
so people on different networks can connect.

**Render (free, easiest):** push this folder to GitHub → render.com → New → Blueprint → select the repo.
`render.yaml` already has the build and start commands. You get `https://meet-xxxx.onrender.com`.
Free instances sleep after ~15 min idle; the first visit then takes ~30–60 s.

**TURN:** create a free account at metered.ca (TURN server), copy its URLs and credentials, and set these
env vars on your host:
`TURN_URLS=turn:...:80,turn:...:443,turns:...:443?transport=tcp`, `TURN_USERNAME=...`, `TURN_CREDENTIAL=...`
The browser gets them from `/api/ice`.

**Quick temporary link from your own PC** (no account needed):
`npm run build && npm start`, then in another terminal `npx cloudflared tunnel --url http://localhost:3001`.

**Remote control after deploying:** the sharer runs the agent with your public origin:
`set ALLOWED_ORIGINS=https://your-app.onrender.com&& npm start` (PowerShell: `$env:ALLOWED_ORIGINS="https://..."; npm start`).

## Remote control

1. The sharer shares their **Entire screen**.
2. A viewer hovers the screen tile and clicks **Request control**.
3. The sharer clicks **Allow**. The viewer sees "You're controlling X's computer", clicks the tile, and uses their mouse and keyboard.
4. Either side can stop: the viewer clicks **Release**, the sharer clicks **Stop control / Revoke**, or the sharer stops sharing.

A browser can't move the OS cursor by itself, so the **sharer** must also run the local agent:

```bash
cd agent
npm install
npm start
```

The agent listens only on `127.0.0.1`, accepts only the origins in `ALLOWED_ORIGINS` (default `http://localhost:5173,http://localhost:3001`), and accepts one tab at a time. The tab only forwards input from people you explicitly allowed. **Ctrl+C in the agent terminal is the kill switch.**
If you deploy the app, start the agent with your origin:
`ALLOWED_ORIGINS=https://meet.example.com npm start`

Known limits:
- Coordinates map to the **primary monitor**. Sharing a second monitor, or a single window, sends clicks to the wrong place.
- On Windows the agent can't control elevated (admin) windows unless it runs elevated too.
- macOS needs Accessibility permission for the terminal or Node.

## Files

| File | Purpose |
|---|---|
| `server/index.js` | Rooms, roster, signal relay, control-request relay |
| `src/lib/meeting.js` | WebRTC mesh (perfect negotiation), local media, control protocol |
| `src/lib/useRemoteInput.js` | Captures mouse/keys on a tile, normalized to the video content (skips letterbox bars) |
| `src/lib/agent.js` | Tab → local agent bridge |
| `src/components/*` | Room, tiles, sidebar (Screen control / Screen share with checkbox + "Only"), toolbar |
| `agent/index.js` | Turns input events into real OS input via nut.js |

## Scaling

This is a **mesh**: every peer uploads to every other peer, which works well up to about 4–6 people (the server caps rooms at 8). For bigger rooms, replace the `RTCPeerConnection` code in `meeting.js` with an SFU such as LiveKit. The UI and control protocol can stay the same, and the control events can go over LiveKit data messages. Add a TURN server in `ICE_SERVERS` for users behind strict NATs or corporate firewalls.
