// The hero's LISN window: the desktop app's stems screen, drawn with the app's own sizes and colours (lisn-vst Source/).
// It plays a demo song, and New song splits 15 seconds of the visitor's own song on their graphics card: onnxruntime-web
// on WebGPU running htdemucs as 21 pieces (huggingface.co/monteslu/htdemucs-web-onnx, MIT), with demucs-web (MIT) for
// the STFT and overlap-add around it. Nothing is uploaded. Controls only the app has open an "In the free app" note.
const app = document.querySelector('.app');
const $ = s => app.querySelector(s);
const STEMS = ['vocals', 'drums', 'bass', 'other'];
const SR = 44100;
const DEMO = { name: 'Late Night Demo.mp3', range: '', tempo: '74 BPM', tempoOf: '1.00× of 74' };
const mmss = t => Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');

// ---- The waves (WaveGeometry.h): each layer fills the region left of a slanted wavy edge from (xTop, -80) to (xBottom, 580)
const THEMES = {
  dusk: { ground: '#6F7679', shadow: 'rgba(36, 14, 28, 0.42)', layers: ['#D9775F', '#F4A76F', '#7B5467', '#D95F6B', '#F08A7C'] },
  midnight: { ground: '#152238', shadow: 'rgba(2, 6, 18, 0.5)', layers: ['#2C4A78', '#4F86B8', '#101A2E', '#35679C', '#86B6DD'] }
};
const LAYERS = [[500, 980, 26, 260, 0.3, 0.6, 4], [330, 800, 30, 240, 1.7, 0.8, 7], [180, 620, 28, 230, 3.1, 1.0, 10],
                [-120, 400, 26, 220, 4.4, 1.2, 13], [-330, 180, 22, 210, 5.2, 1.4, 16]].map(([xTop, xBottom, amp, wl, phase, speed, push]) => {
  const len = Math.hypot(xBottom - xTop, 660), d = [(xBottom - xTop) / len, 660 / len], n = [d[1], -d[0]], step = len / 28;
  const at = (q, a, b) => [q[0] + d[0] * a + n[0] * b, q[1] + d[1] * a + n[1] * b];
  const p = [];
  for (let k = -1; k <= 29; k++) p.push(at([xTop, -80], k * step, amp * Math.sin(k * step / wl * 2 * Math.PI + phase)));
  const path = new Path2D(), last = p.length - 1;
  path.moveTo(...at(p[0], -4000, -4000));
  path.lineTo(...at(p[0], -4000, 0));
  path.lineTo(...p[0]);
  for (let i = 0; i < last; i++) {   // Catmull-Rom to cubic, as the app smooths it
    const a = p[Math.max(0, i - 1)], b = p[i], c = p[i + 1], e = p[Math.min(last, i + 2)];
    path.bezierCurveTo(b[0] + (c[0] - a[0]) / 6, b[1] + (c[1] - a[1]) / 6, c[0] - (e[0] - b[0]) / 6, c[1] - (e[1] - b[1]) / 6, c[0], c[1]);
  }
  path.lineTo(...at(p[last], 4000, 0));
  path.lineTo(...at(p[last], 4000, -4000));
  path.closePath();
  return { path, d, n, wl, speed, push };
});
const canvas = $('.app-waves'), g = canvas.getContext('2d');
const still = matchMedia('(prefers-reduced-motion: reduce)');
let theme = THEMES.dusk, scale = 1, flow = 0, pulse = 0, onScreen = true;

function drawWaves() {
  const k = scale * devicePixelRatio;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.shadowColor = 'transparent';
  g.fillStyle = theme.ground;
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.shadowColor = theme.shadow;      // drop-shadow(12px -4px 14px): canvas shadows ignore the transform, and blur = 2 sigma
  g.shadowBlur = 28 * k;
  g.shadowOffsetX = 12 * k;
  g.shadowOffsetY = -4 * k;
  LAYERS.forEach((L, i) => {
    const along = (flow * L.speed) % L.wl, out = pulse * L.push;   // the beat motion (WaveGeometry::motionOffset)
    g.setTransform(k, 0, 0, k, k * (L.d[0] * along + L.n[0] * out), k * (L.d[1] * along + L.n[1] * out));
    g.fillStyle = theme.layers[i];
    g.fill(L.path);
  });
}

const frame = app.parentElement;
new ResizeObserver(() => {
  scale = frame.clientWidth / 760;
  app.style.setProperty('--s', scale);
  canvas.width = Math.round(760 * scale * devicePixelRatio);
  canvas.height = Math.round(500 * scale * devicePixelRatio);
  drawWaves();
}).observe(frame);
new IntersectionObserver(e => { onScreen = e[e.length - 1].isIntersecting; }).observe(app);

// ---- The player: one buffer source per stem, each through its gain (volume x mute), into one analyser for the motion
let ac, analyser, scope, sources = [], buffers = [], demo = null, song = DEMO;
let playing = false, offset = 0, startedAt = 0, duration = 0;
const gains = [], vol = [1, 1, 1, 1], muted = [false, false, false, false];
const rows = [...app.querySelectorAll('.app-row')];

function audio() {   // made on the first press: browsers only start audio from one
  if (ac) return ac;
  // iPhones mute Web Audio with the ring/silent switch; as media playback it plays like a video (Safari 16.4+)
  if (navigator.audioSession) navigator.audioSession.type = 'playback';
  ac = new AudioContext();
  analyser = ac.createAnalyser();
  analyser.fftSize = 1024;
  scope = new Float32Array(analyser.fftSize);
  analyser.connect(ac.destination);
  STEMS.forEach((_, i) => { gains[i] = ac.createGain(); gains[i].connect(analyser); });
  applyGains();
  return ac;
}
const position = () => playing ? Math.min(duration, ac.currentTime - startedAt) : offset;

function play() {
  audio().resume();
  const mine = sources = buffers.map((b, i) => {
    const s = ac.createBufferSource();
    s.buffer = b;
    s.connect(gains[i]);
    s.start(0, offset);
    return s;
  });
  startedAt = ac.currentTime - offset;
  playing = true;
  mine[0].onended = () => {          // played to its end: back to 0:00, as the app does
    if (sources !== mine || !playing) return;
    playing = false;
    offset = 0;
    render();
  };
  render();
  wake();
}
function stop() {
  playing = false;
  sources.forEach(s => s.stop());
  sources = [];
}
function pause() {
  offset = position();
  stop();
  render();
}
function seek(f) {
  const was = playing;
  if (was) stop();
  offset = Math.max(0, Math.min(1, f)) * duration;
  if (was) play();
  else render();
}
function applyGains() {
  if (ac) gains.forEach((gn, i) => gn.gain.setTargetAtTime(muted[i] ? 0 : vol[i], ac.currentTime, 0.01));
}

// 104 bars across the song, each the loudest sample of its slice (Peaks.cpp), 0.6 of a step wide (StemRow.cpp)
function bars(buffer) {
  const n = 104, step = 376 / n, w = (step * 0.6).toFixed(2), L = buffer.getChannelData(0);
  const R = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : L;
  let d = '';
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let j = Math.floor(i * L.length / n), e = Math.floor((i + 1) * L.length / n); j < e; j++) m = Math.max(m, Math.abs(L[j]), Math.abs(R[j]));
    const half = Math.max(0.75, Math.min(1, m) * 17.5);
    d += `M${(i * step).toFixed(2)} ${(18 - half).toFixed(2)}h${w}v${(2 * half).toFixed(2)}h-${w}z`;
  }
  return d;
}

function load(newBuffers, info) {
  if (playing) stop();
  buffers = newBuffers;
  song = info;
  offset = 0;
  duration = buffers[0].duration;
  muted.fill(false);
  vol.fill(1);
  applyGains();
  rows.forEach((row, i) => row.querySelectorAll('.app-wave path').forEach(p => p.setAttribute('d', bars(buffers[i]))));
  $('.app-song b').textContent = info.name;
  $('.app-tempo').textContent = info.tempo;
  $('.app-tempo-of').textContent = info.tempoOf;
  $('.app-play').disabled = false;
  show('stems');
}

// ---- The screen
function render() {
  app.classList.toggle('playing', playing);
  $('.app-play').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  rows.forEach((row, i) => {
    const name = STEMS[i];
    row.classList.toggle('muted', muted[i]);
    const light = row.querySelector('.app-light');
    light.setAttribute('aria-pressed', muted[i]);
    light.setAttribute('aria-label', (muted[i] ? 'Unmute ' : 'Mute ') + name);
    const v = row.querySelector('.app-vol');
    v.style.setProperty('--v', vol[i]);
    v.setAttribute('aria-valuenow', Math.round(vol[i] * 100));
  });
  showPosition();
}
function showPosition() {
  const p = position();
  app.style.setProperty('--head', duration ? p / duration : 0);
  const t = mmss(p) + ' / ' + mmss(duration) + song.range;
  const meta = $('.app-song span');
  if (meta.textContent !== t) meta.textContent = t;
}
function show(screen) {
  for (const s of ['stems', 'splitting', 'error']) $('.app-' + s).hidden = s !== screen;
  $('.app-panel').classList.toggle('error', screen === 'error');
  if (screen === 'stems') render();
}

// The motion (PluginEditor::tick): fast attack, slow release on the playing peak; after a stop the waves settle
let raf = 0, last = 0;
function tick(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (playing) {
    analyser.getFloatTimeDomainData(scope);
    let peak = 0;
    for (const v of scope) peak = Math.max(peak, Math.abs(v));
    pulse = peak > pulse ? peak : pulse + (peak - pulse) * Math.min(1, dt * 5);
    flow += dt * (8 + 60 * pulse);
  } else if (pulse > 0.01) {
    pulse *= Math.pow(0.05, dt);
    flow += dt * 8 * pulse;
  } else pulse = 0;
  if (onScreen && !still.matches) drawWaves();
  showPosition();
  raf = playing || pulse > 0 ? requestAnimationFrame(tick) : 0;
}
function wake() {
  if (raf) return;
  last = performance.now();
  raf = requestAnimationFrame(tick);
}

// ---- The controls
$('.app-play').addEventListener('click', () => playing ? pause() : play());
rows.forEach((row, i) => {
  const light = row.querySelector('.app-light');
  light.addEventListener('click', () => { muted[i] = !muted[i]; applyGains(); render(); });
  light.addEventListener('contextmenu', e => {     // right-click solos, as in the app; again brings every stem back
    e.preventDefault();
    const alone = muted.every((m, j) => m === (j !== i));
    muted.forEach((_, j) => { muted[j] = !alone && j !== i; });
    applyGains();
    render();
  });
  const v = row.querySelector('.app-vol');
  const setVol = e => {                            // VolumeBar::valueAt: the thumb travels 5 px in from each end
    vol[i] = Math.max(0, Math.min(1, ((e.clientX - v.getBoundingClientRect().left) / scale - 5) / 86));
    applyGains();
    render();
  };
  v.addEventListener('pointerdown', e => { v.setPointerCapture(e.pointerId); setVol(e); v.onpointermove = setVol; });
  v.addEventListener('pointerup', () => { v.onpointermove = null; });
  v.addEventListener('dblclick', () => { vol[i] = 1; applyGains(); render(); });
  v.addEventListener('keydown', e => {
    const step = { ArrowRight: 0.05, ArrowUp: 0.05, ArrowLeft: -0.05, ArrowDown: -0.05 }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    vol[i] = Math.max(0, Math.min(1, vol[i] + step));
    applyGains();
    render();
  });
  const w = row.querySelector('.app-wave');
  const scrub = e => seek((e.clientX - w.getBoundingClientRect().left) / scale / 376);
  w.addEventListener('pointerdown', e => { if (!buffers.length) return; w.setPointerCapture(e.pointerId); scrub(e); w.onpointermove = scrub; });
  w.addEventListener('pointerup', () => { w.onpointermove = null; });
});
app.querySelectorAll('[data-theme-btn]').forEach(b => b.addEventListener('click', () => {
  app.dataset.theme = b.dataset.themeBtn;
  theme = THEMES[b.dataset.themeBtn];
  app.querySelectorAll('[data-theme-btn]').forEach(o => { o.classList.toggle('on', o === b); o.setAttribute('aria-pressed', o === b); });
  drawWaves();
}));

// "In the free app": what the app does that this window doesn't
const POPS = {
  tempo: ['Tempo and key are in the free app.', 'Slow a song down without changing its key, or shift the key without changing its speed.'],
  loop: ['Loops that snap to the beat are in the free app.', 'Loop a few bars while you practise, then drag just the loop into your DAW.'],
  drag: ['Dragging stems into your DAW is in the free app.', 'Pull any stem, the mix or a loop straight onto a track in FL Studio or Ableton.'],
  six: ['6 stems are in the free app.', 'Guitar and piano get their own stems too, on whole songs.']
};
const pop = $('.app-pop');
let popFor = null;
function closePop() {
  pop.hidden = true;
  popFor = null;
}
app.querySelectorAll('[data-pop]').forEach(b => b.addEventListener('click', e => {
  e.stopPropagation();
  if (popFor === b) return closePop();
  popFor = b;
  const [title, body] = POPS[b.dataset.pop];
  pop.querySelector('b').textContent = title;
  pop.querySelector('p').textContent = body;
  pop.hidden = false;
  const a = b.getBoundingClientRect(), w = app.getBoundingClientRect();
  const x = (a.left - w.left) / scale, y = (a.top - w.top) / scale, h = pop.offsetHeight;
  pop.style.left = Math.max(12, Math.min(760 - 12 - 262, x)) + 'px';
  pop.style.top = (y - h - 8 >= 12 ? y - h - 8 : y + a.height / scale + 8) + 'px';
}));
$('.app-pop-close').addEventListener('click', closePop);
document.addEventListener('click', e => { if (popFor && !pop.contains(e.target)) closePop(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePop(); });

// ---- New song: 15 seconds of the visitor's own song, split here on WebGPU
const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort.webgpu.bundle.min.mjs';
const DEMUCS = 'https://cdn.jsdelivr.net/npm/demucs-web@1.0.2/src/index.js';
const REV = 'a4a57cc0cf707e5b9a3e6ad3c2c4b21fcbe608c1';   // the model's commit: the cache never goes stale
const REPO = `https://huggingface.co/monteslu/htdemucs-web-onnx/resolve/${REV}/`;
const MODEL_BYTES = 125886563;                              // the manifest and the 21 pieces at that commit
// Piece 0's input normalisation gives NaN in fp16 on WebGPU, so the model card pins it to the CPU
const CPU_NODES = ['/ReduceMean', '/Sub', '/Pow', '/ReduceMean_1', '/Clip', '/Sqrt', '/Add', '/Div',
  '/ReduceMean_2', '/Sub_1', '/Pow_1', '/ReduceMean_3', '/Clip_1', '/Sqrt_1', '/Add_1', '/Div_1'];
const ERRORS = {
  browser: ['Your own song needs Chrome or Edge on a computer', "Splitting runs on your graphics card, which this browser can't use. The demo song still plays here, and the LISN app works on any Windows 10 or 11 PC."],
  check: ["That split didn't come out right", "Your graphics card gave results we can't trust, so we stopped rather than play you a bad split. Updating its driver can fix it. The LISN app runs on your processor and isn't affected."],
  unreadable: ["This file couldn't be read", 'Try an MP3, WAV, FLAC or OGG file. The LISN app opens those and AIFF too.'],
  failed: ["The split didn't finish", 'Something went wrong while the AI downloaded or ran. Try again, or get the LISN app, which splits whole songs on your PC.']
};
let manifest, sessions, busy = false, cancel = null;

function showError(kind) {
  if (playing) pause();
  $('.app-error-title b').textContent = ERRORS[kind][0];
  $('.app-error p').textContent = ERRORS[kind][1];
  show('error');
}
function progress(what, fraction) {
  const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100), x = 4 + 432 * pct / 100;
  $('.app-split-what').textContent = what;
  $('.app-pct').textContent = pct + '%';
  $('.app-track .done').setAttribute('d', wavyLine(x));
  for (const c of app.querySelectorAll('.app-track circle')) {
    c.setAttribute('cx', x);
    c.setAttribute('cy', 20 + 8 * Math.sin(x / 55 * 2 * Math.PI));
  }
}
function wavyLine(to) {   // SplittingScreen's track: a sine of 55 px and 8 px
  let d = '';
  for (let x = 4; x <= to; x += 2) d += (x === 4 ? 'M' : 'L') + x + ' ' + (20 + 8 * Math.sin(x / 55 * 2 * Math.PI)).toFixed(2);
  return d || 'M4 20';
}
$('.app-track .rest').setAttribute('d', wavyLine(436));

async function prepare(ort, signal) {
  const cache = await self.caches?.open('htdemucs-web-onnx@' + REV.slice(0, 7)).catch(() => null);   // none outside https
  let got = 0;
  const report = () => progress(`Downloading the AI · ${Math.round(got / 1e6)} of ${Math.round(MODEL_BYTES / 1e6)} MB`, got / MODEL_BYTES);
  const piece = async file => {
    const hit = await cache?.match(REPO + file);
    if (hit) {
      const b = await hit.arrayBuffer();
      got += b.byteLength;
      report();
      return b;
    }
    const res = await fetch(REPO + file, { signal });
    if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
    const reader = res.body.getReader(), parts = [];
    for (let r; !(r = await reader.read()).done;) {
      parts.push(r.value);
      got += r.value.length;
      report();
    }
    const blob = new Blob(parts);
    await cache?.put(REPO + file, new Response(blob)).catch(() => {});   // no room: it downloads again next time
    return blob.arrayBuffer();
  };
  report();
  manifest = JSON.parse(new TextDecoder().decode(await piece('htdemucs_split_manifest.json')));
  const files = await Promise.all(manifest.pieces.map(p => piece(p.file)));
  progress('Getting the AI ready', 1);
  ort.env.wasm.numThreads = 1;      // GitHub Pages can't send the headers wasm threads need
  ort.env.logLevel = 'error';
  const list = [];
  for (const [n, p] of manifest.pieces.entries())
    list.push(await ort.InferenceSession.create(files[n], {
      executionProviders: [n === 0 ? { name: 'webgpu', forceCpuNodeNames: CPU_NODES } : 'webgpu'],
      graphOptimizationLevel: 'all',
      // The boundaries between pieces stay on the GPU; only the last pieces' outputs come back
      preferredOutputLocation: p.outputs.some(o => o === 'x' || o === 'xt') ? 'cpu' : 'gpu-buffer'
    }));
  sessions = list;
}

// demucs-web runs one session per 7.8 s segment; this stands in for it and runs the 21 pieces in the manifest's order
const chain = {
  inputNames: ['mix', 'mag'],
  outputNames: ['x', 'xt'],
  async run(feeds) {
    const map = { ...feeds };
    for (const [n, p] of manifest.pieces.entries()) Object.assign(map, await sessions[n].run(Object.fromEntries(p.inputs.map(k => [k, map[k]]))));
    for (const t of Object.values(map)) if (t.location === 'gpu-buffer') t.dispose();
    return { x: map.x, xt: map.xt };
  }
};

// Real stems add back up to the song. Some graphics drivers return garbage without an error (an RTX 3050 Ti on driver
// 511.81 did, at random), and then the stems' sum is off. Good splits measured 31 to 34 dB, broken ones -2 to 18 dB.
function trustworthy(clip, stems) {
  let signal = 0, error = 0;
  for (let c = 0; c < 2; c++) {
    const parts = STEMS.map(k => c ? stems[k].right : stems[k].left);
    clip[c].forEach((x, i) => {
      signal += x * x;
      error += (x - parts[0][i] - parts[1][i] - parts[2][i] - parts[3][i]) ** 2;
    });
  }
  const db = 10 * Math.log10(signal / error);
  console.info(`LISN demo: the stems add up to the song within ${db.toFixed(1)} dB`);
  return db > 25;   // NaN fails too
}

// A 150 MB download is for computers, and the split needs WebGPU
const mightSplit = () => !!navigator.gpu && !(navigator.userAgentData?.mobile || matchMedia('(pointer: coarse)').matches);

async function split(file) {
  if (busy) return;
  closePop();
  if (playing) pause();
  const adapter = mightSplit() ? await navigator.gpu.requestAdapter().catch(() => null) : null;
  if (!adapter) return showError('browser');
  busy = true;
  app.classList.add('busy');
  const abort = new AbortController();
  let cancelled = false;
  cancel = () => { cancelled = true; abort.abort(); };
  $('.app-split-song').textContent = file.name;
  progress('Reading the song', 0);
  show('splitting');
  try {
    let decoded;
    try {
      decoded = await new OfflineAudioContext(2, 1, SR).decodeAudioData(await file.arrayBuffer());   // resampled to 44.1 kHz
    } catch {
      return showError('unreadable');
    }
    const from = decoded.duration >= 45 ? 30 : 0, s0 = from * SR, s1 = Math.min(s0 + 15 * SR, decoded.length);
    const L = decoded.getChannelData(0), R = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : L;
    const clip = [L.slice(s0, s1), R.slice(s0, s1)];
    const [ort, { DemucsProcessor }] = await Promise.all([import(ORT), import(DEMUCS)]);
    if (!sessions) await prepare(ort, abort.signal);
    if (cancelled) return show('stems');
    progress('Splitting into vocals · drums · bass · other', 0);
    const proc = new DemucsProcessor({
      ort,
      onProgress: p => {
        if (cancelled) throw new Error('cancelled');   // between segments: a running segment can't be stopped
        progress('Splitting into vocals · drums · bass · other', p.progress);
      }
    });
    proc.session = chain;
    const stems = await proc.separate(clip[0], clip[1]);
    if (!trustworthy(clip, stems)) return showError('check');
    load(STEMS.map(k => {
      const b = new AudioBuffer({ length: stems[k].left.length, numberOfChannels: 2, sampleRate: SR });
      b.copyToChannel(stems[k].left, 0);
      b.copyToChannel(stems[k].right, 1);
      return b;
    }), { name: file.name, range: ` · ${mmss(from)}–${mmss(from + (s1 - s0) / SR)} of your song`, tempo: '1.00×', tempoOf: 'Speed' });
  } catch (e) {
    if (cancelled) return show('stems');
    console.error(e);
    showError('failed');
  } finally {
    busy = false;
    cancel = null;
    app.classList.remove('busy');
  }
}

const picker = Object.assign(document.createElement('input'), { type: 'file', accept: 'audio/*' });
picker.addEventListener('change', () => { if (picker.files[0]) split(picker.files[0]); picker.value = ''; });
$('.app-new').addEventListener('click', () => mightSplit() ? picker.click() : showError('browser'));
$('.app-cancel').addEventListener('click', () => cancel?.());
$('.app-back').addEventListener('click', () => demo ? load(demo, DEMO) : show('stems'));
app.addEventListener('dragover', e => {
  if (busy || !e.dataTransfer.types.includes('Files')) return;
  e.preventDefault();
  $('.app-panel').classList.add('drop');
});
app.addEventListener('dragleave', e => { if (!app.contains(e.relatedTarget)) $('.app-panel').classList.remove('drop'); });
app.addEventListener('drop', e => {
  e.preventDefault();
  $('.app-panel').classList.remove('drop');
  if (e.dataTransfer.files[0]) split(e.dataTransfer.files[0]);
});

// ---- The demo song: "Late Night Demo", the promo video's song, split by LISN (assets/demo, 700 KB), fetched after the page
addEventListener('load', async () => {
  const decoder = new OfflineAudioContext(2, 1, SR);
  demo = await Promise.all(STEMS.map(async k => decoder.decodeAudioData(await (await fetch(`assets/demo/${k}.mp3`)).arrayBuffer())));
  if (!busy && song === DEMO) load(demo, DEMO);
});
