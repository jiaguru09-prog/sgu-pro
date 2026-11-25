let isPoweredOn = true;
let currentUnit = 'hazard';
let currentMode = 'standby';
let subTone = 1;
let currentVolume = 1.0;

const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;
let masterBus = null;
const bufferCache = {};

let manualSource = null;
let manualGain = null;
let manualStartTime = 0;

const trackOffsets = {};

let hornSource = null;
let hornGain = null;
let hornTimer = null;
let isHornActive = false;
let isHornHeld = false;

const HORN_VOL_MULT = 0.75;

const modeOrder = ['hilo', 'yelp', 'wail', 'standby', 'pa', 'radio'];
const modeAngles = {
  hilo: -125,
  yelp: -75,
  wail: -25,
  standby: 25,
  pa: 75,
  radio: 125
};

const sirenModes = ['hilo', 'yelp', 'wail'];

function initAudioCtx() {
  if (!audioCtx) {
    audioCtx = new AudioCtx();

    const lowBoost = audioCtx.createBiquadFilter();
    lowBoost.type = 'lowshelf';
    lowBoost.frequency.value = 220;
    lowBoost.gain.value = 5.0;

    const hornBody = audioCtx.createBiquadFilter();
    hornBody.type = 'peaking';
    hornBody.frequency.value = 880;
    hornBody.Q.value = 1.1;
    hornBody.gain.value = 3.5;

    const smoothHighs = audioCtx.createBiquadFilter();
    smoothHighs.type = 'lowpass';
    smoothHighs.frequency.value = 5200;

    lowBoost.connect(hornBody);
    hornBody.connect(smoothHighs);
    smoothHighs.connect(audioCtx.destination);

    masterBus = lowBoost;
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
}

async function loadSoundBuffer(url) {
  if (bufferCache[url]) return bufferCache[url];
  initAudioCtx();
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const arrayBuf = await resp.arrayBuffer();
    const audioBuf = await audioCtx.decodeAudioData(arrayBuf);
    if (!audioBuf || audioBuf.length === 0) return null;
    bufferCache[url] = audioBuf;
    return audioBuf;
  } catch (e) {
    return null;
  }
}

function preloadUnitSounds(unit) {
  const names = [
    'wail_1', 'wail_2', 'yelp_1', 'yelp_2',
    'hilo_1', 'hilo_2', 'horn', 'manual'
  ];
  names.forEach(n => loadSoundBuffer(`sounds/${unit}_${n}.wav`));
}

function syncGains() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  if (manualGain) {
    manualGain.gain.cancelScheduledValues(now);
    manualGain.gain.setValueAtTime(currentVolume, now);
  }
}
function setSignalLed(active) {
  const ledSig = document.getElementById('ledSig');
  if (!ledSig) return;
  if (active) ledSig.classList.add('sig-active');
  else ledSig.classList.remove('sig-active');
}

function setTactileLock(locked) {
  document.querySelectorAll('.tactile-lock-group').forEach(row => {
    if (locked) row.classList.add('locked');
    else row.classList.remove('locked');
  });
}

function updateModeReadouts(text) {
  document.querySelectorAll('.mode-readout').forEach(el => {
    el.innerText = text;
  });
}

function togglePower() {
  initAudioCtx();
  isPoweredOn = !isPoweredOn;
  const pwrBtn = document.getElementById('pwrBtn');
  const faceplate = document.getElementById('faceplate');
  const pwrCaption = document.getElementById('pwrCaption');
  const ledPwr = document.getElementById('ledPwr');

  if (isPoweredOn) {
    pwrBtn.classList.remove('pwr-off');
    pwrBtn.classList.add('pwr-on');
    ledPwr.classList.add('pwr-active');
    faceplate.classList.remove('disabled');
    pwrCaption.innerText = 'СИСТЕМА АКТИВНА';
    selectMode('standby');
  } else {
    pwrBtn.classList.remove('pwr-on');
    pwrBtn.classList.add('pwr-off');
    ledPwr.classList.remove('pwr-active');
    setSignalLed(false);
    faceplate.classList.add('disabled');
    pwrCaption.innerText = 'ПИТАНИЕ ВЫКЛЮЧЕНО';
    stopAllSounds();
    currentMode = null;
    setTactileLock(true);
    document.querySelectorAll('[data-mode]').forEach(b => b.classList.remove('active', 'siren-on'));
    document.getElementById('mainStatusText').innerText = 'OFF';
    updateModeReadouts('OFF');
  }
}

function openUnitSheet() {
  document.getElementById('sheetBackdrop').classList.add('open');
  document.getElementById('unitSheet').classList.add('open');
}

function closeUnitSheet() {
  document.getElementById('sheetBackdrop').classList.remove('open');
  document.getElementById('unitSheet').classList.remove('open');
}

function chooseUnit(unitKey, brandWord, modelWord, el) {
  initAudioCtx();
  currentUnit = unitKey;
  preloadUnitSounds(unitKey);
  document.getElementById('topBrandTitle').innerHTML = `${brandWord} <span>${modelWord}</span>`;

  document.body.classList.remove('unit-hazard', 'unit-federal', 'unit-elina');
  document.body.classList.add('unit-' + unitKey);

  document.querySelectorAll('.sheet-item').forEach(i => i.classList.remove('selected'));
  el.classList.add('selected');
  closeUnitSheet();
}

function selectMode(mode) {
  if (!isPoweredOn) return;
  initAudioCtx();
  if (currentMode !== mode) {
    subTone = 1;
  }
  currentMode = mode;
  stopManualSound();
  setTactileLock(false);

  document.querySelectorAll('.mode-knob-el').forEach(knob => {
    knob.style.transform = `rotate(${modeAngles[mode]}deg)`;
  });

  document.querySelectorAll('[data-mode]').forEach(b => b.classList.remove('active', 'siren-on'));
  const isSiren = sirenModes.includes(mode);

  document.querySelectorAll(`[data-mode="${mode}"]`).forEach(btn => {
    btn.classList.add(isSiren ? 'siren-on' : 'active');
  });

  setSignalLed(isHornActive);
  const label = isSiren ? `${mode.toUpperCase()} ${subTone}` : mode.toUpperCase();
  updateModeReadouts(label);
  document.getElementById('mainStatusText').innerText = isHornActive ? 'AIR HORN' : label;
}

function cycleMode() {
  if (!isPoweredOn) return;
  if (!currentMode) {
    selectMode(modeOrder[0]);
    return;
  }
  const idx = modeOrder.indexOf(currentMode);
  const next = modeOrder[(idx + 1) % modeOrder.length];
  selectMode(next);
}

function toggleSubToneCombo() {
  if (!isPoweredOn || !currentMode || !sirenModes.includes(currentMode)) return false;
  subTone = (subTone === 1) ? 2 : 1;
  const label = `${currentMode.toUpperCase()} ${subTone}`;
  updateModeReadouts(label);
  document.getElementById('mainStatusText').innerText = label;
  if (document.querySelector('.btn-man-el.pressed')) {
    startManualPlay();
  }
  return true;
}

function getSoundUrlForCurrentMode() {
  if (sirenModes.includes(currentMode)) {
    return `sounds/${currentUnit}_${currentMode}_${subTone}.wav`;
  }
  if (currentMode === 'pa') return `sounds/${currentUnit}_yelp_2.wav`;
  if (currentMode === 'radio') return `sounds/${currentUnit}_hilo_2.wav`;
  return `sounds/${currentUnit}_manual.wav`;
}

function stopManualSound() {
  if (manualSource) {
    const url = manualSource._url;
    const dur = manualSource._duration;
    if (url && dur > 0 && audioCtx) {
      const elapsed = audioCtx.currentTime - manualStartTime;
      trackOffsets[url] = ((trackOffsets[url] || 0) + elapsed) % dur;
    }
    try { manualSource.stop(); } catch (e) {}
    manualSource.disconnect();
    manualSource = null;
  }
  if (manualGain) {
    manualGain.disconnect();
    manualGain = null;
  }
}

function killHornSource() {
  if (hornTimer) {
    clearTimeout(hornTimer);
    hornTimer = null;
  }
  if (hornGain && audioCtx) {
    hornGain.gain.cancelScheduledValues(audioCtx.currentTime);
    hornGain.gain.setValueAtTime(0.0, audioCtx.currentTime);
    hornGain.disconnect();
    hornGain = null;
  }
  if (hornSource) {
    try { hornSource.stop(); } catch (e) {}
    hornSource.disconnect();
    hornSource = null;
  }
}

function stopHornSound() {
  killHornSource();
  isHornActive = false;
  syncGains();
}

function stopAllSounds() {
  isHornHeld = false;
  stopManualSound();
  stopHornSound();
}

function emergencyStop() {
  if (!isPoweredOn) return;
  stopAllSounds();
  setSignalLed(false);
  currentMode = null;
  subTone = 1;
  setTactileLock(true);
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.remove('active', 'siren-on'));
  document.querySelectorAll('.mode-knob-el').forEach(k => {
    k.style.transform = 'rotate(0deg)';
  });
  updateModeReadouts('—');
  document.getElementById('mainStatusText').innerText = '—';
}
function getIdleDisplayText() {
  if (!currentMode) return '—';
  return sirenModes.includes(currentMode)
    ? `${currentMode.toUpperCase()} ${subTone}`
    : currentMode.toUpperCase();
}

function endHornPulse() {
  stopHornSound();
  if (!isPoweredOn) return;

  const isManHeld = document.querySelector('.btn-man-el.pressed') !== null;
  if (isManHeld && currentMode) {
    startManualPlay();
    return;
  }

  setSignalLed(false);
  document.getElementById('mainStatusText').innerText = getIdleDisplayText();
}

function releaseHornBtn() {
  isHornHeld = false;
  document.querySelectorAll('.btn-horn-el').forEach(b => b.classList.remove('pressed'));
}

async function triggerHorn() {
  if (!isPoweredOn || !currentMode) return;

  initAudioCtx();
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }

  isHornHeld = true;
  document.querySelectorAll('.btn-horn-el').forEach(b => b.classList.add('pressed'));

  // Спец-комбинация: если зажат MAN в режиме HI-LO / YELP / WAIL — нажатие HORN меняет тон 1 <-> 2
  const isManHeld = document.querySelector('.btn-man-el.pressed') !== null;
  if (isManHeld && sirenModes.includes(currentMode)) {
    toggleSubToneCombo();
    return;
  }

  let buf = await loadSoundBuffer(`sounds/${currentUnit}_horn.wav`);
  if (!buf) {
    buf = await loadSoundBuffer(`sounds/${currentUnit}_manual.wav`);
  }
  if (!buf || !isPoweredOn) return;

  stopManualSound();

  killHornSource();
  isHornActive = true;
  syncGains();

  hornSource = audioCtx.createBufferSource();
  hornSource.buffer = buf;

  hornGain = audioCtx.createGain();
  hornGain.gain.setValueAtTime(currentVolume * HORN_VOL_MULT, audioCtx.currentTime);

  hornSource.connect(hornGain);
  hornGain.connect(masterBus);
  hornSource.start(0);

  setSignalLed(true);
  document.getElementById('mainStatusText').innerText = 'AIR HORN';

  hornTimer = setTimeout(endHornPulse, buf.duration * 1000);
}

async function startManualPlay() {
  if (!isPoweredOn || !currentMode) return;
  const targetUrl = getSoundUrlForCurrentMode();
  const buf = await loadSoundBuffer(targetUrl);
  if (!buf || !document.querySelector('.btn-man-el.pressed')) return;

  stopManualSound();
  manualSource = audioCtx.createBufferSource();
  manualSource.buffer = buf;
  manualSource.loop = true;
  manualSource._url = targetUrl;
  manualSource._duration = buf.duration;

  manualGain = audioCtx.createGain();
  manualGain.gain.setValueAtTime(currentVolume, audioCtx.currentTime);

  manualSource.connect(manualGain);
  manualGain.connect(masterBus);

  const savedOffset = (trackOffsets[targetUrl] || 0) % buf.duration;
  manualStartTime = audioCtx.currentTime;
  manualSource.start(0, savedOffset);

  setSignalLed(true);
  const label = sirenModes.includes(currentMode)
    ? `${currentMode.toUpperCase()} ${subTone}`
    : 'MANUAL';
  document.getElementById('mainStatusText').innerText = label;
}

async function pressMan() {
  if (!isPoweredOn || !currentMode) return;
  initAudioCtx();
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }
  document.querySelectorAll('.btn-man-el').forEach(b => b.classList.add('pressed'));

  // Спец-комбинация: если держишь HORN и нажимаешь MAN в режиме HI-LO / YELP / WAIL — меняет тон 1 <-> 2
  if (isHornHeld && sirenModes.includes(currentMode)) {
    stopHornSound();
    toggleSubToneCombo();
    return;
  }

  if (isHornActive) {
    stopHornSound();
  }

  startManualPlay();
}

function releaseMan() {
  document.querySelectorAll('.btn-man-el').forEach(b => b.classList.remove('pressed'));
  stopManualSound();
  if (isPoweredOn && !isHornActive) {
    setSignalLed(false);
    document.getElementById('mainStatusText').innerText = getIdleDisplayText();
  }
}

let micStream = null;
let micCtx = null;

async function startPTT() {
  if (!isPoweredOn) return;
  const pttBtn = document.getElementById('btn-ptt');
  pttBtn.classList.add('talking');
  setSignalLed(true);
  document.getElementById('mainStatusText').innerText = 'РАЦИЯ';

  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micCtx = new AudioCtx();
    const source = micCtx.createMediaStreamSource(micStream);
    const gain = micCtx.createGain();
    gain.gain.value = currentVolume * 1.5;
    source.connect(gain);
    gain.connect(micCtx.destination);
  } catch (err) {
    console.warn('Микрофон недоступен');
  }
}

function stopPTT() {
  document.getElementById('btn-ptt').classList.remove('talking');
  if (micStream) {
    micStream.getTracks().forEach(t => t.stop());
    micStream = null;
  }
  if (micCtx) {
    micCtx.close();
    micCtx = null;
  }
  if (isPoweredOn) {
    const isSirenRunning = isHornActive || manualSource !== null;
    setSignalLed(isSirenRunning);
    document.getElementById('mainStatusText').innerText = getIdleDisplayText();
  }
}

function bindInstantHold(selector, downFn, upFn) {
  document.querySelectorAll(selector).forEach(el => {
    el.addEventListener('mousedown', (e) => {
      if (e.button === 0) downFn();
    });
    el.addEventListener('mouseup', upFn);
    el.addEventListener('mouseleave', upFn);
    el.addEventListener('touchstart', (e) => {
      e.preventDefault();
      downFn();
    }, { passive: false });
    el.addEventListener('touchend', (e) => {
      e.preventDefault();
      upFn();
    });
  });
}

bindInstantHold('.btn-horn-el', triggerHorn, releaseHornBtn);
bindInstantHold('.btn-man-el', pressMan, releaseMan);
bindInstantHold('#btn-ptt', startPTT, stopPTT);

let draggingVol = false;
let volStartY = 0;
let volStartVal = currentVolume;

function updateVolumeUI(val) {
  currentVolume = Math.max(0, Math.min(1, val));
  const deg = -135 + currentVolume * 270;
  document.querySelectorAll('.vol-knob-el').forEach(k => {
    k.style.transform = `rotate(${deg}deg)`;
  });

  const pct = Math.round(currentVolume * 100);
  document.querySelectorAll('.vol-readout').forEach(el => {
    el.innerText = pct + '%';
  });
  document.getElementById('meterPercent').innerText = pct + '%';

  const activeCount = Math.round(currentVolume * 10);
  document.querySelectorAll('.meter-seg').forEach((seg, idx) => {
    if (idx < activeCount) seg.classList.add('active');
    else seg.classList.remove('active');
  });

  if (hornGain && audioCtx) {
    hornGain.gain.setValueAtTime(currentVolume * HORN_VOL_MULT, audioCtx.currentTime);
  }
  syncGains();
}

updateVolumeUI(1.0);

document.querySelectorAll('.vol-knob-el').forEach(knob => {
  knob.addEventListener('mousedown', (e) => { draggingVol = true; volStartY = e.clientY; volStartVal = currentVolume; });
  knob.addEventListener('touchstart', (e) => { e.preventDefault(); draggingVol = true; volStartY = e.touches[0].clientY; volStartVal = currentVolume; }, { passive: false });
  knob.addEventListener('wheel', (e) => {
    e.preventDefault();
    updateVolumeUI(currentVolume + (e.deltaY < 0 ? 0.05 : -0.05));
  });
});

window.addEventListener('mousemove', (e) => { if (draggingVol) updateVolumeUI(volStartVal + (volStartY - e.clientY) / 140); });
window.addEventListener('mouseup', () => { draggingVol = false; });
window.addEventListener('touchmove', (e) => { if (draggingVol) updateVolumeUI(volStartVal + (volStartY - e.touches[0].clientY) / 140); });
window.addEventListener('touchend', () => { draggingVol = false; });

document.addEventListener('pointerdown', initAudioCtx, { once: true });
preloadUnitSounds(currentUnit);
selectMode('standby');