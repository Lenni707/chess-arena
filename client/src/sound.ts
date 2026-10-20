// Short synthesized move sounds, so there are no audio files to ship.
let ctx: AudioContext | null = null;
let muted = false;

export function setMuted(m: boolean) {
  muted = m;
}

function tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', noise = false) {
  if (muted) return;
  ctx ??= new AudioContext();
  const t = ctx.currentTime;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(ctx.destination);
  if (noise) {
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 3;
    const src = ctx.createBufferSource();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = 1.2;
    src.buffer = buf;
    src.connect(f).connect(g);
    src.start(t);
  } else {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.6, t + dur);
    o.connect(g);
    o.start(t);
    o.stop(t + dur);
  }
}

export const sound = {
  move: () => tone(1800, 0.06, 0.5, 'sine', true),
  capture: () => {
    tone(1200, 0.09, 0.7, 'sine', true);
    tone(240, 0.08, 0.15, 'triangle');
  },
  check: () => tone(660, 0.12, 0.08, 'triangle'),
  end: () => {
    tone(523, 0.25, 0.08, 'triangle');
    setTimeout(() => tone(784, 0.35, 0.08, 'triangle'), 120);
  },
};
