import { Crown, Mic, MicOff, MonitorUp, MousePointer2, Video, Volume2, X } from 'lucide-react';
import { SURFACE_LABEL } from './ScreenTile.jsx';

export function Sidebar({ state, tiles, hidden, setHidden, onClose, onRevoke, onConnectAgent }) {
  const { peers, selfId, canControl, controllers, agent, me } = state;
  const remoteTiles = tiles.filter((t) => !t.self);
  const controlTiles = remoteTiles.filter((t) => t.kind === 'screen' && canControl.includes(t.peerId));
  const shareTiles = remoteTiles.filter((t) => !controlTiles.includes(t));

  const toggle = (key) =>
    setHidden((h) => {
      const next = new Set(h);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  const only = (key) => setHidden(new Set(tiles.map((t) => t.key).filter((k) => k !== key)));

  const row = (t, sub) => (
    <div className="stream-row" key={t.key}>
      <input type="checkbox" checked={!hidden.has(t.key)} onChange={() => toggle(t.key)} />
      <div className="stream-meta" onClick={() => toggle(t.key)}>
        <div className="stream-name">{t.name}</div>
        <div className="muted-text">{sub(t)}</div>
      </div>
      <button className="btn small" onClick={() => only(t.key)}>
        Only
      </button>
    </div>
  );

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span>
          People <span className="muted-text">{peers.length}</span>
        </span>
        <button className="icon-btn" onClick={onClose} title="Close">
          <X size={18} />
        </button>
      </div>

      <div className="people">
        {peers.map((p) => {
          const self = p.id === selfId;
          const s = self ? me : p.state ?? {};
          return (
            <div className="person" key={p.id}>
              <div className={`avatar ${s.sharing ? 'ring' : ''}`}>{p.name[0]?.toUpperCase()}</div>
              <div className="person-meta">
                <div className="person-name">
                  {p.name} {self && <span className="muted-text">(you)</span>}
                  {p.host && (
                    <span className="badge">
                      <Crown size={12} /> Host
                    </span>
                  )}
                </div>
                {s.sharing && (
                  <div className="muted-text sub">
                    <MonitorUp size={13} /> {self ? 'Presenting' : 'Sharing with you'}
                  </div>
                )}
                {controllers.includes(p.id) && (
                  <div className="sub warn">
                    <MousePointer2 size={13} /> Can control your screen
                    <button className="link" onClick={() => onRevoke(p.id)}>
                      Revoke
                    </button>
                  </div>
                )}
              </div>
              {s.video && <Video size={16} className="muted-text" />}
              {s.muted ? <MicOff size={16} className="off" /> : <Mic size={16} className="muted-text" />}
            </div>
          );
        })}
      </div>

      <div className="sections">
        {controlTiles.length > 0 && (
          <section>
            <h4>Screen control</h4>
            {controlTiles.map((t) =>
              row(t, (t) => (
                <>
                  You're in control {t.audio && <Volume2 size={12} />}
                </>
              ))
            )}
          </section>
        )}
        {shareTiles.length > 0 && (
          <section>
            <h4>Screen share</h4>
            {shareTiles.map((t) => row(t, (t) => (t.kind === 'camera' ? 'Camera' : SURFACE_LABEL[t.surface] ?? 'Screen')))}
          </section>
        )}
        {hidden.size > 0 && (
          <button className="link" onClick={() => setHidden(new Set())}>
            Show all
          </button>
        )}
        {me.sharing && (
          <section>
            <h4>Remote control agent</h4>
            <div className="agent-row">
              <span className={`dot ${agent}`} />
              {agent === 'on' ? 'Connected' : agent === 'connecting' ? 'Connecting…' : 'Not running'}
              {agent === 'off' && (
                <button className="btn small" onClick={onConnectAgent}>
                  Connect
                </button>
              )}
            </div>
            <p className="muted-text tiny">
              Needed to let others move your mouse. Run <code>npm start</code> in <code>agent/</code>.
            </p>
          </section>
        )}
      </div>
    </aside>
  );
}
