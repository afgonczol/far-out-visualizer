/* ------------------------------------------------------------------
 * AudioEngine
 *  - gets audio from: display/tab/system capture, mic/line-in, or a built-in demo synth
 *  - turns it into: a log-spaced spectrum, a stable oscilloscope waveform,
 *    4 AGC-normalised bands, beat + onset pulses
 *  - captured audio is NEVER routed to the speakers (the source app already plays it)
 * ------------------------------------------------------------------ */
(function () {
  const TEX_W = 512; // width of the audio texture (row0 = spectrum, row1 = waveform)

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.analyser = null;
      this.sourceNode = null;
      this.rawStream = null;
      this.mode = 'idle'; // idle | capture | mic | demo
      this.label = '';
      this.onEnded = null;

      // output for the renderer
      this.tex = new Uint8Array(TEX_W * 2);
      this.bass = 0; this.lowmid = 0; this.mid = 0; this.high = 0; this.energy = 0;
      this.beat = 0; this.flux = 0; this.beatCount = 0;
      this.silentTime = 0; this.level = 0;

      this._spec = new Float32Array(TEX_W);
      this._freq = null; this._wave = null;
      this._map = null;
      this._bandMax = [0.25, 0.25, 0.25, 0.25];
      this._specMax = 0.3;
      this._bassAvg = 0; this._bassPrev = 0; this._lastBeat = 0; this._fluxAvg = 0.01;
      this._prevSpecSum = null;
      this._clock = 0;
      this._demo = null;
    }

    _ensureCtx() {
      if (!this.ctx) {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 2048;
        this.analyser.smoothingTimeConstant = 0.45;
        this.analyser.minDecibels = -92;
        this.analyser.maxDecibels = -12;
        // keep the analyser "pulled" without making any sound
        this.silent = this.ctx.createGain();
        this.silent.gain.value = 0;
        this.analyser.connect(this.silent).connect(this.ctx.destination);
        this._freq = new Uint8Array(this.analyser.frequencyBinCount);
        this._wave = new Uint8Array(this.analyser.fftSize);
        this._buildMap();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    }

    // map TEX_W log-spaced output bins -> FFT bin ranges
    _buildMap() {
      const sr = this.ctx.sampleRate, n = this.analyser.frequencyBinCount;
      const binHz = sr / this.analyser.fftSize;
      const fmin = 28, fmax = Math.min(16000, sr / 2 - 100);
      const ratio = fmax / fmin;
      this._map = [];
      for (let j = 0; j < TEX_W; j++) {
        const f0 = fmin * Math.pow(ratio, j / TEX_W);
        const f1 = fmin * Math.pow(ratio, (j + 1) / TEX_W);
        let lo = f0 / binHz, hi = f1 / binHz;
        if (hi - lo < 1) { const c = (lo + hi) / 2; lo = c - 0.5; hi = c + 0.5; }
        this._map.push([Math.max(0, lo), Math.min(n - 1, hi)]);
      }
    }

    _disconnect() {
      if (this.sourceNode) { try { this.sourceNode.disconnect(); } catch (e) {} this.sourceNode = null; }
      if (this._demo) { this._demo.stop(); this._demo = null; }
      if (this.rawStream) { this.rawStream.getTracks().forEach(t => { t.onended = null; t.stop(); }); this.rawStream = null; }
    }

    _attachStream(stream, mode, label) {
      this._disconnect();
      this._ensureCtx();
      this.rawStream = stream;
      const audioOnly = new MediaStream(stream.getAudioTracks());
      this.sourceNode = this.ctx.createMediaStreamSource(audioOnly);
      this.sourceNode.connect(this.analyser);
      this.mode = mode; this.label = label; this.silentTime = 0;
      stream.getAudioTracks().forEach(t => {
        t.onended = () => { if (this.rawStream === stream) { this.mode = 'idle'; this.label = ''; if (this.onEnded) this.onEnded(); } };
      });
    }

    /** Tab / window / whole-system capture (Chrome: tick "Share tab audio" / "Share system audio") */
    async useCapture(stream) {
      if (!stream) {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 1 }, width: { ideal: 320 }, height: { ideal: 180 } },
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 },
          systemAudio: 'include',
          selfBrowserSurface: 'exclude',
          surfaceSwitching: 'include',
          monitorTypeSurfaces: 'include',
        });
      }
      if (!stream.getAudioTracks().length) {
        stream.getTracks().forEach(t => t.stop());
        const err = new Error('NO_AUDIO_TRACK');
        err.code = 'NO_AUDIO_TRACK';
        throw err;
      }
      const t = stream.getVideoTracks()[0];
      const label = (t && t.label) || stream.getAudioTracks()[0].label || 'shared audio';
      this._attachStream(stream, 'capture', label);
    }

    async useMic(deviceId) {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2,
        },
      });
      this._attachStream(stream, 'mic', stream.getAudioTracks()[0].label || 'input device');
    }

    startDemo() {
      this._disconnect();
      this._ensureCtx();
      this._demo = new DemoSynth(this.ctx, this.analyser);
      this._demo.start();
      this.mode = 'demo'; this.label = 'built-in demo synth'; this.silentTime = 0;
    }

    setDemoVolume(v) { if (this._demo) this._demo.setVolume(v); }

    stop() { this._disconnect(); this.mode = 'idle'; this.label = ''; }

    /** call once per frame */
    update(dt) {
      this._clock += dt;
      const spec = this._spec;
      const live = this.mode !== 'idle' && this.analyser;

      if (live) {
        this.analyser.getByteFrequencyData(this._freq);
        this.analyser.getByteTimeDomainData(this._wave);
      }

      // ---- spectrum -> log bins, tilt, AGC, attack/decay smoothing
      let frameMax = 0, sum = 0;
      const decay = Math.exp(-dt * 9);
      for (let j = 0; j < TEX_W; j++) {
        let v = 0;
        if (live) {
          const [lo, hi] = this._map[j];
          const a = Math.floor(lo), b = Math.ceil(hi);
          let m = 0;
          for (let i = a; i <= b; i++) m = Math.max(m, this._freq[i]);
          v = m / 255;
        }
        // gentle high-frequency tilt: music is bass-heavy, we want the whole range alive
        v *= 0.85 + 1.5 * (j / TEX_W);
        sum += v;
        if (v > frameMax) frameMax = v;
        const s = spec[j];
        spec[j] = v > s ? s + (v - s) * Math.min(1, dt * 40) : s * decay + v * (1 - decay);
      }
      this.level = sum / TEX_W;
      this._specMax = Math.max(this._specMax * Math.exp(-dt * 0.25), frameMax, 0.35);
      const agc = Math.min(3.5, Math.max(1, 0.9 / this._specMax));
      for (let j = 0; j < TEX_W; j++) this.tex[j] = Math.min(255, spec[j] * agc * 255) | 0;

      // ---- bands
      const avg = (u0, u1) => {
        const a = Math.floor(u0 * TEX_W), b = Math.floor(u1 * TEX_W);
        let s = 0; for (let j = a; j < b; j++) s += this.tex[j];
        return s / ((b - a) * 255);
      };
      const raw = [avg(0, 0.2), avg(0.2, 0.45), avg(0.45, 0.7), avg(0.7, 1)];
      const norm = raw.map((r, i) => {
        this._bandMax[i] = Math.max(this._bandMax[i] * Math.exp(-dt * 0.15), r, 0.22);
        return Math.min(1, r / this._bandMax[i]);
      });
      const sm = (cur, tgt) => cur + (tgt - cur) * (tgt > cur ? Math.min(1, dt * 30) : Math.min(1, dt * 7));
      this.bass = sm(this.bass, norm[0]);
      this.lowmid = sm(this.lowmid, norm[1]);
      this.mid = sm(this.mid, norm[2]);
      this.high = sm(this.high, norm[3]);
      this.energy = sm(this.energy, (norm[0] * 0.5 + norm[1] * 0.25 + norm[2] * 0.15 + norm[3] * 0.1));

      // ---- beat (bass transient vs. running average) and broadband onset (spectral flux)
      // Beats = sudden rises in the low end (flux), not "bass is loud": sustained sub-bass must not mask the kick.
      let lowFlux = 0;
      const lowN = Math.floor(TEX_W * 0.26);
      if (!this._prevLow) this._prevLow = new Float32Array(lowN);
      for (let j = 0; j < lowN; j++) {
        const d = this.tex[j] / 255 - this._prevLow[j];
        if (d > 0) lowFlux += d;
        this._prevLow[j] = this.tex[j] / 255;
      }
      lowFlux /= lowN;
      this._bassAvg += (lowFlux - this._bassAvg) * (1 - Math.exp(-dt * 2.0));
      if (live && lowFlux > this._bassAvg * 2.2 + 0.012 && this._clock - this._lastBeat > 0.19) {
        this.beat = 1; this._lastBeat = this._clock; this.beatCount++;
      }
      this.beat *= Math.exp(-dt * 5.5);

      let flux = 0;
      if (this._prevSpecSum) {
        for (let j = 0; j < TEX_W; j += 4) { const d = this.tex[j] - this._prevSpecSum[j >> 2]; if (d > 0) flux += d; }
      } else this._prevSpecSum = new Float32Array(TEX_W >> 2);
      for (let j = 0; j < TEX_W; j += 4) this._prevSpecSum[j >> 2] = this.tex[j];
      flux /= (TEX_W / 4) * 255;
      this._fluxAvg += (flux - this._fluxAvg) * (1 - Math.exp(-dt * 1.2));
      if (live && flux > this._fluxAvg * 1.8 + 0.01) this.flux = Math.min(1, this.flux + 0.6);
      this.flux *= Math.exp(-dt * 7);

      // ---- waveform: trigger on a rising zero-crossing so the scope is stable; normalise amplitude
      const row = TEX_W;
      if (live) {
        const w = this._wave, N = w.length, win = 1024;
        let start = 0;
        for (let i = 1; i < N - win; i++) { if (w[i - 1] < 128 && w[i] >= 128) { start = i; break; } }
        let pk = 0;
        for (let i = 0; i < win; i++) pk = Math.max(pk, Math.abs(w[start + i] - 128));
        const g = 1 / Math.max(pk / 128, 0.12);
        const gain = Math.min(g, 6);
        for (let j = 0; j < TEX_W; j++) {
          const x = (w[start + ((j * win) / TEX_W | 0)] - 128) / 128 * gain * 0.8;
          this.tex[row + j] = Math.max(0, Math.min(255, 128 + x * 127)) | 0;
        }
        this.silentTime = this.level < 0.012 ? this.silentTime + dt : 0;
      } else {
        this.tex.fill(128, row);
      }
    }
  }

  /* ------------------------------------------------------------------
   * Tiny sequenced demo synth so the thing works with no music source
   * ------------------------------------------------------------------ */
  class DemoSynth {
    constructor(ctx, analyser) {
      this.ctx = ctx;
      this.out = ctx.createGain();
      this.out.gain.value = 0.35;
      this.out.connect(analyser);           // visualiser always hears it
      this.mon = ctx.createGain();          // speakers only if volume > 0
      this.mon.gain.value = 0.5;
      this.out.connect(this.mon).connect(ctx.destination);
      this.bpm = 118; this.step = 0; this.next = ctx.currentTime + 0.1; this.timer = null;
      const len = ctx.sampleRate;
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      // pad: slow detuned saws through a wobbling lowpass
      this.pad = [];
      const padGain = ctx.createGain(); padGain.gain.value = 0.05;
      this.padFilter = ctx.createBiquadFilter(); this.padFilter.type = 'lowpass'; this.padFilter.frequency.value = 900; this.padFilter.Q.value = 6;
      this.padFilter.connect(padGain).connect(this.out);
      this.lfo = ctx.createOscillator(); this.lfo.frequency.value = 0.13;
      const lg = ctx.createGain(); lg.gain.value = 700; this.lfo.connect(lg).connect(this.padFilter.frequency); this.lfo.start();
      for (let i = 0; i < 4; i++) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.detune.value = (i - 1.5) * 9;
        o.frequency.value = 110; o.connect(this.padFilter); o.start(); this.pad.push(o);
      }
    }
    setVolume(v) { this.mon.gain.value = v; }
    start() { this.timer = setInterval(() => this.schedule(), 25); }
    stop() {
      clearInterval(this.timer);
      try { this.lfo.stop(); this.pad.forEach(o => o.stop()); this.out.disconnect(); } catch (e) {}
    }
    schedule() {
      const spb = 60 / this.bpm / 4; // 16th
      while (this.next < this.ctx.currentTime + 0.12) { this.play(this.step, this.next); this.next += spb; this.step = (this.step + 1) % 64; }
    }
    play(s, t) {
      const ctx = this.ctx, bar = (s / 16) | 0, st = s % 16;
      if (st % 4 === 0) this.kick(t);
      if (st === 4 || st === 12) this.snare(t);
      if (st % 2 === 0) this.hat(t, st % 4 === 2 ? 0.5 : 0.25);
      if (st % 4 === 3 && bar % 2 === 1) this.hat(t, 0.15, true);
      const root = [55, 55, 65.41, 49][bar];       // A1 A1 C2 G1
      const arp = [1, 1.5, 2, 3, 2, 1.5, 2, 4, 1, 1.5, 2, 3, 4, 3, 2, 1.5];
      if (st % 2 === 0 || st % 4 === 3) this.bass(t, root * (st % 4 === 0 ? 1 : 2), 0.16);
      this.lead(t, root * 4 * arp[st], 0.12);
      if (st === 0) {
        const ch = [[1, 1.2, 1.5], [1.2, 1.5, 1.8], [1, 1.25, 1.5], [0.89, 1.12, 1.33]][bar];
        this.pad.forEach((o, i) => o.frequency.setTargetAtTime(root * 4 * ch[i % 3] * (i > 2 ? 2 : 1), t, 0.4));
      }
    }
    env(g, t, a, d, peak) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
    kick(t) {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.frequency.setValueAtTime(170, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      this.env(g, t, 0.004, 0.35, 1.0); o.connect(g).connect(this.out); o.start(t); o.stop(t + 0.4);
    }
    snare(t) {
      const n = this.ctx.createBufferSource(); n.buffer = this.noiseBuf;
      const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.8;
      const g = this.ctx.createGain(); this.env(g, t, 0.003, 0.18, 0.55);
      n.connect(f).connect(g).connect(this.out); n.start(t); n.stop(t + 0.25);
    }
    hat(t, v, open) {
      const n = this.ctx.createBufferSource(); n.buffer = this.noiseBuf;
      const f = this.ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7500;
      const g = this.ctx.createGain(); this.env(g, t, 0.002, open ? 0.12 : 0.04, v * 0.5);
      n.connect(f).connect(g).connect(this.out); n.start(t); n.stop(t + 0.2);
    }
    bass(t, hz, v) {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain(), f = this.ctx.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.value = hz; f.type = 'lowpass'; f.Q.value = 8;
      f.frequency.setValueAtTime(1400, t); f.frequency.exponentialRampToValueAtTime(140, t + 0.18);
      this.env(g, t, 0.005, 0.2, v); o.connect(f).connect(g).connect(this.out); o.start(t); o.stop(t + 0.3);
    }
    lead(t, hz, v) {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = 'square'; o.frequency.value = hz;
      this.env(g, t, 0.004, 0.11, v * 0.5); o.connect(g).connect(this.out); o.start(t); o.stop(t + 0.16);
    }
  }

  window.AudioEngine = AudioEngine;
  window.AUDIO_TEX_W = TEX_W;
})();
