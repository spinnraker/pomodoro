(function () {
  'use strict';

  const E = window.PomoEngine;
  const STORE = 'pomo:v1';
  const TICK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const ICON = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>',
    stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10v10H7z"/></svg>',
    skip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>',
  };
  const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const RING_C = 2 * Math.PI * 46;
  const LATE_MS = 15000;

  const KIND_NAME = { focus: 'Focus', short: 'Short break', long: 'Long break' };

  const DISCLAIMER = [
    'Break moves are gentle range only. You should feel a mild stretch, never strain.',
    'Stop a move if pain is sharp, shooting, or builds as you go.',
    'Stop any move that makes arm tingling or numbness worse, and tell your PT or doctor.',
    'No neck circles and no forcing your head backward.',
    'Turn off any move your clinician hasn’t okayed in Setup. This app isn’t medical advice.',
  ];

  const REST_TIPS = [
    'Look away from the screen. Get some water.',
    'Stand up and walk to the window.',
    'Let your shoulders drop. Unclench your jaw.',
    'Refill your water. Leave your phone where it is.',
  ];

  const app = document.getElementById('app');
  const sheetEl = document.getElementById('sheet');
  const toastEl = document.getElementById('toast');

  let state = load();
  let view = 'timer';
  let sheet = null;
  let lastToday = today();
  let justEnded = null; // { kind, at } when a phase ran out while you weren't looking

  // ---------- storage ----------

  function load() {
    let raw = null;
    try {
      raw = localStorage.getItem(STORE);
      if (raw) {
        const { state: s, dropped } = E.normalize(JSON.parse(raw), today());
        if (dropped) localStorage.setItem(`${STORE}:unreadable:${Date.now()}`, raw);
        return s;
      }
    } catch (e) {
      try { if (raw) localStorage.setItem(`${STORE}:unreadable:${Date.now()}`, raw); } catch (e2) { /* storage unavailable */ }
    }
    return E.freshState(today());
  }

  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* storage unavailable */ }
  }

  // ---------- helpers ----------

  function today() { return E.toKey(new Date()); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
  function plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }
  function moves() { return state.moves.slice().sort((a, b) => a.order - b.order); }

  function clock(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function hours(sec) {
    const m = Math.round(sec / 60);
    if (m < 60) return `${m}m`;
    return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
  }

  function timeOf(ts) {
    return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function shortDate(key) {
    return E.fromKey(key).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function describeMove(m) {
    const sec = E.moveSeconds(m);
    if (m.type === 'breath') return `${m.reps} slow breaths · ${sec}s`;
    const side = m.sides === 'each' ? ' each side' : '';
    const n = m.reps > 1 ? `${m.reps} × ` : '';
    return `${n}${m.holdSeconds}s hold${side} · ${sec}s`;
  }

  // ---------- toasts ----------

  const queue = [];
  let toasting = false;

  function toast(...msgs) {
    queue.length = 0;
    queue.push(...msgs);
    if (!toasting) nextToast();
  }

  function nextToast() {
    const msg = queue.shift();
    if (!msg) { toasting = false; return; }
    toasting = true;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    setTimeout(() => {
      toastEl.classList.remove('show');
      setTimeout(nextToast, 260);
    }, 1600);
  }

  // ---------- files ----------

  function shareFile(text, name, type, title) {
    // Downloads are unreliable in an iPhone home-screen app; the share sheet
    // lets you save to Files instead.
    const touch = window.matchMedia && matchMedia('(pointer: coarse)').matches;
    if (touch && navigator.canShare && typeof File === 'function') {
      const file = new File([text], name, { type });
      if (navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title }).catch((e) => {
          if (e && e.name !== 'AbortError') download(text, name, type);
        });
        return;
      }
    }
    download(text, name, type);
  }

  function download(text, name, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.hidden = true;
    document.body.appendChild(input);
    input.onchange = () => {
      const file = input.files[0];
      input.remove();
      if (!file) return;
      file.text().then((text) => {
        const raw = JSON.parse(text);
        if (!raw || !Array.isArray(raw.moves) || !Array.isArray(raw.log)) throw new Error('not a backup');
        const { state: next, dropped } = E.normalize(raw, today());
        const note = dropped ? ` ${plural(dropped, 'record')} in it can’t be read and will be skipped.` : '';
        if (!confirm(`Replace all current data with this backup?${note}`)) return;
        next.settings.disclaimerAccepted = true;
        stopClock();
        state = next;
        save();
        R.index = -1;
        render();
        startClock();
        toast('Backup restored');
      }).catch(() => toast('That file isn’t a Pomo backup'));
    };
    input.click();
  }

  // ---------- cues: voice, tones, vibration, screen ----------

  const Cues = {
    ctx: null,
    held: [], // iOS drops utterances that get garbage-collected mid-speech

    /** Must run inside a tap: iOS only allows audio and speech after a user gesture. */
    unlock() {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC && !this.ctx) this.ctx = new AC();
        if (this.ctx && this.ctx.state !== 'running') this.ctx.resume();
      } catch (e) { /* no audio */ }
      if (state.settings.voice && 'speechSynthesis' in window) {
        speechSynthesis.cancel();
        speechSynthesis.speak(new SpeechSynthesisUtterance(' '));
      }
    },
    say(text, interrupt) {
      if (!state.settings.voice || !('speechSynthesis' in window) || document.hidden) return;
      if (interrupt) speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.95;
      this.held.push(u);
      if (this.held.length > 20) this.held.shift();
      speechSynthesis.speak(u);
    },
    stop() {
      if ('speechSynthesis' in window) speechSynthesis.cancel();
    },
    beep(freq, ms, delay = 0, vol = 0.16) {
      if (!state.settings.tones || !this.ctx) return;
      try {
        const t = this.ctx.currentTime + delay;
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = 'sine';
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
        o.connect(g).connect(this.ctx.destination);
        o.start(t);
        o.stop(t + ms / 1000 + 0.02);
      } catch (e) { /* ignore */ }
    },
    buzz(p) { if (state.settings.tones && navigator.vibrate) navigator.vibrate(p); },
    // Soft, low tones: same feel as the PT app.
    holdStart() { this.beep(392, 260); this.buzz(40); },
    holdEnd() { this.beep(523, 180, 0, 0.13); this.beep(659, 320, 0.17, 0.13); this.buzz([20, 50, 20]); },
    tick() { this.beep(600, 50, 0, 0.06); },
    tap() { this.beep(520, 60, 0, 0.1); this.buzz(8); },
    breathIn() { this.beep(330, 900, 0, 0.08); },
    breathOut() { this.beep(262, 1200, 0, 0.06); },
    chime() { this.beep(523, 260, 0, 0.18); this.beep(659, 260, 0.22, 0.18); this.beep(784, 500, 0.44, 0.18); this.buzz([60, 80, 60]); },
    nudge() { this.beep(440, 200, 0, 0.1); this.beep(440, 200, 0.3, 0.1); },
  };

  let wakeLock = null;
  async function lockScreen() {
    try {
      if (state.settings.keepAwake && state.current && 'wakeLock' in navigator && !document.hidden && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch (e) { /* not supported: rely on Auto-Lock setting */ }
  }
  function releaseScreen() {
    if (wakeLock) wakeLock.release().catch(() => {});
    wakeLock = null;
  }

  // ---------- phases ----------
  //
  // The engine owns the timing (wall-clock timestamps in state.current). This
  // just checks it a few times a second, plays cues and keeps the screen fresh.
  // Break moves only advance while they're on screen, so the app knows whether
  // you actually saw them.

  const R = { index: -1, spoken: new Set(), lastTick: Date.now(), lastSave: 0, tip: 0 };
  let timer = null;

  function startClock() {
    if (!timer) timer = setInterval(tick, 200);
  }
  function stopClock() {
    clearInterval(timer);
    timer = null;
  }

  function steps() {
    const p = state.current;
    return p ? E.moveSteps(p.moves) : [];
  }

  function movesActive(p) {
    if (!p || p.kind === 'focus' || p.movesSkipped || !p.moves.length) return false;
    return !E.stepAt(steps(), p.moveMs / 1000).done;
  }

  function begin(kind) {
    Cues.unlock();
    closeStale();
    if (state.current) return;
    const now = Date.now();
    justEnded = null;
    const p = E.startPhase(state, kind, now, today(), uid());
    save();
    R.index = -1;
    R.spoken.clear();
    R.lastTick = now;
    R.tip = Math.floor(Math.random() * REST_TIPS.length);
    lockScreen();
    if (kind === 'focus') {
      Cues.holdStart();
      Cues.say(`Focus. ${state.settings.focusMin} minutes.`, true);
    } else {
      Cues.chime();
      if (p.moves.length) Cues.say(`${KIND_NAME[kind]}. Stand up if you can. First, ${p.moves[0].name}.`, true);
      else Cues.say(`${KIND_NAME[kind]}. Step away from the screen.`, true);
      R.index = 0;
    }
    render();
  }

  function finishPhase(status, at, late) {
    const p = state.current;
    if (!p) return;
    const kind = p.kind;
    const rec = E.endPhase(state, at, status, today());
    save();
    R.index = -1;
    releaseScreen();
    if (status !== 'completed') {
      justEnded = null;
      render();
      return rec;
    }
    // begin() plays its own cue, so only announce when nothing starts automatically.
    const auto = !late && (kind === 'focus' ? state.settings.autoBreak : state.settings.autoFocus);
    if (auto) { begin(state.next); return rec; }
    if (!late) {
      Cues.chime();
      Cues.say(kind === 'focus' ? 'Focus done. Time for a break.' : 'Break’s over. Ready when you are.', true);
    }
    justEnded = { kind, at };
    render();
    return rec;
  }

  /** A phase left paused on an earlier day is saved as stopped. */
  function closeStale() {
    const p = state.current;
    if (!p || p.date === today() || p.pausedAt == null) return;
    E.endPhase(state, p.pausedAt, 'stopped', today());
    save();
  }

  function onStep(prev, i, list) {
    const p = state.current;
    if (prev >= 0 && list[prev] && list[prev].kind === 'hold') Cues.holdEnd();
    if (i >= list.length) {
      Cues.say('Moves done. Rest your eyes until the break ends.');
      return;
    }
    const s = list[i];
    const m = p.moves[s.mv];
    const side = s.side === 'left' ? 'Left' : 'Right';
    switch (s.kind) {
      case 'intro':
        if (prev >= 0) { Cues.tap(); Cues.say(`Next: ${m.name}.`); }
        break;
      case 'ready':
        Cues.say(s.side ? `${side} side.` : 'Get ready.');
        break;
      case 'rest':
        if (s.label === 'Switch sides') Cues.say(`Switch to ${side.toLowerCase()} side.`);
        break;
      case 'hold':
        Cues.holdStart();
        break;
      case 'in':
        Cues.breathIn();
        if (s.rep === 1) Cues.say('Breathe in.');
        break;
      case 'out':
        Cues.breathOut();
        if (s.rep === 1) Cues.say('And out.');
        break;
    }
  }

  function tick() {
    const now = Date.now();
    const dt = Math.min(1000, Math.max(0, now - R.lastTick));
    R.lastTick = now;
    checkDay();
    const p = state.current;
    if (!p) return;
    if (p.pausedAt != null) return;

    const rem = E.remainingMs(p, now);
    if (rem <= 0) {
      const at = E.endsAt(p);
      finishPhase('completed', at, now - at > LATE_MS);
      return;
    }

    if (p.kind === 'focus') {
      const half = p.durationSec * 500;
      if (state.settings.postureCue && !p.postureDone && p.durationSec >= 15 * 60 && E.elapsedMs(p, now) >= half) {
        p.postureDone = true;
        save();
        if (now - (p.startedAt + p.pausedMs + half) < LATE_MS) {
          Cues.nudge();
          Cues.say('Posture check. Chin back, shoulders down.');
          toast('Posture check · chin back, shoulders down');
        }
      }
    } else if (movesActive(p)) {
      const list = steps();
      if (!document.hidden && view === 'timer' && !sheet) p.moveMs += dt;
      const at = E.stepAt(list, p.moveMs / 1000);
      if (at.index !== R.index) {
        const prev = R.index;
        R.index = at.index;
        R.spoken.clear();
        onStep(prev, at.index, list);
        save();
        render();
        return;
      }
      const s = list[at.index];
      const left = Math.ceil(at.remaining);
      if (s.kind === 'hold' && s.duration >= 5 && left >= 1 && left <= 3 && !R.spoken.has(left)) {
        R.spoken.add(left);
        Cues.tick();
      }
      updateStep(at.remaining, s.duration);
    }

    if (now - R.lastSave > 2000) { R.lastSave = now; save(); }
    updateClock(rem, p.durationSec * 1000);
  }

  function pause() {
    const p = state.current;
    if (!p || p.pausedAt != null) return;
    E.pausePhase(p, Date.now());
    Cues.stop();
    releaseScreen();
    save();
    render();
  }

  function resume() {
    const p = state.current;
    if (!p || p.pausedAt == null) return;
    Cues.unlock();
    E.resumePhase(p, Date.now());
    R.lastTick = Date.now();
    lockScreen();
    save();
    render();
  }

  function endFocus() {
    const p = state.current;
    if (!p || p.kind !== 'focus') return;
    const mins = Math.round(E.elapsedMs(p, Date.now()) / 60000);
    if (!confirm(`End this block early? The ${plural(mins, 'minute')} so far still count toward today.`)) return;
    finishPhase('stopped', Date.now(), false);
    toast(`Saved ${plural(mins, 'minute')}`);
  }

  function skipMoves() {
    const p = state.current;
    if (!p || p.kind === 'focus') return;
    p.movesSkipped = true;
    Cues.stop();
    save();
    render();
  }

  function focusNow() {
    const p = state.current;
    if (p && p.kind !== 'focus') finishPhase('stopped', Date.now(), false);
    begin('focus');
  }

  function skipBreak() {
    if (state.next === 'long') state.cycle.count = 0;
    state.next = 'focus';
    justEnded = null;
    save();
    render();
  }

  function distracted() {
    const p = state.current;
    if (!p || p.kind !== 'focus') return;
    p.distractions++;
    Cues.tap();
    save();
    const out = document.getElementById('distract-n');
    if (out) out.textContent = String(p.distractions);
  }

  // ---------- timer view ----------

  function ring(id, cls, inner, label) {
    return `<div class="ring time ${cls}" role="timer" aria-live="off" aria-label="${esc(label)}">
      <svg viewBox="0 0 100 100" aria-hidden="true"><circle class="track" cx="50" cy="50" r="46"/>
        <circle class="arc" id="${id}" cx="50" cy="50" r="46" stroke-dasharray="${RING_C} ${RING_C}" stroke-dashoffset="0"/></svg>
      <div class="ring-in">${inner}</div>
    </div>`;
  }

  function updateClock(remaining, total) {
    const c = document.getElementById('clock');
    const arc = document.getElementById('arc');
    const left = document.getElementById('left');
    if (c) c.textContent = clock(remaining);
    if (left) left.textContent = clock(remaining);
    if (arc) arc.setAttribute('stroke-dashoffset', String(RING_C * Math.min(1, Math.max(0, 1 - remaining / total))));
  }

  function updateStep(remaining, total) {
    const c = document.getElementById('step-clock');
    const arc = document.getElementById('step-arc');
    if (c) c.textContent = String(Math.max(0, Math.ceil(remaining)));
    if (arc) arc.setAttribute('stroke-dashoffset', String(RING_C * Math.min(1, Math.max(0, 1 - remaining / total))));
  }

  function controls(left, main, right) {
    return `<div class="controls">${left}${main}${right}</div>`;
  }

  function pauseBtn(paused) {
    return `<button class="ctl main" data-action="${paused ? 'resume' : 'pause'}" aria-label="${paused ? 'Resume' : 'Pause'}"><i>${paused ? ICON.play : ICON.pause}</i></button>`;
  }

  function idleStage(t) {
    const kind = E.upcoming(state, t);
    const total = E.phaseSeconds(state.settings, kind) * 1000;
    const count = E.cycleCount(state, t);
    const every = state.settings.longEvery;
    const doneInSet = kind === 'long' ? every : count % every;
    const inSet = kind === 'focus' ? doneInSet + 1 : doneInSet;
    let note = '';
    if (justEnded) {
      note = `<p class="ended">${justEnded.kind === 'focus' ? 'Focus' : 'Break'} ended at ${esc(timeOf(justEnded.at))}</p>`;
    }
    const setDots = Array.from({ length: every }, (_, i) =>
      `<i class="${i < doneInSet ? 'on' : i === doneInSet && kind === 'focus' ? 'next' : ''}"></i>`).join('');
    const labels = E.recentLabels(state.log).filter((l) => l !== state.label.trim());

    const focusBits = kind === 'focus' ? `
      <label class="field label-field"><span class="sr-only">What’s this block for?</span>
        <input type="text" data-field="label" value="${esc(state.label)}" placeholder="What’s this block for?" maxlength="80" autocomplete="off" enterkeyhint="go">
      </label>
      ${labels.length ? `<div class="chips">${labels.map((l) => `<button class="chip" data-action="pick-label" data-val="${esc(l)}">${esc(l)}</button>`).join('')}</div>` : ''}` : '';

    const breakBits = kind !== 'focus'
      ? `<p class="start-sub">${state.moves.some((m) => m.enabled) ? 'Starts with a short guided move' : 'No break moves on. Turn some on in Setup.'}</p>
         <button class="link" data-action="skip-break" style="display:block;margin:4px auto 0">Skip break</button>`
      : '';

    return `<div class="stage">
        ${note}
        ${ring('arc', 'idle', `<b id="clock">${clock(total)}</b><small>${KIND_NAME[kind]}</small>`, `${KIND_NAME[kind]}, ${clock(total)}`)}
        <div class="set" role="img" aria-label="${kind === 'focus' ? `Block ${inSet} of ${every} before a long break` : `${inSet} of ${every} blocks done in this set`}">${setDots}</div>
      </div>
      ${focusBits}
      <div class="start">
        <button class="btn block big" data-action="start" data-kind="${kind}">Start ${kind === 'focus' ? 'focus' : KIND_NAME[kind].toLowerCase()}</button>
        ${breakBits}
      </div>`;
  }

  function focusStage(p, now) {
    const paused = p.pausedAt != null;
    const rem = E.remainingMs(p, now);
    return `<div class="stage">
        ${ring('arc', 'hold', `<b id="clock">${clock(rem)}</b><small>${paused ? 'Paused' : 'Focus'}</small>`, 'Focus time left')}
        <p class="focus-label">${p.label ? esc(p.label) : '&nbsp;'}</p>
      </div>
      ${controls(
        `<button class="ctl" data-action="end-focus" aria-label="End block early"><i>${ICON.stop}</i>End</button>`,
        pauseBtn(paused),
        `<button class="ctl" data-action="distracted" aria-label="I got distracted. Count so far: ${p.distractions}"><i><b id="distract-n">${p.distractions}</b></i>Distracted +1</button>`,
      )}
      <p class="hint center">Caught yourself drifting? Tap Distracted, then back to it.</p>`;
  }

  function breakStage(p, now) {
    const paused = p.pausedAt != null;
    const rem = E.remainingMs(p, now);
    const list = steps();
    const at = E.stepAt(list, p.moveMs / 1000);
    const top = `<div class="break-top"><span>${KIND_NAME[p.kind]}</span><span><b id="left">${clock(rem)}</b> left</span></div>
      <div class="s-bar" aria-hidden="true"><i style="width:${Math.round((1 - rem / (p.durationSec * 1000)) * 100)}%"></i></div>`;

    if (movesActive(p)) {
      const s = list[at.index];
      const m = p.moves[s.mv];
      const phase = s.kind === 'intro' ? `${s.label} move` : s.label;
      const side = s.side ? `<span class="side ${s.side}">${s.side === 'left' ? 'Left' : 'Right'}</span>` : '';
      const rep = s.kind === 'intro'
        ? `<div class="s-rep">${esc(describeMove(m))}</div>`
        : `<div class="s-rep"><span>${m.type === 'breath' ? 'Breath' : 'Rep'} ${s.rep} of ${s.of}</span>${side}</div>`;
      const cls = s.kind === 'hold' || s.kind === 'in' ? 'hold' : 'rest';
      return `${top}
        <p class="move-count">Move ${s.mv + 1} of ${p.moves.length}</p>
        <h1 class="s-name">${esc(m.name)}</h1>
        <p class="s-cue">${esc(m.cue)}</p>
        <div class="stage compact">
          ${ring('step-arc', `${cls} compact`, `<b class="step-clock" id="step-clock">${Math.ceil(at.remaining)}</b><small>${esc(paused ? 'Paused' : phase)}</small>`, `${phase}, seconds left`)}
          ${rep}
        </div>
        ${controls(
          `<button class="ctl" data-action="focus-now" aria-label="End break and start focus"><i>${ICON.play}</i>Focus now</button>`,
          pauseBtn(paused),
          `<button class="ctl" data-action="skip-moves" aria-label="Skip moves"><i>${ICON.skip}</i>Skip moves</button>`,
        )}`;
    }

    const done = p.moves.length && !p.movesSkipped;
    return `${top}
      <h1 class="s-name">${done ? 'Moves done.' : 'Break.'}</h1>
      <p class="s-cue">${esc(REST_TIPS[R.tip % REST_TIPS.length])}</p>
      <div class="stage">
        ${ring('arc', 'rest', `<b id="clock">${clock(rem)}</b><small>${paused ? 'Paused' : 'Rest'}</small>`, 'Break time left')}
      </div>
      ${controls(
        `<button class="ctl" data-action="focus-now" aria-label="End break and start focus"><i>${ICON.play}</i>Focus now</button>`,
        pauseBtn(paused),
        '<span></span>',
      )}`;
  }

  function weekStrip(t) {
    const goal = state.settings.dailyGoal;
    return E.weekOf(t).map((d, i) => {
      const s = E.daySummary(state.log, d);
      const v = s.blocks >= goal ? 'full' : s.blocks > 0 ? 'tiny' : '';
      const label = `${E.fromKey(d).toLocaleDateString(undefined, { weekday: 'long' })}: ${plural(s.blocks, 'block')}`;
      return `<div class="col${d === t ? ' today' : ''}${d > t ? ' future' : ''}">
        <span class="check" data-v="${v}" role="img" aria-label="${esc(label)}">${TICK}</span>
        <small>${DAY_LETTERS[i]}</small>
      </div>`;
    }).join('');
  }

  function timerView(t) {
    const p = state.current;
    const now = Date.now();
    const s = E.daySummary(state.log, t);
    const goal = state.settings.dailyGoal;
    const date = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    let stage;
    if (!p) stage = `<div class="date">${esc(date)}</div><h1>${s.blocks >= goal ? 'Goal reached.' : s.blocks ? `${s.blocks} down.` : 'Ready?'}</h1>${idleStage(t)}`;
    else if (p.kind === 'focus') stage = `<div class="date">${esc(date)}</div><h1>${s.blocks + 1}${s.blocks + 1 > goal ? '' : ` of ${goal}`}</h1>${focusStage(p, now)}`;
    else stage = breakStage(p, now);

    const pct = Math.min(100, Math.round((s.blocks / goal) * 100));
    return `${stage}
      <h2 class="section-label">Today</h2>
      <div class="stats three">
        <div class="stat"><b>${s.blocks}/${goal}</b><small>Blocks</small></div>
        <div class="stat"><b>${hours(s.focusSec)}</b><small>Focus</small></div>
        <div class="stat"><b>${s.breaks ? `${s.moved}/${s.breaks}` : '–'}</b><small>Breaks moved</small></div>
      </div>
      <div class="bar" role="progressbar" aria-label="Daily goal" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>
      <div class="week-edit" style="margin-top:20px">${weekStrip(t)}</div>
      <button class="link" data-action="disclaimer" style="margin-top:12px">About the break moves · safety</button>`;
  }

  // ---------- history ----------

  function historyView(t) {
    const from7 = E.addDays(t, -6);
    const w = E.rangeSummary(state.log, from7, t);
    const perBlock = w.blocks ? (w.distractions / w.blocks).toFixed(1) : '–';
    const days = [...new Set(state.log.map((r) => r.date))].sort().reverse();
    const goal = state.settings.dailyGoal;

    const rows = days.slice(0, 30).map((d) => {
      const s = E.daySummary(state.log, d);
      const pct = Math.min(100, Math.round((s.blocks / goal) * 100));
      const sub = [
        s.breaks ? `moved on ${s.moved} of ${plural(s.breaks, 'break')}` : '',
        s.distractions ? plural(s.distractions, 'distraction') : '',
      ].filter(Boolean).join(' · ');
      return `<button class="srow" data-action="day" data-id="${d}">
        <div class="srow-head"><b>${esc(d === t ? 'Today' : shortDate(d))}</b><span>${plural(s.blocks, 'block')} · ${hours(s.focusSec)}</span></div>
        ${sub ? `<div class="srow-sub">${esc(sub)}</div>` : ''}
        <div class="mini" aria-hidden="true"><i style="width:${pct}%"></i></div>
      </button>`;
    }).join('');

    return `<div class="date">Last 7 days</div><h1>History</h1>
      <div class="stats three">
        <div class="stat"><b>${hours(w.focusSec)}</b><small>Focus</small></div>
        <div class="stat"><b>${w.blocks}</b><small>Blocks</small></div>
        <div class="stat"><b>${w.breaks ? Math.round((w.moved / w.breaks) * 100) + '%' : '–'}</b><small>Breaks moved</small></div>
      </div>
      <p class="hint">${w.blocks ? `${perBlock} distractions per block on average.` : 'Finish a focus block to start your history.'}</p>
      <h2 class="section-label">Blocks per day</h2>
      ${chart(t)}
      <h2 class="section-label">Days</h2>
      <div class="list">${rows || '<p class="chart-empty">Nothing yet.</p>'}</div>`;
  }

  function chart(t) {
    const n = 14;
    const goal = state.settings.dailyGoal;
    const data = Array.from({ length: n }, (_, i) => {
      const d = E.addDays(t, i - n + 1);
      return { d, v: E.daySummary(state.log, d).blocks };
    });
    const max = Math.max(goal, ...data.map((x) => x.v));
    const W = 320, H = 140, top = 10, bottom = 22, bw = W / n;
    const y = (v) => top + (H - top - bottom) * (1 - v / max);
    const bars = data.map((x, i) => {
      const h = (H - top - bottom) * (x.v / max);
      return `<rect class="cbar${x.d === t ? ' now' : ''}" x="${i * bw + 3}" y="${H - bottom - h}" width="${bw - 6}" height="${Math.max(0, h)}" rx="1.5"><title>${esc(shortDate(x.d))}: ${x.v}</title></rect>`;
    }).join('');
    const labels = data.map((x, i) => (i % 2 === 1 || i === n - 1)
      ? `<text class="axis" x="${i * bw + bw / 2}" y="${H - 6}" text-anchor="middle">${E.fromKey(x.d).getDate()}</text>` : '').join('');
    return `<div class="chart" role="img" aria-label="Focus blocks per day for the last two weeks, goal ${goal}">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <line class="grid" x1="0" x2="${W}" y1="${H - bottom}" y2="${H - bottom}"/>
        <line class="goal" x1="0" x2="${W}" y1="${y(goal)}" y2="${y(goal)}"/>
        ${bars}${labels}
      </svg>
      <div class="legend"><span><i></i>Blocks</span><span><i class="b"></i>Goal (${goal})</span></div>
    </div>`;
  }

  // ---------- setup ----------

  function stepRow(field, label, value, unit, min, max) {
    return `<div class="row-step">
      <span>${esc(label)}</span>
      <div class="stepper small">
        <button data-action="set-step" data-field="${field}" data-delta="-1" aria-label="Less ${esc(label)}" ${value <= min ? 'disabled' : ''}>−</button>
        <output>${value}${unit}</output>
        <button data-action="set-step" data-field="${field}" data-delta="1" aria-label="More ${esc(label)}" ${value >= max ? 'disabled' : ''}>+</button>
      </div>
    </div>`;
  }

  const LIMITS = {
    focusMin: [5, 90, 5], shortMin: [1, 30, 1], longMin: [5, 60, 5], longEvery: [2, 8, 1], dailyGoal: [1, 20, 1],
  };

  function toggleRow(field, label, hint) {
    const on = state.settings[field];
    return `<button class="row-btn" data-action="toggle" data-field="${field}" aria-pressed="${on}">
      <b>${esc(label)}${hint ? `<small class="row-hint">${esc(hint)}</small>` : ''}</b><span class="${on ? 'on' : ''}">${on ? 'On' : 'Off'}</span>
    </button>`;
  }

  function setupView() {
    const s = state.settings;
    const list = moves();
    const running = !!state.current;
    const moveRows = list.map((m, i) => `<div class="ex-row${m.enabled ? '' : ' off'}">
        <button class="check" data-action="toggle-move" data-id="${esc(m.id)}" data-v="${m.enabled ? 'full' : ''}" aria-pressed="${m.enabled}" aria-label="${esc(m.name)}: ${m.enabled ? 'on' : 'off'}">${TICK}</button>
        <div class="habit-body">
          <span class="habit-name">${esc(m.name)}</span>
          <div class="habit-sub">${esc(describeMove(m))}</div>
        </div>
        <div class="ex-move">
          <button data-action="move-up" data-id="${esc(m.id)}" aria-label="Move ${esc(m.name)} up" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button data-action="move-down" data-id="${esc(m.id)}" aria-label="Move ${esc(m.name)} down" ${i === list.length - 1 ? 'disabled' : ''}>↓</button>
        </div>
      </div>`).join('');

    return `<div class="date">Pomo</div><h1>Setup</h1>
      <h2 class="section-label">Timer</h2>
      <div class="list">
        ${stepRow('focusMin', 'Focus', s.focusMin, ' min', 5, 90)}
        ${stepRow('shortMin', 'Short break', s.shortMin, ' min', 1, 30)}
        ${stepRow('longMin', 'Long break', s.longMin, ' min', 5, 60)}
        ${stepRow('longEvery', 'Long break after', s.longEvery, ' blocks', 2, 8)}
        ${stepRow('dailyGoal', 'Daily goal', s.dailyGoal, ' blocks', 1, 20)}
      </div>
      ${running ? '<p class="hint">Changes start with the next block.</p>' : ''}
      <h2 class="section-label">Flow</h2>
      <div class="list">
        ${toggleRow('autoBreak', 'Start breaks automatically')}
        ${toggleRow('autoFocus', 'Start focus after a break', 'Off: you tap when you’re ready')}
        ${toggleRow('postureCue', 'Posture check halfway', 'A soft nudge in blocks of 15 min or more')}
      </div>
      <h2 class="section-label">Sound &amp; screen</h2>
      <div class="list">
        ${toggleRow('voice', 'Voice')}
        ${toggleRow('tones', 'Tones')}
        ${toggleRow('keepAwake', 'Keep screen awake', 'While a timer runs')}
      </div>
      <h2 class="section-label">Break moves</h2>
      <p class="hint">Breaks work through these in order, a little each time. About a minute in a short break, three in a long one. Turn off anything your clinician hasn’t okayed.</p>
      <div class="list" style="margin-top:10px">${moveRows}</div>
      <h2 class="section-label">Data</h2>
      <div class="list">
        <button class="row-btn" data-action="export"><b>Export backup</b><span>JSON</span></button>
        <button class="row-btn" data-action="import"><b>Restore backup</b><span>Replaces data</span></button>
        <button class="row-btn" data-action="csv"><b>Export log</b><span>CSV</span></button>
        <button class="row-btn" data-action="disclaimer"><b>Safety</b><span>Break moves</span></button>
      </div>
      <p class="hint" style="margin-top:20px">Everything stays on this phone. Nothing is sent anywhere.</p>`;
  }

  // ---------- main render ----------

  function render() {
    closeStale();
    const t = today();
    if (!state.settings.disclaimerAccepted && !sheet) {
      sheet = { type: 'disclaimer', first: true };
      app.inert = true;
      renderSheet();
    }
    const focused = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.field === 'label';
    app.innerHTML = top() + (view === 'timer' ? timerView(t) : view === 'history' ? historyView(t) : setupView());
    if (focused) {
      const input = app.querySelector('[data-field="label"]');
      if (input) { input.focus({ preventScroll: true }); input.setSelectionRange(input.value.length, input.value.length); }
    }
    document.body.classList.toggle('running', !!state.current);
  }

  function top() {
    const tab = (id, label) =>
      `<button class="tab" data-action="view" data-view="${id}" ${view === id ? 'aria-current="page"' : ''}>${label}</button>`;
    const p = state.current;
    const live = p && view !== 'timer'
      ? `<button class="live" data-action="view" data-view="timer">${esc(KIND_NAME[p.kind])} · <b id="left">${clock(E.remainingMs(p, Date.now()))}</b></button>`
      : '';
    return `<header class="top">
      <nav class="tabs" aria-label="Sections">${tab('timer', 'Timer')}${tab('history', 'History')}${tab('setup', 'Setup')}</nav>
      ${live}
    </header>`;
  }

  // ---------- sheets ----------

  let opener = null;

  function openSheet(s) {
    if (!sheet) opener = document.activeElement;
    sheet = s;
    document.body.style.overflow = 'hidden';
    app.inert = true;
    renderSheet();
    sheetEl.scrollTop = 0;
    const title = sheetEl.querySelector('#sheet-title');
    if (title) title.focus({ preventScroll: true });
  }

  function closeSheet() {
    sheet = null;
    renderSheet();
    app.inert = false;
    document.body.style.overflow = '';
    render();
    if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    opener = null;
  }

  function renderSheet() {
    if (!sheet) {
      sheetEl.hidden = true;
      sheetEl.innerHTML = '';
      return;
    }
    sheetEl.hidden = false;
    const html = { disclaimer: disclaimerSheet, day: daySheet }[sheet.type]();
    sheetEl.innerHTML = `<div class="sheet-inner">${html}</div>`;
  }

  function disclaimerSheet() {
    const first = sheet.first;
    return `${first ? '' : '<div class="sheet-top"><span></span><button class="done" data-action="close">Done</button></div>'}
      <div class="date" style="margin-top:${first ? 28 : 20}px">Pomo</div>
      <h1 id="sheet-title" tabindex="-1">Focus, then move</h1>
      <p class="lead">Every break starts with a short guided move for your neck, shoulders, eyes or wrists. A few things first:</p>
      <ul class="points">${DISCLAIMER.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
      <p class="lead">Your full routine stays in Neck PT. These are small top-ups between blocks.</p>
      ${first ? '<div class="form-actions"><button class="btn block" data-action="accept">Got it</button></div>' : ''}`;
  }

  function daySheet() {
    const d = sheet.id;
    const recs = state.log.filter((r) => r.date === d).sort((a, b) => a.startedAt - b.startedAt);
    const s = E.daySummary(state.log, d);
    const statusText = (r) => {
      if (r.kind === 'focus') {
        const bits = [r.status === 'completed' ? `${Math.round(r.actualSec / 60)} min` : `Ended at ${Math.round(r.actualSec / 60)} min`];
        if (r.distractions) bits.push(plural(r.distractions, 'distraction'));
        return bits.join(' · ');
      }
      const ms = { done: 'moved', partial: 'moved partly', skipped: 'skipped moves', missed: 'moves not seen', none: '' }[r.movesStatus];
      return [`${Math.round(r.actualSec / 60)} min`, ms].filter(Boolean).join(' · ');
    };
    const rows = recs.map((r) => `<p><span class="when">${esc(timeOf(r.startedAt))}</span>
        <b>${esc(r.kind === 'focus' ? (r.label || 'Focus') : KIND_NAME[r.kind])}${r.moves.length && r.kind !== 'focus' ? `<small>${esc(r.moves.join(', '))}</small>` : ''}</b>
        <span>${esc(statusText(r))}</span></p>`).join('');
    return `<div class="sheet-top"><span></span><button class="done" data-action="close">Done</button></div>
      <div class="date" style="margin-top:20px">${esc(d === today() ? 'Today' : shortDate(d))}</div>
      <h1 id="sheet-title" tabindex="-1">${plural(s.blocks, 'block')}</h1>
      <div class="stats three">
        <div class="stat"><b>${hours(s.focusSec)}</b><small>Focus</small></div>
        <div class="stat"><b>${s.breaks ? `${s.moved}/${s.breaks}` : '–'}</b><small>Breaks moved</small></div>
        <div class="stat"><b>${s.distractions}</b><small>Distractions</small></div>
      </div>
      <div class="results log">${rows || '<p>Nothing logged.</p>'}</div>`;
  }

  // ---------- events ----------

  function handle(el) {
    const s = state.settings;
    switch (el.dataset.action) {
      case 'view':
        view = el.dataset.view;
        render();
        window.scrollTo(0, 0);
        break;
      case 'start':
        begin(el.dataset.kind);
        break;
      case 'pause': pause(); break;
      case 'resume': resume(); break;
      case 'end-focus': endFocus(); break;
      case 'distracted': distracted(); break;
      case 'skip-moves': skipMoves(); break;
      case 'focus-now': focusNow(); break;
      case 'skip-break': skipBreak(); break;
      case 'pick-label':
        state.label = el.dataset.val;
        save();
        render();
        break;
      case 'disclaimer':
        openSheet({ type: 'disclaimer' });
        break;
      case 'accept':
        s.disclaimerAccepted = true;
        save();
        closeSheet();
        break;
      case 'close':
        if (sheet && sheet.type === 'disclaimer' && sheet.first) return;
        closeSheet();
        break;
      case 'day':
        openSheet({ type: 'day', id: el.dataset.id });
        break;
      case 'set-step': {
        const f = el.dataset.field;
        const [min, max] = LIMITS[f];
        s[f] = Math.min(max, Math.max(min, s[f] + Number(el.dataset.delta) * LIMITS[f][2]));
        save();
        render();
        break;
      }
      case 'toggle': {
        const f = el.dataset.field;
        s[f] = !s[f];
        save();
        if (f === 'keepAwake') { if (s[f]) lockScreen(); else releaseScreen(); }
        render();
        break;
      }
      case 'toggle-move': {
        const m = state.moves.find((x) => x.id === el.dataset.id);
        if (m) m.enabled = !m.enabled;
        save();
        render();
        break;
      }
      case 'move-up':
      case 'move-down': {
        const list = moves();
        const i = list.findIndex((x) => x.id === el.dataset.id);
        const j = el.dataset.action === 'move-up' ? i - 1 : i + 1;
        if (i < 0 || j < 0 || j >= list.length) break;
        [list[i], list[j]] = [list[j], list[i]];
        list.forEach((m, k) => (m.order = k));
        save();
        render();
        break;
      }
      case 'export':
        shareFile(JSON.stringify(state, null, 2), `pomo-backup-${today()}.json`, 'application/json', 'Pomo backup');
        break;
      case 'import':
        importData();
        break;
      case 'csv':
        if (!state.log.length) { toast('Nothing logged yet'); break; }
        shareFile(E.toCsv(state.log), `pomo-log-${today()}.csv`, 'text/csv', 'Pomo log');
        break;
    }
  }

  app.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-action]');
    if (el) handle(el);
  });
  sheetEl.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-action]');
    if (el) handle(el);
  });

  app.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.dataset.field === 'label') {
      state.label = t.value.slice(0, 80);
      save();
    }
  });

  app.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && ev.target.dataset.field === 'label') {
      ev.preventDefault();
      ev.target.blur();
      begin('focus');
    }
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && sheet && !(sheet.type === 'disclaimer' && sheet.first)) closeSheet();
    if (ev.key === ' ' && state.current && !sheet && view === 'timer' && ev.target === document.body) {
      ev.preventDefault();
      if (state.current.pausedAt == null) pause(); else resume();
    }
  });

  function checkDay() {
    const t = today();
    if (t !== lastToday) {
      lastToday = t;
      justEnded = null;
      render();
    }
  }

  // The timer keeps running in the background: you're probably working in
  // another app. Coming back catches up straight away.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { save(); return; }
    R.lastTick = Date.now();
    lockScreen();
    tick();
    render();
  });
  window.addEventListener('pagehide', save);

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // A break reloaded mid-move picks up at the right step.
  if (state.current && state.current.kind !== 'focus') {
    R.index = E.stepAt(steps(), state.current.moveMs / 1000).index;
  }
  render();
  startClock();
  tick();
  if (state.current && state.current.pausedAt == null) lockScreen();
})();
