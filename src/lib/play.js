// Browsers may refuse to autoplay media with sound. Instead of failing silently,
// announce it so the Room can show an "Enable audio" button (a click unlocks playback).
export const AUTOPLAY_BLOCKED = 'meet:autoplay-blocked';

export function play(el) {
  el?.play()?.catch((err) => {
    if (err.name === 'NotAllowedError') window.dispatchEvent(new Event(AUTOPLAY_BLOCKED));
  });
}

export function resumeAll() {
  document.querySelectorAll('video, audio').forEach((el) => el.srcObject && el.play().catch(() => {}));
}
