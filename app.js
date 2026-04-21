/* ════════════════════════════════════════════════════════════════════
   EL CONFESIONARIO · Marta & Joaquín — app.js
   Características:
   • Modo kiosco con PIN
   • Almacenamiento en IndexedDB + auto-descarga a la galería
   • Preview antes de guardar
   • Solo audio opcional
   • Sugerencias de preguntas
   • Wake Lock, auto-reset, animaciones pulidas
   • Indicador de nivel de audio
════════════════════════════════════════════════════════════════════ */

/* ─────────────────────────── State ────────────────────────── */
const state = {
  mediaStream: null,
  mediaRecorder: null,
  recordedChunks: [],
  lastBlob: null,
  lastExt: 'mp4',
  timerInterval: null,
  timeLeft: 30,
  isRecording: false,
  chosenMimeType: '',
  chosenExtension: '',
  audioOnly: false,
  wakeLock: null,
  autoResetTimer: null,
  autoResetCountdown: null,
  audioCtx: null,
  micAnalyser: null,
  micRAF: null,
  promptIndex: 0,
  pinInput: '',
  selectMode: false,
  selectedIds: new Set(),
  currentPlayingId: null,
  lastActivity: Date.now(),
  playerObjectUrl: null,
  galleryObjectUrls: [],
};

/* ─────────────────────────── Settings ─────────────────────── */
const DEFAULT_SETTINGS = {
  duration: 30,
  camera: 'user',
  mirror: true,
  prompt: true,
  askName: false,
  preview: true,
  kiosk: false,
  autoreset: 45,
  pin: '2468',
  mp4: true,
  names: 'Marta & Joaquín',
  saveToGallery: true, // Auto-descarga a Descargas → indexado por la galería de Android
};
const SETTINGS_KEY = 'confesionario.settings.v2';

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
function saveSettings(s) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }
let settings = loadSettings();

/* ─────────────────────────── Prompts ──────────────────────── */
const PROMPTS = [
  '¿Qué recuerdo guardarás siempre de ellos?',
  'Un consejo que les darías para su vida juntos…',
  '¿Cuándo supiste que hacían buena pareja?',
  'Una anécdota vergonzosa (o tierna) de alguno de los dos.',
  'Si pudieras resumir su amor en una canción, ¿cuál sería?',
  '¿Qué les deseas de corazón para el futuro?',
  'Cuéntales un secreto que nunca te has atrevido a decirles.',
  '¿Cómo los imaginas dentro de 50 años?',
  '¿Qué brindis harías por ellos ahora mismo?',
  'Si pudieras darles un superpoder de regalo de bodas, ¿cuál?',
];
function rotatePrompts() {
  for (let i = PROMPTS.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [PROMPTS[i], PROMPTS[j]] = [PROMPTS[j], PROMPTS[i]];
  }
}

/* ─────────────────────────── IndexedDB ────────────────────── */
const DB_NAME = 'confesionario';
const DB_VERSION = 1;
const STORE = 'messages';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        os.createIndex('ts', 'ts', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function dbAdd(record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).add(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function dbGetAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
async function dbGet(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function dbDelete(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
async function dbClear() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
async function dbCount() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/* ─────────────────────────── Helpers ──────────────────────── */
function $(id) { return document.getElementById(id); }
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function tsStamp(d) {
  return d.getFullYear() +
    String(d.getMonth()+1).padStart(2,'0') +
    String(d.getDate()).padStart(2,'0') + '_' +
    String(d.getHours()).padStart(2,'0') +
    String(d.getMinutes()).padStart(2,'0') +
    String(d.getSeconds()).padStart(2,'0');
}
function safeName(s) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g,'').slice(0,30);
}
function humanSize(n) {
  if (n == null) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1024*1024) return (n/1024).toFixed(0) + ' KB';
  return (n/1024/1024).toFixed(1) + ' MB';
}

/* ─────────────────────────── Screens ──────────────────────── */
function goScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = id === 'preview' ? $('preview-screen') : $(id);
  if (el) el.classList.add('active');
  state.lastActivity = Date.now();
  const darkScreens = ['countdown', 'recording', 'preview'];
  const btn = $('settings-toggle');
  if (darkScreens.includes(id)) btn.classList.add('dark');
  else btn.classList.remove('dark');
}

let toastTimer = null;
function toast(msg, kind = '') {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ─────────────────────────── Format detection ─────────────── */
function detectFormat() {
  const mp4Types = [
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
  ];
  for (const mt of mp4Types) {
    if (MediaRecorder.isTypeSupported(mt)) {
      state.chosenMimeType = mt; state.chosenExtension = 'mp4'; return;
    }
  }
  const webmTypes = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  for (const mt of webmTypes) {
    if (MediaRecorder.isTypeSupported(mt)) {
      state.chosenMimeType = mt; state.chosenExtension = 'webm'; return;
    }
  }
  state.chosenMimeType = ''; state.chosenExtension = 'webm';
}
function detectAudioFormat() {
  const types = [
    'audio/mp4;codecs=mp4a.40.2',
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
  ];
  for (const mt of types) {
    if (MediaRecorder.isTypeSupported(mt)) {
      return { mime: mt, ext: mt.includes('mp4') ? 'm4a' : 'webm' };
    }
  }
  return { mime: '', ext: 'webm' };
}

/* ─────────────────────────── Wake Lock ────────────────────── */
async function acquireWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      state.wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch {}
}
function releaseWakeLock() {
  try { state.wakeLock?.release(); } catch {}
  state.wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !state.wakeLock) acquireWakeLock();
});

/* ─────────────────────────── Audio-only ───────────────────── */
function toggleAudioOnly() {
  state.audioOnly = !state.audioOnly;
  const btn = $('audio-only-toggle');
  btn.classList.toggle('active', state.audioOnly);
  btn.setAttribute('aria-pressed', String(state.audioOnly));
  btn.textContent = state.audioOnly ? '🎙 Modo audio activado' : '🎙 Solo audio';
}

/* ─────────────────────────── Permissions / Camera ─────────── */
async function requestPermissionAndContinue() {
  const errBanner = $('perm-error');
  errBanner.classList.add('hidden');
  try {
    await initCamera();
    startCountdown();
  } catch (err) {
    console.error(err);
    errBanner.classList.remove('hidden');
    errBanner.textContent = describePermError(err);
  }
}
function describePermError(err) {
  const msg = err?.name || String(err);
  if (msg === 'NotAllowedError' || msg === 'PermissionDeniedError')
    return 'Parece que bloqueaste los permisos. Abre los ajustes del navegador y concede permiso a este sitio.';
  if (msg === 'NotFoundError' || msg === 'DevicesNotFoundError')
    return 'No encontramos cámara/micrófono en este dispositivo.';
  if (msg === 'NotReadableError')
    return 'La cámara está ocupada por otra app. Ciérrala y vuelve a intentarlo.';
  return 'No se pudo iniciar la cámara. ' + (err?.message || '');
}
async function initCamera() {
  if (state.mediaStream) {
    state.mediaStream.getTracks().forEach(t => t.stop());
    state.mediaStream = null;
  }
  if (state.audioOnly) {
    state.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: true, video: false
    });
  } else {
    const facingMode = settings.camera || 'user';
    state.mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: true,
    });
    const video = $('preview-video');
    video.srcObject = state.mediaStream;
    video.classList.toggle('mirror', settings.mirror && facingMode === 'user');
  }
  setupMicMeter(state.mediaStream);
}
function setupMicMeter(stream) {
  try {
    cleanupMicMeter();
    const track = stream.getAudioTracks?.()[0];
    if (!track) return;
    state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = state.audioCtx.createMediaStreamSource(stream);
    const analyser = state.audioCtx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    state.micAnalyser = analyser;
    const buf = new Uint8Array(analyser.frequencyBinCount);
    const meterEl = $('mic-meter-fill');
    const avPulse = $('av-pulse');
    const loop = () => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      const pct = Math.min(100, Math.round(rms * 260));
      if (meterEl) meterEl.style.height = pct + '%';
      if (avPulse && state.audioOnly) {
        const scale = 1 + rms * 2.5;
        avPulse.style.transform = `scale(${scale})`;
        avPulse.style.opacity = Math.min(0.9, rms * 2.5);
      }
      state.micRAF = requestAnimationFrame(loop);
    };
    loop();
  } catch (e) { console.warn('Mic meter setup failed', e); }
}
function cleanupMicMeter() {
  if (state.micRAF) cancelAnimationFrame(state.micRAF);
  state.micRAF = null;
  try { state.audioCtx?.close(); } catch {}
  state.audioCtx = null;
  state.micAnalyser = null;
}

/* ─────────────────────────── Flow ─────────────────────────── */
function beginFlow() {
  state.lastActivity = Date.now();
  if (settings.prompt) { nextPrompt(true); goScreen('prompt'); }
  else if (state.mediaStream) startCountdown();
  else goScreen('permission');
}

/* ─────────────────────────── Prompts ──────────────────────── */
function nextPrompt(reset = false) {
  if (reset) state.promptIndex = 0;
  else state.promptIndex = (state.promptIndex + 1) % Math.min(4, PROMPTS.length);
  const el = $('prompt-text');
  el.style.opacity = 0;
  setTimeout(() => {
    el.textContent = PROMPTS[state.promptIndex];
    el.style.transition = 'opacity 0.4s';
    el.style.opacity = 1;
  }, 180);
  document.querySelectorAll('.prompt-dot').forEach((d, i) => {
    d.classList.toggle('on', i === state.promptIndex);
  });
}

/* ─────────────────────────── Countdown ────────────────────── */
async function startCountdown() {
  state.timeLeft = settings.duration;
  $('wl-duration').textContent = settings.duration;

  if (!state.mediaStream) {
    try { await initCamera(); }
    catch (e) {
      goScreen('permission');
      $('perm-error').classList.remove('hidden');
      $('perm-error').textContent = describePermError(e);
      return;
    }
  }

  $('preview-video').style.display = state.audioOnly ? 'none' : '';
  $('audio-visualizer').classList.toggle('show', state.audioOnly);
  $('mic-meter').style.display = state.audioOnly ? 'none' : '';

  goScreen('countdown');
  await acquireWakeLock();

  const numEl = $('countdown-num');
  const labelEl = $('countdown-label');
  labelEl.textContent = 'Prepárate…';
  numEl.classList.remove('go');
  let count = 3;
  numEl.textContent = count;
  reAnim(numEl);
  const countInterval = setInterval(() => {
    count--;
    if (count > 0) { numEl.textContent = count; numEl.classList.remove('go'); reAnim(numEl); }
    else {
      clearInterval(countInterval);
      numEl.textContent = '¡YA!';
      numEl.classList.add('go');
      labelEl.textContent = 'Habla con el corazón';
      reAnim(numEl);
      setTimeout(startRecording, 450);
    }
  }, 1000);
}
function reAnim(el) {
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = 'pulse-in 0.7s ease-out';
}

/* ─────────────────────────── Recording ────────────────────── */
function startRecording() {
  goScreen('recording');
  state.recordedChunks = [];
  state.isRecording = true;

  let options = {};
  let ext = state.chosenExtension;
  if (state.audioOnly) {
    const af = detectAudioFormat();
    if (af.mime) options.mimeType = af.mime;
    ext = af.ext;
  } else if (state.chosenMimeType) {
    options.mimeType = state.chosenMimeType;
  }
  state.lastExt = ext;

  try { state.mediaRecorder = new MediaRecorder(state.mediaStream, options); }
  catch { state.mediaRecorder = new MediaRecorder(state.mediaStream); }

  state.mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) state.recordedChunks.push(e.data);
  };
  state.mediaRecorder.onstop = () => handleRecordingDone();
  state.mediaRecorder.start(100);

  state.timeLeft = settings.duration;
  updateTimerDisplay();
  $('progress-bar').style.width = '0%';
  state.timerInterval = setInterval(() => {
    state.timeLeft--;
    updateTimerDisplay();
    const pct = ((settings.duration - state.timeLeft) / settings.duration) * 100;
    $('progress-bar').style.width = pct + '%';
    if (state.timeLeft <= 0) stopRecording();
  }, 1000);
}
function updateTimerDisplay() {
  const el = $('timer');
  const sec = Math.max(0, state.timeLeft);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  el.textContent = `${m}:${s.toString().padStart(2, '0')}`;
  el.classList.toggle('warning', sec <= 5);
}
function stopRecording() {
  if (!state.isRecording) return;
  state.isRecording = false;
  clearInterval(state.timerInterval);
  if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
    state.mediaRecorder.stop();
  }
  cleanupMicMeter();
  if (state.mediaStream) {
    state.mediaStream.getTracks().forEach(t => t.stop());
    state.mediaStream = null;
  }
}

/* ─────────────────────────── After recording ──────────────── */
async function handleRecordingDone() {
  const rawBlob = new Blob(state.recordedChunks, {
    type: state.audioOnly
      ? (detectAudioFormat().mime || 'audio/webm')
      : (state.chosenMimeType || 'video/webm')
  });
  if (settings.preview) {
    state.lastBlob = rawBlob;
    showPreview(rawBlob);
    return;
  }
  await finalizeAndSave(rawBlob);
}
function showPreview(blob) {
  if (state.playerObjectUrl) URL.revokeObjectURL(state.playerObjectUrl);
  state.playerObjectUrl = URL.createObjectURL(blob);
  const v = $('playback-video');
  v.src = state.playerObjectUrl;
  v.load();
  v.play().catch(() => {});
  goScreen('preview');
  releaseWakeLock();
}
function rerecord() {
  const v = $('playback-video');
  v.pause(); v.removeAttribute('src'); v.load();
  if (state.playerObjectUrl) { URL.revokeObjectURL(state.playerObjectUrl); state.playerObjectUrl = null; }
  state.lastBlob = null;
  initCamera().then(() => startCountdown())
    .catch(e => { toast(describePermError(e), 'error'); goScreen('welcome'); });
}
async function confirmSave() {
  const v = $('playback-video');
  v.pause(); v.removeAttribute('src'); v.load();
  if (state.playerObjectUrl) { URL.revokeObjectURL(state.playerObjectUrl); state.playerObjectUrl = null; }
  if (!state.lastBlob) { resetToWelcome(); return; }
  await finalizeAndSave(state.lastBlob);
}

async function finalizeAndSave(rawBlob) {
  goScreen('saving');
  const savingText = $('saving-text');
  const savingSub = $('saving-sub');
  const bar = $('saving-progress-fill');
  bar.style.width = '10%';
  const isVideo = !state.audioOnly;
  let finalBlob = rawBlob;
  let ext = state.lastExt;

  if (isVideo && settings.mp4 && state.chosenExtension !== 'mp4') {
    savingText.textContent = 'Convirtiendo a MP4…';
    savingSub.textContent = 'Esto puede tardar unos segundos.';
    bar.style.width = '30%';
    try {
      const { FFmpeg } = await import('https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/+esm');
      const { fetchFile } = await import('https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/+esm');
      const ffmpeg = new FFmpeg();
      await ffmpeg.load({
        coreURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js',
        wasmURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm',
      });
      bar.style.width = '55%';
      await ffmpeg.writeFile('input.webm', await fetchFile(rawBlob));
      await ffmpeg.exec([
        '-i','input.webm',
        '-c:v','libx264','-preset','ultrafast','-crf','28',
        '-c:a','aac','-b:a','128k',
        '-movflags','+faststart',
        'output.mp4'
      ]);
      bar.style.width = '85%';
      const data = await ffmpeg.readFile('output.mp4');
      finalBlob = new Blob([data.buffer], { type: 'video/mp4' });
      ext = 'mp4';
    } catch (e) {
      console.warn('MP4 conversion failed, keeping original', e);
      ext = state.chosenExtension;
    }
  }

  bar.style.width = '95%';
  savingText.textContent = 'Guardando…';
  savingSub.textContent = 'Un último suspiro…';

  try {
    const guestName = ($('guest-name')?.value || '').trim();
    const now = new Date();
    const ts = tsStamp(now);
    const count = (await dbCount()) + 1;
    const filename = `confesion_${String(count).padStart(3,'0')}_${ts}${guestName ? '_' + safeName(guestName) : ''}.${ext}`;
    const record = {
      ts: now.getTime(),
      filename,
      ext,
      type: isVideo ? 'video' : 'audio',
      mime: finalBlob.type,
      size: finalBlob.size,
      guestName: guestName || null,
      blob: finalBlob,
    };
    await dbAdd(record);
    bar.style.width = '100%';
    const totalCount = await dbCount();
    localStorage.setItem('confessionCount', totalCount.toString());

    // Auto-descarga a la carpeta Descargas (indexada por la galería de Android / Google Fotos)
    let galleryOk = false;
    if (settings.saveToGallery) {
      try {
        triggerDownload(finalBlob, filename);
        galleryOk = true;
      } catch (dlErr) {
        console.warn('Auto-descarga falló, mensaje sigue en la app', dlErr);
      }
    }

    setTimeout(() => {
      goScreen('done');
      const galleryMsg = settings.saveToGallery
        ? (galleryOk ? ' · también en Descargas/Galería' : ' · (no se pudo copiar a Descargas)')
        : '';
      $('msg-counter').textContent = `Mensaje nº ${totalCount} guardado en ${ext.toUpperCase()}${galleryMsg}`;
      $('setting-count').textContent = totalCount;
      launchConfetti();
      scheduleAutoReset();
      const gn = $('guest-name');
      if (gn) gn.value = '';
    }, 350);
  } catch (e) {
    console.error(e);
    toast('Error al guardar: ' + e.message, 'error');
    goScreen('welcome');
  }
}

/* ─────────────────────────── Confetti ─────────────────────── */
function launchConfetti() {
  const symbols = ['🤍', '✿', '✦', '❤️', '🎉'];
  const root = $('done');
  for (let i = 0; i < 24; i++) {
    const el = document.createElement('div');
    el.className = 'confetti';
    el.textContent = symbols[Math.floor(Math.random() * symbols.length)];
    el.style.left = Math.random() * 100 + '%';
    el.style.animationDelay = (Math.random() * 0.5) + 's';
    el.style.animationDuration = (2.4 + Math.random() * 1.4) + 's';
    root.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }
}

/* ─────────────────────────── Reset ────────────────────────── */
function resetToWelcome() {
  cancelAutoReset();
  $('progress-bar').style.width = '0%';
  $('timer').classList.remove('warning');
  if (state.audioOnly) toggleAudioOnly();
  goScreen('welcome');
}
function scheduleAutoReset() {
  cancelAutoReset();
  if (!settings.kiosk) return;
  const secs = Math.max(10, Number(settings.autoreset) || 45);
  let remaining = secs;
  const autoEl = $('done-auto');
  autoEl.textContent = `Volviendo al inicio en ${remaining}s…`;
  state.autoResetCountdown = setInterval(() => {
    remaining--;
    autoEl.textContent = `Volviendo al inicio en ${remaining}s…`;
    if (remaining <= 0) clearInterval(state.autoResetCountdown);
  }, 1000);
  state.autoResetTimer = setTimeout(() => {
    autoEl.textContent = '';
    resetToWelcome();
  }, secs * 1000);
}
function cancelAutoReset() {
  clearTimeout(state.autoResetTimer);
  clearInterval(state.autoResetCountdown);
  state.autoResetTimer = null;
  state.autoResetCountdown = null;
  $('done-auto').textContent = '';
}
document.addEventListener('pointerdown', () => {
  state.lastActivity = Date.now();
}, { passive: true });

/* ─────────────────────────── PIN / Settings ───────────────── */
function settingsTap() {
  state.pinInput = '';
  renderPin();
  $('pin-overlay').classList.add('show');
}
function renderPin() {
  const dots = document.querySelectorAll('#pin-display .pin-dot');
  dots.forEach((d, i) => d.classList.toggle('filled', i < state.pinInput.length));
  $('pin-display').classList.remove('pin-error');
}
document.addEventListener('DOMContentLoaded', () => {
  $('pin-pad').addEventListener('click', (e) => {
    const btn = e.target.closest('.pin-key');
    if (!btn) return;
    const k = btn.dataset.k;
    if (k === 'cancel') {
      $('pin-overlay').classList.remove('show');
      state.pinInput = '';
      return;
    }
    if (k === 'back') {
      state.pinInput = state.pinInput.slice(0, -1);
      renderPin();
      return;
    }
    if (state.pinInput.length >= 4) return;
    state.pinInput += k;
    renderPin();
    if (state.pinInput.length === 4) setTimeout(tryPin, 180);
  });
});

function tryPin() {
  if (state.pinInput === settings.pin) {
    $('pin-overlay').classList.remove('show');
    state.pinInput = '';
    openSettings();
  } else {
    $('pin-display').classList.add('pin-error');
    setTimeout(() => { state.pinInput = ''; renderPin(); }, 450);
  }
}

function openSettings() {
  $('setting-duration').value = settings.duration;
  $('setting-camera').value = settings.camera;
  $('setting-mirror').checked = !!settings.mirror;
  $('setting-prompt').checked = !!settings.prompt;
  $('setting-askname').checked = !!settings.askName;
  $('setting-preview').checked = !!settings.preview;
  $('setting-kiosk').checked = !!settings.kiosk;
  $('setting-autoreset').value = settings.autoreset;
  $('setting-pin').value = settings.pin;
  $('setting-mp4').checked = !!settings.mp4;
  $('setting-names').value = settings.names;
  $('setting-savegallery').checked = !!settings.saveToGallery;
  dbCount().then(n => $('setting-count').textContent = n);
  $('settings-panel').classList.add('show');
}
function closeSettings() { $('settings-panel').classList.remove('show'); }
function saveAndClose() {
  const pinVal = $('setting-pin').value.trim();
  const newPin = /^\d{4}$/.test(pinVal) ? pinVal : settings.pin;
  settings = {
    duration: clamp(parseInt($('setting-duration').value, 10) || 30, 10, 120),
    camera: $('setting-camera').value,
    mirror: $('setting-mirror').checked,
    prompt: $('setting-prompt').checked,
    askName: $('setting-askname').checked,
    preview: $('setting-preview').checked,
    kiosk: $('setting-kiosk').checked,
    autoreset: clamp(parseInt($('setting-autoreset').value, 10) || 45, 10, 300),
    pin: newPin,
    mp4: $('setting-mp4').checked,
    names: ($('setting-names').value || 'Marta & Joaquín').trim(),
    saveToGallery: $('setting-savegallery').checked,
  };
  saveSettings(settings);
  applySettingsToUI();
  closeSettings();
  toast('Ajustes guardados', 'success');
}
function applySettingsToUI() {
  $('wl-duration').textContent = settings.duration;
  $('name-wrap').classList.toggle('hidden', !settings.askName);
  $('kiosk-badge').classList.toggle('show', !!settings.kiosk);
  applyCoupleNames(settings.names);
}
function applyCoupleNames(full) {
  let parts = full.split(/\s*&\s*|\s+y\s+/i);
  if (parts.length !== 2) parts = [full, ''];
  const [a, b] = parts;
  const titleEl = document.querySelector('.welcome-title');
  const monoEl = document.querySelector('.monogram');
  const doneSecret = $('done-secret');
  if (titleEl) {
    if (b) titleEl.innerHTML = `${escapeHtml(a)}<span class="amp">&</span>${escapeHtml(b)}`;
    else titleEl.textContent = a;
  }
  if (monoEl) {
    const i1 = (a || 'M').trim()[0] || 'M';
    const i2 = (b || 'J').trim()[0] || 'J';
    monoEl.innerHTML = `${escapeHtml(i1)}<span style="color:var(--gold);">&</span>${escapeHtml(i2)}`;
  }
  if (doneSecret) {
    doneSecret.innerHTML = `Tu secreto está a salvo con nosotros…<br>${escapeHtml(a)} y ${escapeHtml(b)} lo descubrirán en un momento muy especial.`;
  }
  document.title = `El Confesionario · ${a}${b ? ' & ' + b : ''}`;
}

/* ─────────────────────────── Gallery ──────────────────────── */
async function openGallery() {
  goScreen('gallery');
  state.selectMode = false;
  state.selectedIds.clear();
  $('select-toggle').textContent = 'Seleccionar';
  await renderGallery();
}
function closeGallery() {
  revokeGalleryUrls();
  goScreen('welcome');
}
function revokeGalleryUrls() {
  state.galleryObjectUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch {} });
  state.galleryObjectUrls = [];
}

async function renderGallery() {
  revokeGalleryUrls();
  const list = $('gallery-list');
  list.innerHTML = '';
  const items = await dbGetAll();
  items.sort((a,b) => b.ts - a.ts);
  $('gallery-sub').textContent =
    `${items.length} ${items.length === 1 ? 'mensaje guardado' : 'mensajes guardados'}`;
  if (items.length === 0) {
    list.innerHTML = '<div class="gallery-empty">Todavía no hay mensajes guardados.</div>';
    return;
  }
  const enableButtons = (on) => {
    $('dl-selected').disabled = !on;
    $('del-selected').disabled = !on;
  };
  enableButtons(false);

  for (const it of items) {
    const card = document.createElement('div');
    card.className = 'gcard';
    card.dataset.id = it.id;

    if (it.type === 'audio') {
      const ph = document.createElement('div');
      ph.className = 'gcard-audio';
      ph.textContent = '🎙';
      card.appendChild(ph);
    } else {
      const thumb = document.createElement('video');
      thumb.className = 'gcard-thumb';
      thumb.muted = true;
      thumb.playsInline = true;
      thumb.preload = 'metadata';
      const url = URL.createObjectURL(it.blob);
      state.galleryObjectUrls.push(url);
      thumb.src = url;
      thumb.addEventListener('loadeddata', () => {
        try { thumb.currentTime = 0.1; } catch {}
      });
      card.appendChild(thumb);
    }

    const meta = document.createElement('div');
    meta.className = 'gcard-meta';
    const d = new Date(it.ts);
    const dstr = d.toLocaleString('es-ES', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
    meta.innerHTML = `<b>${escapeHtml(it.guestName || 'Anónimo')}</b>${dstr} · ${humanSize(it.size)}`;
    card.appendChild(meta);

    const sel = document.createElement('div');
    sel.className = 'gcard-select';
    card.appendChild(sel);

    card.addEventListener('click', () => {
      if (state.selectMode) {
        if (state.selectedIds.has(it.id)) {
          state.selectedIds.delete(it.id);
          card.classList.remove('selected');
          sel.textContent = '';
        } else {
          state.selectedIds.add(it.id);
          card.classList.add('selected');
          sel.textContent = '✓';
        }
        enableButtons(state.selectedIds.size > 0);
      } else {
        openPlayer(it.id);
      }
    });
    list.appendChild(card);
  }
}

function toggleSelectMode() {
  state.selectMode = !state.selectMode;
  state.selectedIds.clear();
  $('select-toggle').textContent = state.selectMode ? 'Cancelar' : 'Seleccionar';
  document.querySelectorAll('.gcard').forEach(c => c.classList.remove('selected'));
  document.querySelectorAll('.gcard-select').forEach(s => s.textContent = '');
  $('dl-selected').disabled = true;
  $('del-selected').disabled = true;
}

async function downloadSelected() {
  if (state.selectedIds.size === 0) return;
  const ids = [...state.selectedIds];
  if (ids.length === 1) {
    const rec = await dbGet(ids[0]);
    triggerDownload(rec.blob, rec.filename);
    return;
  }
  await exportSomeAsZip(ids, `confesionario_seleccion_${tsStamp(new Date())}.zip`);
}
async function deleteSelected() {
  if (state.selectedIds.size === 0) return;
  if (!confirm(`¿Borrar ${state.selectedIds.size} mensaje(s)? Esta acción no se puede deshacer.`)) return;
  for (const id of state.selectedIds) await dbDelete(id);
  state.selectedIds.clear();
  await renderGallery();
  toast('Mensajes borrados');
}
async function clearAll() {
  const n = await dbCount();
  if (n === 0) { toast('No hay nada que borrar'); return; }
  if (!confirm(`Vas a borrar TODOS los mensajes (${n}). ¿Continuar?`)) return;
  if (!confirm('Última oportunidad. ¿Seguro?')) return;
  await dbClear();
  localStorage.setItem('confessionCount', '0');
  $('setting-count').textContent = '0';
  await renderGallery();
  toast('Todos los mensajes borrados', 'error');
}
async function exportAllZip() {
  const items = await dbGetAll();
  if (items.length === 0) { toast('No hay mensajes que exportar'); return; }
  await exportSomeAsZip(items.map(i => i.id), `confesionario_mj_${tsStamp(new Date())}.zip`);
}
async function exportSomeAsZip(ids, filename) {
  toast('Generando ZIP…');
  try {
    await loadJSZip();
    const zip = new window.JSZip();
    const recs = [];
    for (const id of ids) {
      const r = await dbGet(id);
      zip.file(r.filename, r.blob);
      recs.push({ id: r.id, filename: r.filename, ts: r.ts, date: new Date(r.ts).toISOString(), guestName: r.guestName, type: r.type, size: r.size });
    }
    zip.file('manifest.json', JSON.stringify(recs, null, 2));
    const blob = await zip.generateAsync({ type: 'blob' });
    triggerDownload(blob, filename);
    toast('ZIP descargado ✓', 'success');
  } catch (e) {
    console.error(e);
    toast('Error al generar ZIP: ' + e.message, 'error');
  }
}
function loadJSZip() {
  if (window.JSZip) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('No se pudo cargar JSZip (¿sin conexión?)'));
    document.head.appendChild(s);
  });
}
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* ─────────────────────────── Player modal ─────────────────── */
async function openPlayer(id) {
  const rec = await dbGet(id);
  if (!rec) return;
  state.currentPlayingId = id;
  const body = $('player-body');
  body.innerHTML = '';
  const url = URL.createObjectURL(rec.blob);
  let mediaEl;
  if (rec.type === 'audio') { mediaEl = document.createElement('audio'); mediaEl.controls = true; }
  else { mediaEl = document.createElement('video'); mediaEl.controls = true; mediaEl.playsInline = true; }
  mediaEl.src = url;
  mediaEl.dataset.objectUrl = url;
  body.appendChild(mediaEl);
  $('player-title').textContent = `${rec.guestName || 'Anónimo'} · ${new Date(rec.ts).toLocaleString('es-ES')}`;
  $('player-modal').classList.add('show');
  setTimeout(() => mediaEl.play().catch(()=>{}), 100);
}
function closePlayer() {
  const body = $('player-body');
  const media = body.querySelector('video, audio');
  if (media) {
    media.pause();
    if (media.dataset.objectUrl) URL.revokeObjectURL(media.dataset.objectUrl);
  }
  body.innerHTML = '';
  $('player-modal').classList.remove('show');
  state.currentPlayingId = null;
}
async function downloadCurrentPlaying() {
  if (!state.currentPlayingId) return;
  const rec = await dbGet(state.currentPlayingId);
  triggerDownload(rec.blob, rec.filename);
}
async function deleteCurrentPlaying() {
  if (!state.currentPlayingId) return;
  if (!confirm('¿Borrar este mensaje?')) return;
  await dbDelete(state.currentPlayingId);
  closePlayer();
  await renderGallery();
  toast('Mensaje borrado');
}

/* ─────────────────────────── Petals ───────────────────────── */
function spawnPetals() {
  const layer = $('bg-layer');
  const count = 7;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'petal';
    p.style.left = Math.random() * 100 + '%';
    p.style.animationDuration = (14 + Math.random() * 12) + 's';
    p.style.animationDelay = (Math.random() * 10) + 's';
    p.style.opacity = 0.25 + Math.random() * 0.3;
    p.style.transform = `scale(${0.6 + Math.random() * 1.3})`;
    layer.appendChild(p);
  }
}

/* ─────────────────────────── Inactivity watcher (kiosk) ───── */
setInterval(() => {
  if (!settings.kiosk) return;
  const now = Date.now();
  const activeScreen = document.querySelector('.screen.active')?.id;
  const resetAfter = 120 * 1000;
  if (activeScreen && activeScreen !== 'welcome' && activeScreen !== 'done' && activeScreen !== 'gallery') {
    if (now - state.lastActivity > resetAfter && !state.isRecording) resetToWelcome();
  }
}, 5000);

/* ─────────────────────────── Init ─────────────────────────── */
function init() {
  rotatePrompts();
  detectFormat();
  applySettingsToUI();
  dbCount().then(n => {
    $('setting-count').textContent = n;
    localStorage.setItem('confessionCount', n.toString());
  });
  spawnPetals();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.log('SW error:', err));
  }
  window.addEventListener('beforeunload', (e) => {
    if (settings.kiosk) { e.preventDefault(); e.returnValue = ''; }
  });
  document.addEventListener('contextmenu', (e) => {
    if (settings.kiosk) e.preventDefault();
  });
  acquireWakeLock();
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
