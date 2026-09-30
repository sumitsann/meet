import { useEffect, useState } from 'react';
import { ScreenShare } from 'lucide-react';
import { Room } from './components/Room.jsx';

const randomRoom = () => {
  const c = () => Math.random().toString(36).slice(2);
  return `${c().slice(0, 3)}-${c().slice(0, 4)}-${c().slice(0, 3)}`;
};
const roomFromHash = () => decodeURIComponent(location.hash.slice(1));

export default function App() {
  const [room, setRoom] = useState(() => roomFromHash() || randomRoom());
  const [name, setName] = useState(() => localStorage.getItem('meet:name') ?? '');
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    const onHash = () => roomFromHash() && setRoom(roomFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const join = (e) => {
    e.preventDefault();
    if (!name.trim() || !room.trim()) return;
    localStorage.setItem('meet:name', name.trim());
    location.hash = room.trim();
    setJoined(true);
  };

  if (joined) return <Room room={room.trim()} name={name.trim()} onLeave={() => setJoined(false)} />;

  return (
    <form className="center-card" onSubmit={join}>
      <div className="logo big">
        <ScreenShare size={26} />
      </div>
      <h2>Join a meeting</h2>
      <label>
        Your name
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sumeet" maxLength={40} />
      </label>
      <label>
        Room
        <input value={room} onChange={(e) => setRoom(e.target.value)} maxLength={64} />
      </label>
      <button className="btn primary wide" disabled={!name.trim() || !room.trim()}>
        Join
      </button>
    </form>
  );
}
