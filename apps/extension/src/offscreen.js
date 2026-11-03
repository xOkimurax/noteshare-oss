// A service worker can't play audio, so the background asks this hidden
// document to chime when a notification comes in. Synthesised — no asset.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'noteshare:ding') return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    for (const [freq, at] of [
      [880, 0],
      [1174.66, 0.08],
    ]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain).connect(ctx.destination);
      gain.gain.setValueAtTime(0.0001, now + at);
      gain.gain.exponentialRampToValueAtTime(0.22, now + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.32);
      osc.start(now + at);
      osc.stop(now + at + 0.36);
    }
    setTimeout(() => ctx.close(), 800);
  } catch {
    /* ignore */
  }
});
