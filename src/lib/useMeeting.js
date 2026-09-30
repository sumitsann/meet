import { useEffect, useState, useSyncExternalStore } from 'react';
import { Meeting } from './meeting.js';

export function useMeeting(room, name) {
  const [meeting] = useState(() => new Meeting({ room, name }));
  const state = useSyncExternalStore(meeting.subscribe, meeting.getSnapshot);

  useEffect(() => {
    meeting.start();
    return () => meeting.leave();
  }, [meeting]);

  return [state, meeting];
}
