/* FAR OUT - main loop, scenes, UI */
(function () {
  const $ = (s) => document.querySelector(s);
  const canvas = $('#gl');
  const IS_ELECTRON = /Electron\//.test(navigator.userAgent);
  const audio = new AudioEngine();
  window.audio = audio; // handy for poking around in devtools

  /* ---------------------------------------------------------------- scenes
   * zoom < 1 flows outward (tunnel), > 1 sucks inward. emit: 0 halo, 1 bars, 2 scope, 3 julia, 4 tunnel, 5 blobs */
  const SCENES = [
    { name: 'Cosmic Halo',        emit: 0, zoom: 0.986, rot:  0.004, swirl:  0.012, warp: 0.0040, decay: 0.955, hue: 0.0060, kaleido: 0,  blur: 0.30, aberr: 1.0, bloom: 0.55 },
    { name: 'Mandala Bloom',      emit: 0, zoom: 0.990, rot: -0.006, swirl: -0.020, warp: 0.0030, decay: 0.960, hue: 0.0080, kaleido: 8,  blur: 0.25, aberr: 1.2, bloom: 0.60 },
    { name: 'Julia Dreams',       emit: 3, zoom: 0.992, rot:  0.003, swirl:  0.008, warp: 0.0030, decay: 0.945, hue: 0.0050, kaleido: 0,  blur: 0.35, aberr: 0.8, bloom: 0.50 },
    { name: 'Crystal Cathedral',  emit: 3, zoom: 0.985, rot:  0.005, swirl:  0.015, warp: 0.0020, decay: 0.950, hue: 0.0070, kaleido: 6,  blur: 0.25, aberr: 1.4, bloom: 0.55 },
    { name: 'Hyperspace',         emit: 4, zoom: 0.982, rot:  0.002, swirl:  0.006, warp: 0.0025, decay: 0.962, hue: 0.0090, kaleido: 0,  blur: 0.10, aberr: 1.6, bloom: 0.50 },
    { name: 'Kaleido Tunnel',     emit: 4, zoom: 0.984, rot:  0.006, swirl: -0.010, warp: 0.0030, decay: 0.962, hue: 0.0060, kaleido: 10, blur: 0.10, aberr: 1.3, bloom: 0.55 },
    { name: 'Lava Lamp Universe', emit: 5, zoom: 0.994, rot:  0.002, swirl:  0.010, warp: 0.0070, decay: 0.965, hue: 0.0040, kaleido: 0,  blur: 0.45, aberr: 0.7, bloom: 0.60 },
    { name: 'Blob Flower',        emit: 5, zoom: 0.989, rot:  0.004, swirl:  0.018, warp: 0.0050, decay: 0.960, hue: 0.0070, kaleido: 5,  blur: 0.40, aberr: 1.0, bloom: 0.60 },
    { name: 'Acid Oscilloscope',  emit: 2, zoom: 0.993, rot:  0.010, swirl:  0.020, warp: 0.0040, decay: 0.968, hue: 0.0120, kaleido: 0,  blur: 0.20, aberr: 1.4, bloom: 0.55 },
    { name: 'Scope Mandala',      emit: 2, zoom: 0.990, rot: -0.008, swirl:  0.010, warp: 0.0020, decay: 0.955, hue: 0.0090, kaleido: 7,  blur: 0.25, aberr: 1.2, bloom: 0.60 },
    { name: 'Media Player 2002',  emit: 1, zoom: 0.995, rot:  0.000, swirl:  0.000, warp: 0.0020, decay: 0.930, hue: 0.0040, kaleido: 0,  blur: 0.15, aberr: 0.8, bloom: 0.45 },
    { name: 'Bar Kaleidoscope',   emit: 1, zoom: 0.984, rot:  0.006, swirl: -0.012, warp: 0.0030, decay: 0.950, hue: 0.0080, kaleido: 12, blur: 0.25, aberr: 1.3, bloom: 0.55 },
  ];
  const NUM_KEYS = ['emit', 'zoom', 'rot', 'swirl', 'warp', 'decay', 'hue', 'blur', 'aberr', 'bloom'];

  const S = {
    cur: Object.assign({}, SCENES[0]),   // live (blended) numeric params
    from: SCENES[0], to: SCENES[0],
    idx: 0, t: 1,                        // t: 0..1 transition progress
    emitFrom: SCENES[0].emit, emitTo: SCENES[0].emit, kaleido: SCENES[0].kaleido,
    auto: true, sinceChange: 0, nextIn: 24,
    phase: 0, flow: 0, hueBase: Math.random(), dir: 1, dirTarget: 1, time: 0,
    intensity: 1,
  };

  function goScene(i, quick) {
    i = (i + SCENES.length) % SCENES.length;
    const target = SCENES[i];
    S.from = Object.assign({}, S.cur, { kaleido: S.kaleido });
    S.emitFrom = S.emitTo;
    S.to = target; S.emitTo = target.emit; S.idx = i;
    S.t = quick ? 0.5 : 0; S.sinceChange = 0;
    S.nextIn = 18 + Math.random() * 16;
    $('#sceneName').textContent = target.name;
  }
  function randomScene() {
    let i; do { i = (Math.random() * SCENES.length) | 0; } while (i === S.idx);
    goScene(i);
  }

  const ease = (x) => x * x * (3 - 2 * x);

  function updateScene(dt, a) {
    S.time += dt; S.sinceChange += dt;
    if (S.t < 1) {
      S.t = Math.min(1, S.t + dt / 2.8);
      const e = ease(S.t);
      for (const k of NUM_KEYS) S.cur[k] = S.from[k] + (S.to[k] - S.from[k]) * e;
      S.kaleido = e < 0.5 ? S.from.kaleido : S.to.kaleido;
      if (S.t >= 1) S.emitFrom = S.emitTo;
    }
    // auto-advance: on a timer, or when a big drop hits after a calm bit
    if (S.auto && S.t >= 1) {
      if (S.sinceChange > S.nextIn || (S.sinceChange > 9 && a.flux > 0.85 && a.energy > 0.8 && Math.random() < 0.02)) randomScene();
    }
    S.dirTarget = (Math.floor(a.beatCount / 16) % 2) ? -1 : 1;
    S.dir += (S.dirTarget - S.dir) * Math.min(1, dt * 1.2);
    S.phase += dt * (0.30 + a.energy * 1.5 + a.bass * 0.6);
    S.hueBase = (S.hueBase + dt * (0.012 + 0.05 * a.energy)) % 1;
  }

  /* ---------------------------------------------------------------- webgl */
  let gl, progFB, progPost, uFB, uPost, audioTex, fb, cur = 0, pendingOld = null;
  let useFloat = false, glLost = false, W = 2, H = 2;
  let renderScale = 1;
  const QUALITY = [0.5, 0.75, 1.0];
  let resizeAt = 0, needsResize = true;

  function showError(msg) {
    const el = $('#glError'); el.textContent = msg; el.hidden = false; console.error(msg);
  }
  function compile(type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function program(vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
    return { p, u };
  }

  function initGL() {
    gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
    if (!gl) { showError('WebGL2 is not available in this browser. Try the latest Chrome / Edge.'); return false; }
    useFloat = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    try {
      progFB = program(SHADERS.VERT, SHADERS.FEEDBACK);
      progPost = program(SHADERS.VERT, SHADERS.POST);
    } catch (e) { showError('Shader error:\n' + e.message); return false; }
    uFB = progFB.u; uPost = progPost.u;

    audioTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, audioTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, AUDIO_TEX_W, 2, 0, gl.RED, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindVertexArray(gl.createVertexArray());
    fb = null; pendingOld = null; needsResize = true;
    return true;
  }

  function makeTarget(w, h, float) {
    const levels = Math.floor(Math.log2(Math.max(w, h))) + 1;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, levels, float ? gl.RGBA16F : gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo, ok };
  }
  function freeTarget(t) { if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); } }

  function resize() {
    needsResize = false;
    const dpr = Math.min(window.devicePixelRatio || 1, 1);
    let w = Math.round(canvas.clientWidth * dpr * renderScale);
    let h = Math.round(canvas.clientHeight * dpr * renderScale);
    const maxSide = 1920, m = Math.max(w, h);
    if (m > maxSide) { w = Math.round(w * maxSide / m); h = Math.round(h * maxSide / m); }
    w = Math.max(w, 64); h = Math.max(h, 64);
    if (w === W && h === H && fb) return;
    W = w; H = h; canvas.width = W; canvas.height = H;

    let pair = [makeTarget(W, H, useFloat), makeTarget(W, H, useFloat)];
    if (useFloat && !(pair[0].ok && pair[1].ok)) {   // float render targets unsupported -> 8-bit fallback
      pair.forEach(freeTarget); useFloat = false;
      pair = [makeTarget(W, H, false), makeTarget(W, H, false)];
    }
    if (fb) { pendingOld = fb[cur]; freeTarget(fb[1 - cur]); }  // keep the last picture so a resize doesn't flash black
    fb = pair; cur = 0;
  }

  function setU1(u, name, v) { gl.uniform1f(u[name], v); }

  function draw(dt, a) {
    const k = Math.min(dt * 60, 3), I = S.intensity;
    const sc = S.cur, dz = sc.zoom - 1;
    const beat = a.beat * I, flux = a.flux * I;

    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, audioTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, AUDIO_TEX_W, 2, gl.RED, gl.UNSIGNED_BYTE, a.tex);

    // ---- feedback pass
    const write = fb[1 - cur];
    const readTex = pendingOld ? pendingOld.tex : fb[cur].tex;
    gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo);
    gl.viewport(0, 0, W, H);
    gl.useProgram(progFB.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, readTex);
    gl.uniform1i(uFB.uPrev, 0); gl.uniform1i(uFB.uAudio, 1);
    gl.uniform2f(uFB.uRes, W, H);
    setU1(uFB, 'uTime', S.time); setU1(uFB, 'uPhase', S.phase);
    setU1(uFB, 'uBass', a.bass); setU1(uFB, 'uMid', a.mid); setU1(uFB, 'uHigh', a.high);
    setU1(uFB, 'uBeat', beat); setU1(uFB, 'uEnergy', a.energy); setU1(uFB, 'uFlux', flux);
    const zoomEff = 1 + dz * k * (1 + a.bass) - beat * 0.011 * k;
    S.flow -= Math.log(zoomEff);     // total outward drift so far (the tunnel emitter scrolls with it)
    setU1(uFB, 'uZoom', zoomEff);
    setU1(uFB, 'uFlow', S.flow);
    setU1(uFB, 'uRot', (sc.rot * k * (1 + a.high * 1.5) + beat * 0.010 * k) * S.dir);
    setU1(uFB, 'uSwirl', sc.swirl * k * (1 + a.mid) * S.dir);
    setU1(uFB, 'uWarp', sc.warp * k * (1 + a.mid * 2));
    setU1(uFB, 'uDecay', Math.pow(sc.decay - 0.012, k));
    setU1(uFB, 'uHueShift', (sc.hue + a.high * 0.010) * k);
    setU1(uFB, 'uKaleido', S.kaleido);
    setU1(uFB, 'uBlur', sc.blur * 0.5);
    setU1(uFB, 'uHue', S.hueBase);
    setU1(uFB, 'uGain', 0.55 + 0.55 * a.energy);
    gl.uniform1i(uFB.uEmitA, S.emitFrom);
    gl.uniform1i(uFB.uEmitB, S.emitTo);
    setU1(uFB, 'uEmitMix', S.t >= 1 ? 0 : ease(S.t));
    gl.uniform3f(uFB.uMouse, mouse.x, mouse.y, mouse.down ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    cur = 1 - cur;
    gl.bindTexture(gl.TEXTURE_2D, fb[cur].tex);
    gl.generateMipmap(gl.TEXTURE_2D);
    if (pendingOld) { freeTarget(pendingOld); pendingOld = null; }

    // ---- post pass to screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(progPost.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fb[cur].tex);
    gl.uniform1i(uPost.uTex, 0);
    gl.uniform2f(uPost.uRes, W, H);
    setU1(uPost, 'uTime', S.time); setU1(uPost, 'uBeat', beat); setU1(uPost, 'uBass', a.bass);
    setU1(uPost, 'uEnergy', a.energy);
    setU1(uPost, 'uAberr', sc.aberr * I);
    setU1(uPost, 'uBloom', sc.bloom);
    setU1(uPost, 'uWobble', I);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /* ---------------------------------------------------------------- input / ui */
  const mouse = { x: 0, y: 0, down: false };
  function setMouse(e) {
    const r = canvas.getBoundingClientRect();
    mouse.x = ((e.clientX - r.left) - r.width / 2) / (r.height / 2);
    mouse.y = -((e.clientY - r.top) - r.height / 2) / (r.height / 2);
  }

  let hudTimer = 0;
  function pokeHud() {
    document.body.classList.add('active');
    clearTimeout(hudTimer);
    hudTimer = setTimeout(() => document.body.classList.remove('active'), 3200);
  }

  let toastTimer = 0;
  function toast(msg, kind) {
    const el = $('#toast');
    el.textContent = msg; el.className = 'show ' + (kind || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = kind || ''; }, kind === 'scene' ? 2600 : 5000);
  }

  function showOverlay(msg) {
    $('#overlay').classList.remove('hidden');
    $('#overlayMsg').textContent = msg || '';
    $('#overlayMsg').hidden = !msg;
  }
  function hideOverlay() { $('#overlay').classList.add('hidden'); pokeHud(); }

  async function startCapture() {
    try {
      await audio.useCapture();
      hideOverlay();
      toast('Listening: ' + audio.label, 'info');
      afterSource();
    } catch (e) {
      console.warn(e);
      if (e.code === 'NO_AUDIO_TRACK')
        showOverlay('No audio came through. In the picker: pick the Chrome TAB playing YouTube Music and tick "Also share tab audio" (or pick Entire Screen and tick "Share system audio"). Then try again.');
      else if (e.name === 'NotAllowedError' || e.name === 'AbortError')
        showOverlay('Capture cancelled. Pick a tab / screen and make sure the audio checkbox is ticked.');
      else showOverlay('Could not capture audio: ' + (e.message || e.name));
    }
  }
  async function startMic() {
    try {
      const sel = $('#deviceSel');
      await audio.useMic(sel.value || undefined);
      await listDevices();
      hideOverlay(); toast('Listening: ' + audio.label, 'info'); afterSource();
    } catch (e) { showOverlay('Could not open the input device: ' + (e.message || e.name)); }
  }
  function startDemo() {
    audio.startDemo(); hideOverlay(); afterSource();
    toast('Demo synth. Press C to bring in your real music.', 'info');
  }
  function afterSource() { requestWakeLock(); }
  window.__autoStart = startCapture;   // Electron calls this (loopback capture needs no picker)

  async function listDevices() {
    try {
      const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput' && d.label);
      const sel = $('#deviceSel'); const prev = sel.value;
      sel.innerHTML = '<option value="">Default input</option>' + devs.map(d => `<option value="${d.deviceId}">${d.label.replace(/</g, '&lt;')}</option>`).join('');
      sel.value = prev; $('#deviceRow').hidden = devs.length === 0;
      const sm = devs.find(d => /stereo mix|what u hear|loopback/i.test(d.label));
      if (sm) $('#deviceHint').textContent = `"${sm.label}" looks like a system-audio loopback device. Pick it to hear everything.`;
    } catch (e) { /* ignore */ }
  }

  let wakeLock = null;
  async function requestWakeLock() {
    try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.onrelease = () => { wakeLock = null; }; } } catch (e) { /* not fatal */ }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) requestWakeLock(); });

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  }
  function setIntensity(v) {
    S.intensity = Math.max(0, Math.min(1.5, v));
    $('#intensity').value = S.intensity;
  }
  function toggleAuto() {
    S.auto = !S.auto; $('#btnAuto').classList.toggle('on', S.auto);
    toast(S.auto ? 'Auto-journey ON' : 'Auto-journey OFF (scene locked)', 'info');
  }
  function cycleQuality() {
    const i = (QUALITY.indexOf(renderScale) + 1) % QUALITY.length;
    renderScale = QUALITY[i]; needsResize = true; resizeAt = 0;
    toast('Render quality: ' + ['low', 'medium', 'high'][i], 'info');
  }

  window.addEventListener('resize', () => { needsResize = true; resizeAt = performance.now(); });
  canvas.addEventListener('pointermove', (e) => { setMouse(e); pokeHud(); });
  canvas.addEventListener('pointerdown', (e) => { setMouse(e); mouse.down = true; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointerup', () => { mouse.down = false; });
  canvas.addEventListener('dblclick', toggleFullscreen);
  document.addEventListener('mousemove', pokeHud);

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'n' || k === 'arrowright') { e.preventDefault(); randomScene(); }
    else if (k === 'arrowleft' || k === 'p') goScene(S.idx - 1);
    else if (k >= '1' && k <= '9') goScene(+k - 1);
    else if (k === '0') goScene(9);
    else if (k === 'a') toggleAuto();
    else if (k === 'f') toggleFullscreen();
    else if (k === 'h') document.body.classList.toggle('nohud');
    else if (k === 'c') showOverlay('');
    else if (k === 'd') startDemo();
    else if (k === 'm') { audio.setDemoVolume(audio._muted ? 0.5 : 0); audio._muted = !audio._muted; toast(audio._muted ? 'Demo muted' : 'Demo unmuted', 'info'); }
    else if (k === 'q') cycleQuality();
    else if (k === '[') setIntensity(S.intensity - 0.15);
    else if (k === ']') setIntensity(S.intensity + 0.15);
    else if (k === 'escape') { if (!$('#overlay').classList.contains('hidden') && audio.mode !== 'idle') hideOverlay(); }
    pokeHud();
  });

  $('#btnCapture').onclick = startCapture;
  $('#btnMic').onclick = startMic;
  $('#btnDemo').onclick = startDemo;
  $('#btnNext').onclick = randomScene;
  $('#btnAuto').onclick = toggleAuto;
  $('#btnFull').onclick = toggleFullscreen;
  $('#btnSource').onclick = () => showOverlay('');
  $('#btnClose').onclick = () => { if (audio.mode !== 'idle') hideOverlay(); };
  $('#intensity').oninput = (e) => { S.intensity = +e.target.value; };
  $('#overlay').addEventListener('pointermove', pokeHud);
  audio.onEnded = () => showOverlay('Audio sharing stopped. Pick a source to keep the trip going.');

  if (IS_ELECTRON) {
    $('#btnCapture').textContent = 'Start - listen to everything my PC plays';
    $('#captureHelp').innerHTML = 'Hears <b>all system audio</b> (WASAPI loopback). No picker, no tab-sharing: just hit play on music.youtube.com in your browser.';
  } else if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    $('#btnCapture').disabled = true;
    $('#captureHelp').textContent = 'Audio capture needs a secure context (https or localhost) and a modern Chrome/Edge. Use start-chrome.bat, or the Electron app.';
  }
  navigator.mediaDevices && navigator.mediaDevices.enumerateDevices && listDevices();

  /* ---------------------------------------------------------------- main loop */
  let last = performance.now(), emaDt = 1 / 60, perfClock = 0, lowCount = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    if (glLost) return;
    let dt = (now - last) / 1000; last = now;
    if (dt <= 0) return;
    dt = Math.min(dt, 0.1);

    if (needsResize && now - resizeAt > 120) resize();
    if (!fb) return;

    audio.update(dt);
    updateScene(dt, audio);

    // idle / landing page: keep it alive with a gentle fake pulse so the first impression is already trippy
    if (audio.mode === 'idle') idlePulse(audio, S.time);

    draw(dt, audio);

    // silent-source hint
    const hint = $('#silentHint');
    const silent = (audio.mode === 'capture' || audio.mode === 'mic') && audio.silentTime > 4;
    hint.hidden = !silent;

    // adaptive resolution: if we can't hold ~40fps for a few seconds, drop the render scale
    emaDt += (dt - emaDt) * 0.05; perfClock += dt;
    if (perfClock > 2) {
      perfClock = 0;
      if (emaDt > 0.026 && renderScale > 0.42) { if (++lowCount >= 2) { renderScale = Math.max(0.4, renderScale * 0.82); needsResize = true; resizeAt = 0; lowCount = 0; emaDt = 1 / 60; } }
      else lowCount = 0;
    }
  }

  function idlePulse(a, t) {
    // synthetic spectrum (only touches the renderer's data, never real audio)
    const beatT = t * 1.9, bp = Math.pow(Math.max(0, Math.sin(beatT * Math.PI)), 6);
    for (let j = 0; j < AUDIO_TEX_W; j++) {
      const u = j / AUDIO_TEX_W;
      const v = (0.55 + 0.45 * Math.sin(t * 1.3 + u * 18)) * (1 - u * 0.7) * (0.35 + 0.65 * bp * (1 - u) + 0.25) + 0.15 * Math.sin(t * 3 + u * 40) ** 2;
      a.tex[j] = Math.max(0, Math.min(255, v * 220)) | 0;
      a.tex[AUDIO_TEX_W + j] = 128 + Math.sin(u * 40 + t * 3) * 50 * (0.4 + bp) + Math.sin(u * 13 - t) * 30;
    }
    a.bass = 0.4 + 0.5 * bp; a.mid = 0.45 + 0.2 * Math.sin(t); a.high = 0.35 + 0.2 * Math.sin(t * 1.7);
    a.energy = 0.45 + 0.25 * bp; a.beat = bp * 0.8; a.flux = 0;
  }

  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); glLost = true; });
  canvas.addEventListener('webglcontextrestored', () => { glLost = false; initGL(); });

  if (initGL()) { goScene(0, true); S.t = 1; S.cur = Object.assign({}, SCENES[0]); requestAnimationFrame(frame); }
  $('#btnAuto').classList.add('on');
  pokeHud();
})();
