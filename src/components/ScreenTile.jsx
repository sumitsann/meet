import { useCallback, useEffect, useRef, useState } from 'react';
import { AppWindow, Camera, Maximize, Monitor, MousePointer2, PanelTop, Volume2, VolumeX } from 'lucide-react';
import { useRemoteInput } from '../lib/useRemoteInput.js';
import { play } from '../lib/play.js';

export const SURFACE_LABEL = { monitor: 'Entire screen', window: 'Window', browser: 'Tab' };
const SURFACE_ICON = { monitor: Monitor, window: AppWindow, browser: PanelTop };

export function ScreenTile({ tile, controllable, pending, onRequestControl, onInput }) {
  const wrapRef = useRef(null);
  const surfaceRef = useRef(null);
  const videoRef = useRef(null);
  const [muted, setMuted] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hasFrame, setHasFrame] = useState(false);

  useEffect(() => {
    const v = videoRef.current;
    if (v && v.srcObject !== (tile.stream ?? null)) {
      v.srcObject = tile.stream ?? null;
      setHasFrame(false);
      if (tile.stream) play(v);
    }
  }, [tile.stream]);

  const send = useCallback((e) => onInput(tile.peerId, e), [onInput, tile.peerId]);
  useRemoteInput({ enabled: controllable, videoRef, surfaceRef, send });

  const isScreen = tile.kind === 'screen';
  const Icon = isScreen ? SURFACE_ICON[tile.surface] ?? Monitor : Camera;
  const label = isScreen ? SURFACE_LABEL[tile.surface] ?? 'Screen' : 'Camera';

  return (
    <div ref={wrapRef} className={`tile ${controllable ? 'controllable' : ''} ${focused ? 'focused' : ''}`}>
      <div
        ref={surfaceRef}
        className="tile-surface"
        tabIndex={controllable ? 0 : -1}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={tile.self || !isScreen || muted}
          className={tile.mirror ? 'mirror' : ''}
          onLoadedData={() => setHasFrame(true)}
        />
        {!hasFrame && (
          <div className="tile-waiting">
            {tile.link === 'failed'
              ? `Can't reach ${tile.name} — the network is blocking a direct connection (a TURN server is needed).`
              : `Connecting to ${tile.name}…`}
          </div>
        )}
      </div>

      {controllable && !focused && (
        <div className="tile-hint">
          <MousePointer2 size={14} /> Click to control {tile.name}'s screen
        </div>
      )}

      <div className="tile-actions">
        {isScreen && !tile.self && !controllable && (
          <button className="chip" disabled={pending} onClick={() => onRequestControl(tile.peerId)}>
            <MousePointer2 size={14} /> {pending ? 'Waiting for approval…' : 'Request control'}
          </button>
        )}
        {isScreen && tile.audio && (
          <button className="icon-btn dark" title={muted ? 'Unmute' : 'Mute'} onClick={() => setMuted(!muted)}>
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
        )}
        <button className="icon-btn dark" title="Fullscreen" onClick={() => wrapRef.current?.requestFullscreen()}>
          <Maximize size={16} />
        </button>
      </div>

      <div className="tile-label">
        <Icon size={14} />
        <span>
          {tile.name} · {label}
        </span>
        {isScreen && tile.audio && (muted ? <VolumeX size={13} /> : <Volume2 size={13} />)}
      </div>
    </div>
  );
}

export function PresentingTile({ surface, onStop }) {
  return (
    <div className="tile presenting">
      <Monitor size={40} strokeWidth={1.5} />
      <p>You're presenting {SURFACE_LABEL[surface]?.toLowerCase() ?? 'your screen'}</p>
      <button className="btn danger" onClick={onStop}>
        Stop presenting
      </button>
    </div>
  );
}
