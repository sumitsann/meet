import { useEffect, useRef, useState } from 'react';
import { ChevronUp, Mic, MicOff, MonitorUp, MonitorX, PhoneOff, Video, VideoOff } from 'lucide-react';

export function Toolbar({ me, onMute, onVideo, onShare, onStopShare, onLeave }) {
  const [menu, setMenu] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e) => !menuRef.current?.contains(e.target) && setMenu(false);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menu]);

  const share = (audio) => {
    setMenu(false);
    onShare({ audio });
  };

  return (
    <footer className="toolbar">
      <button className="btn" onClick={onMute}>
        {me.muted ? <MicOff size={18} /> : <Mic size={18} />} {me.muted ? 'Unmute' : 'Mute'}
      </button>
      <button className={`btn ${me.video ? '' : 'soft-danger'}`} onClick={onVideo}>
        {me.video ? <Video size={18} /> : <VideoOff size={18} />} {me.video ? 'Stop video' : 'Start video'}
      </button>

      {me.sharing ? (
        <button className="btn primary" onClick={onStopShare}>
          <MonitorX size={18} /> Stop sharing
        </button>
      ) : (
        <div className="split" ref={menuRef}>
          <button className="btn primary" onClick={() => share(true)}>
            <MonitorUp size={18} /> Share screen
          </button>
          <button className="btn primary caret" onClick={() => setMenu(!menu)} title="Share options">
            <ChevronUp size={16} />
          </button>
          {menu && (
            <div className="menu">
              <button onClick={() => share(true)}>Share with audio</button>
              <button onClick={() => share(false)}>Share without audio</button>
            </div>
          )}
        </div>
      )}

      <button className="btn danger" onClick={onLeave}>
        <PhoneOff size={18} /> Leave
      </button>
    </footer>
  );
}
