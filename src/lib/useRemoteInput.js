import { useEffect } from 'react';

const BUTTONS = ['left', 'middle', 'right'];

/** Map a client point to 0..1 coordinates inside the *visible video content*
 *  (the <video> is object-fit: contain, so we must skip the letterbox bars). */
function normalize(video, clientX, clientY) {
  const rect = video.getBoundingClientRect();
  const vw = video.videoWidth || rect.width;
  const vh = video.videoHeight || rect.height;
  const scale = Math.min(rect.width / vw, rect.height / vh);
  const w = vw * scale;
  const h = vh * scale;
  const x = (clientX - rect.left - (rect.width - w) / 2) / w;
  const y = (clientY - rect.top - (rect.height - h) / 2) / h;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x: +x.toFixed(5), y: +y.toFixed(5) };
}

/**
 * Captures mouse + keyboard on a remote screen tile and forwards them via `send`.
 * Active only while `enabled` (i.e. the owner granted us control).
 */
export function useRemoteInput({ enabled, videoRef, surfaceRef, send }) {
  useEffect(() => {
    const video = videoRef.current;
    const surface = surfaceRef.current;
    if (!enabled || !video || !surface) return;

    let frame = 0;
    let lastMove = null;
    const flushMove = () => {
      frame = 0;
      if (lastMove) send({ t: 'move', ...lastMove });
      lastMove = null;
    };

    const onMove = (e) => {
      const p = normalize(video, e.clientX, e.clientY);
      if (!p) return;
      lastMove = p;
      if (!frame) frame = requestAnimationFrame(flushMove); // ≤ 1 move per frame
    };
    const onDown = (e) => {
      const p = normalize(video, e.clientX, e.clientY);
      if (!p) return;
      e.preventDefault();
      surface.focus({ preventScroll: true });
      surface.setPointerCapture(e.pointerId);
      send({ t: 'down', b: BUTTONS[e.button] ?? 'left', ...p });
    };
    const onUp = (e) => {
      const p = normalize(video, e.clientX, e.clientY) ?? lastMove ?? {};
      send({ t: 'up', b: BUTTONS[e.button] ?? 'left', ...p });
    };
    const onWheel = (e) => {
      e.preventDefault();
      send({ t: 'wheel', dx: Math.round(e.deltaX), dy: Math.round(e.deltaY) });
    };
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      send({ t: 'key', down: e.type === 'keydown', code: e.code, key: e.key });
    };
    const onBlur = () => send({ t: 'reset' }); // never leave keys stuck down on the other side
    const noMenu = (e) => e.preventDefault();

    surface.addEventListener('pointermove', onMove);
    surface.addEventListener('pointerdown', onDown);
    surface.addEventListener('pointerup', onUp);
    surface.addEventListener('wheel', onWheel, { passive: false });
    surface.addEventListener('keydown', onKey);
    surface.addEventListener('keyup', onKey);
    surface.addEventListener('blur', onBlur);
    surface.addEventListener('contextmenu', noMenu);
    return () => {
      cancelAnimationFrame(frame);
      surface.removeEventListener('pointermove', onMove);
      surface.removeEventListener('pointerdown', onDown);
      surface.removeEventListener('pointerup', onUp);
      surface.removeEventListener('wheel', onWheel);
      surface.removeEventListener('keydown', onKey);
      surface.removeEventListener('keyup', onKey);
      surface.removeEventListener('blur', onBlur);
      surface.removeEventListener('contextmenu', noMenu);
    };
  }, [enabled, videoRef, surfaceRef, send]);
}
