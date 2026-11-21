// Procedural sound for the player, all from filtered noise (no audio files):
//   wind    rises with speed (a low roar past the helmet)
//   carve   the hiss of an edge cutting the snow, louder on harder edges
//   scrape  skids and hockey stops: a broad, gritty shush
//   rail    a ringing metallic slide while grinding
//   thump   a landing, scaled by how hard it was
// The browser only allows audio after a click or key press, so `resume()` is
// called when skiing starts.

export function createSkiAudio() {
  let ctx = null;
  let master = null;
  let ch = null;
  let muted = false;

  function noiseBuffer(seconds = 2) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    // Slightly pink: a running average takes the hard edge off white noise.
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = last * 0.6 + (Math.random() * 2 - 1) * 0.4;
      d[i] = last * 2.2;
    }
    return buf;
  }

  function channel(buf, type, freq, q) {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(master);
    src.start();
    return { filter, gain };
  }

  function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.55;
    master.connect(ctx.destination);
    const buf = noiseBuffer();
    ch = {
      wind: channel(buf, 'bandpass', 380, 0.5),
      carve: channel(buf, 'bandpass', 2600, 0.9),
      scrape: channel(buf, 'bandpass', 950, 0.7),
      rail: channel(buf, 'bandpass', 3300, 14),
    };
  }

  const set = (p, v, tc = 0.06) => p.setTargetAtTime(v, ctx.currentTime, tc);

  // speed m/s; carve 0..1 (edge pressure); skid m/s of sideways slip;
  // rail true while grinding; air true while airborne.
  function update({ speed = 0, carve = 0, skid = 0, rail = false, air = false, quiet = false }) {
    if (!ctx || ctx.state !== 'running') return;
    const v = quiet ? 0 : speed;
    set(ch.wind.gain.gain, Math.min(0.5, (v / 30) ** 2 * 0.5));
    set(ch.wind.filter.frequency, 250 + v * 18);
    const onSnow = !air && !rail && !quiet;
    set(ch.carve.gain.gain, onSnow ? Math.min(0.35, (0.04 + carve * 0.3) * Math.min(1, v / 8)) : 0, 0.04);
    set(ch.carve.filter.frequency, 1800 + v * 60 + carve * 900);
    set(ch.scrape.gain.gain, onSnow ? Math.min(0.6, skid * 0.09) : 0, 0.03);
    set(ch.rail.gain.gain, rail && !quiet ? 0.12 + Math.min(0.15, v * 0.012) : 0, 0.02);
  }

  function thump(strength) {
    if (!ctx || ctx.state !== 'running' || muted) return;
    const t = ctx.currentTime;
    const s = Math.min(1, strength);
    // A low body thud...
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(110, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25 + 0.5 * s, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.3);
    // ...and a burst of snow.
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(0.4);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1400;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.15 + 0.35 * s, t);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    src.connect(f).connect(g2).connect(master);
    src.start(t);
  }

  // A short metallic clank onto a rail.
  function clank() {
    if (!ctx || ctx.state !== 'running' || muted) return;
    const t = ctx.currentTime;
    for (const freq of [520, 1310, 2470]) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.08, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      osc.connect(g).connect(master);
      osc.start(t);
      osc.stop(t + 0.45);
    }
  }

  return {
    resume() {
      init();
      if (ctx && ctx.state !== 'running') ctx.resume();
    },
    suspend() {
      if (ctx && ctx.state === 'running') ctx.suspend();
    },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.55;
      return muted;
    },
    get muted() {
      return muted;
    },
    update,
    thump,
    clank,
  };
}
