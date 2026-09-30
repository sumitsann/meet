import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Link2, Volume2, MonitorUp, MousePointer2, PanelRight, ScreenShare } from 'lucide-react';
import { useMeeting } from '../lib/useMeeting.js';
import { AUTOPLAY_BLOCKED, play, resumeAll } from '../lib/play.js';
import { PresentingTile, ScreenTile } from './ScreenTile.jsx';
import { Sidebar } from './Sidebar.jsx';
import { Toolbar } from './Toolbar.jsx';

function AudioSink({ stream }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = stream;
      play(ref.current);
    }
  }, [stream]);
  return <audio ref={ref} autoPlay />;
}

export function Room({ room, name, onLeave }) {
  const [state, m] = useMeeting(room, name);
  const [sidebar, setSidebar] = useState(true);
  const [hidden, setHidden] = useState(() => new Set());
  const [copied, setCopied] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);

  useEffect(() => {
    const onBlocked = () => setAudioBlocked(true);
    window.addEventListener(AUTOPLAY_BLOCKED, onBlocked);
    return () => window.removeEventListener(AUTOPLAY_BLOCKED, onBlocked);
  }, []);

  const { peers, selfId, remote, links, me, local, canControl, controllers, requests, pending } = state;
  const nameOf = (id) => peers.find((p) => p.id === id)?.name ?? 'Someone';

  const tiles = useMemo(() => {
    const out = [];
    for (const p of peers) {
      if (p.id === selfId) continue;
      const s = p.state ?? {};
      const streams = remote[p.id] ?? {};
      if (s.sharing && s.streams?.screen)
        out.push({
          key: `${p.id}:screen`,
          peerId: p.id,
          name: p.name,
          kind: 'screen',
          surface: s.surface,
          audio: s.screenAudio,
          stream: streams[s.streams.screen],
          link: links[p.id],
        });
      if (s.video && s.streams?.camera)
        out.push({
          key: `${p.id}:camera`,
          peerId: p.id,
          name: p.name,
          kind: 'camera',
          stream: streams[s.streams.camera],
          link: links[p.id],
        });
    }
    if (local.camera)
      out.push({ key: 'self:camera', peerId: selfId, name: 'You', kind: 'camera', stream: local.camera, self: true, mirror: true });
    return out;
  }, [peers, selfId, remote, links, local.camera]);

  const visible = tiles.filter((t) => !hidden.has(t.key));
  const count = visible.length + (me.sharing ? 1 : 0);

  const micSinks = peers
    .filter((p) => p.id !== selfId && p.state?.streams?.mic)
    .map((p) => ({ id: p.id, stream: remote[p.id]?.[p.state.streams.mic] }))
    .filter((x) => x.stream);

  const onInput = useCallback((id, e) => m.sendInput(id, e), [m]);
  const onRequestControl = useCallback((id) => m.requestControl(id), [m]);

  const copyLink = async () => {
    await navigator.clipboard.writeText(location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (state.status === 'closed' && state.error) {
    return (
      <div className="center-card">
        <h2>Can't stay in the meeting</h2>
        <p className="muted-text">{state.error}</p>
        <button className="btn primary" onClick={onLeave}>
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="logo">
            <ScreenShare size={18} />
          </div>
          <div>
            <div className="brand-name">Meet</div>
            <div className="room-id">{room}</div>
          </div>
        </div>
        <div className="grow" />
        <button className="btn" onClick={copyLink}>
          {copied ? <Check size={16} /> : <Link2 size={16} />} {copied ? 'Copied' : 'Copy invite link'}
        </button>
        <button className={`btn ${sidebar ? 'active' : ''}`} onClick={() => setSidebar(!sidebar)} title="People">
          <PanelRight size={16} /> {peers.length}
        </button>
      </header>

      <div className="body">
        <main className="main">
          {audioBlocked && (
            <div className="banner ask">
              <Volume2 size={16} />
              <span>Your browser blocked meeting audio until you interact with the page.</span>
              <button
                className="btn primary"
                onClick={() => {
                  resumeAll();
                  setAudioBlocked(false);
                }}
              >
                Enable audio
              </button>
            </div>
          )}
          {canControl.map((id) => (
            <div className="banner" key={`c-${id}`}>
              <MousePointer2 size={16} />
              <span>
                You're controlling <b>{nameOf(id)}</b>'s computer. Click their screen, then use your mouse and keyboard.
              </span>
              <button className="btn" onClick={() => m.releaseControl(id)}>
                Release
              </button>
            </div>
          ))}
          {requests.map((id) => (
            <div className="banner ask" key={`r-${id}`}>
              <MousePointer2 size={16} />
              <span>
                <b>{nameOf(id)}</b> wants to control your screen (mouse and keyboard).
              </span>
              <button className="btn" onClick={() => m.answerRequest(id, false)}>
                Deny
              </button>
              <button className="btn primary" onClick={() => m.answerRequest(id, true)}>
                Allow
              </button>
            </div>
          ))}
          {controllers.length > 0 && (
            <div className="banner warn">
              <MousePointer2 size={16} />
              <span>
                <b>{controllers.map(nameOf).join(', ')}</b> can control your screen.
                {state.agent !== 'on' && ' Desktop agent not connected — their input is not being applied.'}
              </span>
              {state.agent === 'off' && (
                <button className="btn" onClick={() => m.connectAgent()}>
                  Connect agent
                </button>
              )}
              <button className="btn danger" onClick={() => controllers.forEach((id) => m.revokeControl(id))}>
                Stop control
              </button>
            </div>
          )}
          {state.error && state.status !== 'closed' && (
            <div className="banner error">
              <span>{state.error}</span>
              <button className="btn" onClick={() => m.set({ error: null })}>
                Dismiss
              </button>
            </div>
          )}

          {count === 0 ? (
            <div className="empty">
              <MonitorUp size={44} strokeWidth={1.4} />
              <p>{peers.length > 1 ? 'Nobody is sharing yet.' : 'Waiting for others to join…'}</p>
              <p className="muted-text">Share your screen, or copy the invite link to bring people in.</p>
            </div>
          ) : (
            <div className={`stage n${Math.min(count, 6)}`}>
              {me.sharing && <PresentingTile surface={me.surface} onStop={() => m.stopShare()} />}
              {visible.map((t) => (
                <ScreenTile
                  key={t.key}
                  tile={t}
                  controllable={t.kind === 'screen' && canControl.includes(t.peerId)}
                  pending={pending.includes(t.peerId)}
                  onRequestControl={onRequestControl}
                  onInput={onInput}
                />
              ))}
            </div>
          )}
        </main>

        {sidebar && (
          <Sidebar
            state={state}
            tiles={tiles}
            hidden={hidden}
            setHidden={setHidden}
            onClose={() => setSidebar(false)}
            onRevoke={(id) => m.revokeControl(id)}
            onConnectAgent={() => m.connectAgent()}
          />
        )}
      </div>

      <Toolbar
        me={me}
        onMute={() => m.toggleMute()}
        onVideo={() => m.toggleVideo()}
        onShare={(opts) => m.shareScreen(opts)}
        onStopShare={() => m.stopShare()}
        onLeave={onLeave /* unmount runs meeting.leave() */}
      />

      {micSinks.map((s) => (
        <AudioSink key={s.id} stream={s.stream} />
      ))}
    </div>
  );
}
