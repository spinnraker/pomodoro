/*
 * Pomo engine.
 *
 * Pure logic, no DOM. A day is a run of phases: focus → break → focus …
 * Every fourth focus block (configurable) is followed by a long break.
 *
 * Phases are timed from wall-clock timestamps, so the timer keeps counting while
 * the app is in the background and survives a reload.
 *
 * Breaks carry a short guided move routine. It is compiled into a flat list of
 * timed steps (intro → get ready → hold → rest …), the same approach as Neck PT.
 * The app tracks how long the moves have actually been on screen and asks
 * stepAt() where that puts you.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PomoEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- dates (local calendar days as YYYY-MM-DD) ----------

  const pad = (n) => String(n).padStart(2, '0');

  function toKey(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function fromKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d, 12);
  }

  function addDays(key, n) {
    const d = fromKey(key);
    d.setDate(d.getDate() + n);
    return toKey(d);
  }

  /** Monday = 0 … Sunday = 6 */
  function weekday(key) {
    return (fromKey(key).getDay() + 6) % 7;
  }

  function weekOf(key) {
    const m = addDays(key, -weekday(key));
    return Array.from({ length: 7 }, (_, i) => addDays(m, i));
  }

  // ---------- seed data ----------

  // Desk-friendly moves that match a typical neck routine. No neck circles and
  // no tipping the head back.
  const SEED_MOVES = [
    { id: 'chin-tucks', name: 'Chin tucks', type: 'hold', reps: 5, holdSeconds: 5, restSeconds: 3, sides: 'none',
      cue: 'Glide your head straight back, make a double chin. Don’t tip up or down.' },
    { id: 'far-look', name: 'Look far away', type: 'hold', reps: 1, holdSeconds: 20, restSeconds: 0, sides: 'none',
      cue: 'Find something at least 6 metres away, out a window if you can. Let your eyes go soft.' },
    { id: 'scap-squeezes', name: 'Shoulder blade squeezes', type: 'hold', reps: 5, holdSeconds: 5, restSeconds: 3, sides: 'none',
      cue: 'Shoulder blades back and down, into your back pockets.' },
    { id: 'stand-reach', name: 'Stand and reach', type: 'hold', reps: 3, holdSeconds: 5, restSeconds: 3, sides: 'none',
      cue: 'Stand tall, arms overhead, ribs down. Keep your chin level; don’t look up.' },
    { id: 'upper-trap', name: 'Upper trap stretch', type: 'hold', reps: 1, holdSeconds: 20, restSeconds: 0, sides: 'each',
      cue: 'Sit on one hand, tilt your ear away from it. Mild stretch only.' },
    { id: 'wrists', name: 'Wrist stretch', type: 'hold', reps: 1, holdSeconds: 15, restSeconds: 0, sides: 'each',
      cue: 'Arm straight, palm up. Gently ease your fingers back with the other hand.' },
    { id: 'doorway-pec', name: 'Doorway chest stretch', type: 'hold', reps: 2, holdSeconds: 20, restSeconds: 5, sides: 'none',
      cue: 'Forearms on the door frame at shoulder height, step through.' },
    { id: 'breathe', name: 'Slow breaths', type: 'breath', reps: 4, holdSeconds: 0, restSeconds: 0, sides: 'none',
      cue: 'In through the nose, long slow breath out. Let your shoulders drop.' },
  ].map((m, i) => ({ ...m, enabled: true, order: i }));

  function defaultSettings() {
    return {
      disclaimerAccepted: false,
      focusMin: 25,
      shortMin: 5,
      longMin: 15,
      longEvery: 4,
      dailyGoal: 8,
      voice: true,
      tones: true,
      autoBreak: true,
      autoFocus: false,
      postureCue: true,
      keepAwake: true,
    };
  }

  function freshState(today) {
    return {
      moves: SEED_MOVES.map((m) => ({ ...m })),
      settings: defaultSettings(),
      log: [],
      current: null,
      next: 'focus',
      cycle: { date: today, count: 0 },
      rotation: 0,
      label: '',
    };
  }

  // ---------- validation ----------

  const KINDS = ['focus', 'short', 'long'];
  const MOVE_TYPES = ['hold', 'breath'];
  const SIDES = ['none', 'each'];
  const int = (v, min, max, d) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Math.round(Number(v)))) : d);
  const str = (v, d = '') => (typeof v === 'string' ? v : d);
  const isKey = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const MOVE_STATUS = ['done', 'partial', 'skipped', 'missed', 'none'];

  function cleanMove(m, i) {
    if (!m || typeof m !== 'object' || !str(m.name).trim()) return null;
    return {
      id: str(m.id) || `mv-${i}-${Math.random().toString(36).slice(2, 8)}`,
      name: str(m.name).trim(),
      type: MOVE_TYPES.includes(m.type) ? m.type : 'hold',
      reps: int(m.reps, 1, 20, 1),
      holdSeconds: int(m.holdSeconds, 0, 120, 5),
      restSeconds: int(m.restSeconds, 0, 60, 3),
      sides: SIDES.includes(m.sides) ? m.sides : 'none',
      cue: str(m.cue),
      enabled: m.enabled !== false,
      order: int(m.order, 0, 10000, i),
    };
  }

  function cleanCurrent(c) {
    if (!c || typeof c !== 'object' || !KINDS.includes(c.kind) || !isKey(c.date)) return null;
    const startedAt = Number(c.startedAt);
    if (!Number.isFinite(startedAt) || startedAt <= 0) return null;
    return {
      id: str(c.id) || `p-${startedAt.toString(36)}`,
      kind: c.kind,
      date: c.date,
      startedAt,
      durationSec: int(c.durationSec, 60, 4 * 3600, 25 * 60),
      pausedAt: c.pausedAt == null ? null : Number(c.pausedAt) || null,
      pausedMs: Math.max(0, Number(c.pausedMs) || 0),
      label: str(c.label).slice(0, 80),
      distractions: int(c.distractions, 0, 999, 0),
      moves: Array.isArray(c.moves) ? c.moves.map(cleanMove).filter(Boolean) : [],
      moveMs: Math.max(0, Number(c.moveMs) || 0),
      movesSkipped: !!c.movesSkipped,
      postureDone: !!c.postureDone,
    };
  }

  function cleanRecord(r) {
    if (!r || typeof r !== 'object' || !KINDS.includes(r.kind) || !isKey(r.date)) return null;
    return {
      id: str(r.id) || `r-${Math.random().toString(36).slice(2, 10)}`,
      kind: r.kind,
      date: r.date,
      startedAt: Number(r.startedAt) || 0,
      endedAt: Number(r.endedAt) || 0,
      plannedSec: int(r.plannedSec, 0, 4 * 3600, 0),
      actualSec: int(r.actualSec, 0, 24 * 3600, 0),
      status: r.status === 'completed' ? 'completed' : 'stopped',
      label: str(r.label).slice(0, 80),
      distractions: int(r.distractions, 0, 999, 0),
      moves: Array.isArray(r.moves) ? r.moves.filter((n) => typeof n === 'string') : [],
      movesStatus: MOVE_STATUS.includes(r.movesStatus) ? r.movesStatus : 'none',
    };
  }

  /** Validate loaded/imported data. Returns { state, dropped } where dropped counts unreadable records. */
  function normalize(raw, today) {
    const base = freshState(today);
    if (!raw || typeof raw !== 'object') return { state: base, dropped: 1 };
    let dropped = 0;
    const moves = Array.isArray(raw.moves)
      ? raw.moves.map((m, i) => cleanMove(m, i) || (dropped++, null)).filter(Boolean)
      : base.moves;
    moves.sort((a, b) => a.order - b.order).forEach((m, i) => (m.order = i));
    const s = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
    const d = defaultSettings();
    const settings = {
      disclaimerAccepted: !!s.disclaimerAccepted,
      focusMin: int(s.focusMin, 5, 90, d.focusMin),
      shortMin: int(s.shortMin, 1, 30, d.shortMin),
      longMin: int(s.longMin, 5, 60, d.longMin),
      longEvery: int(s.longEvery, 2, 8, d.longEvery),
      dailyGoal: int(s.dailyGoal, 1, 20, d.dailyGoal),
      voice: s.voice !== false,
      tones: s.tones !== false,
      autoBreak: s.autoBreak !== false,
      autoFocus: s.autoFocus === true,
      postureCue: s.postureCue !== false,
      keepAwake: s.keepAwake !== false,
    };
    const log = [];
    for (const r of Array.isArray(raw.log) ? raw.log : []) {
      const c = cleanRecord(r);
      if (c) log.push(c); else dropped++;
    }
    const current = raw.current ? cleanCurrent(raw.current) : null;
    if (raw.current && !current) dropped++;
    const cycle = raw.cycle && isKey(raw.cycle.date)
      ? { date: raw.cycle.date, count: int(raw.cycle.count, 0, 100, 0) }
      : base.cycle;
    return {
      state: {
        moves,
        settings,
        log,
        current,
        next: KINDS.includes(raw.next) ? raw.next : 'focus',
        cycle,
        rotation: int(raw.rotation, 0, 1e6, 0),
        label: str(raw.label).slice(0, 80),
      },
      dropped,
    };
  }

  // ---------- phase timing ----------

  function phaseSeconds(settings, kind) {
    const min = kind === 'focus' ? settings.focusMin : kind === 'long' ? settings.longMin : settings.shortMin;
    return min * 60;
  }

  /** Active time in a phase, excluding pauses. */
  function elapsedMs(p, now) {
    const pausedNow = p.pausedAt != null ? Math.max(0, now - p.pausedAt) : 0;
    return Math.max(0, now - p.startedAt - p.pausedMs - pausedNow);
  }

  function remainingMs(p, now) {
    return p.durationSec * 1000 - elapsedMs(p, now);
  }

  /** Wall-clock moment the phase ended (or will end, if it keeps running). */
  function endsAt(p) {
    return p.startedAt + p.pausedMs + p.durationSec * 1000;
  }

  /** Focus blocks done since the last long break, reset each day. */
  function cycleCount(state, today) {
    return state.cycle.date === today ? state.cycle.count : 0;
  }

  /** What comes after a phase of this kind, given focus blocks done in the current set. */
  function nextAfter(kind, count, settings) {
    if (kind !== 'focus') return 'focus';
    return count > 0 && count % settings.longEvery === 0 ? 'long' : 'short';
  }

  // ---------- break moves ----------

  const INTRO_SECONDS = 5;
  const READY_SECONDS = 3;
  const BREATH_IN = 4;
  const BREATH_OUT = 6;
  const SIDE_SWITCH = 5;

  /**
   * Step: { kind: 'intro'|'ready'|'hold'|'rest'|'in'|'out', mv (index into moves), duration (s),
   *         rep, of, side, label }
   */
  function moveSteps(moves) {
    const steps = [];
    moves.forEach((m, mv) => {
      const of = Math.max(1, m.reps);
      steps.push({ kind: 'intro', mv, duration: INTRO_SECONDS, rep: 0, of, side: null, label: mv === 0 ? 'First' : 'Next' });
      if (m.type === 'breath') {
        for (let rep = 1; rep <= of; rep++) {
          steps.push({ kind: 'in', mv, duration: BREATH_IN, rep, of, side: null, label: 'Breathe in' });
          steps.push({ kind: 'out', mv, duration: BREATH_OUT, rep, of, side: null, label: 'Breathe out' });
        }
        return;
      }
      const sides = m.sides === 'each' ? ['left', 'right'] : [null];
      sides.forEach((side, si) => {
        if (si > 0) steps.push({ kind: 'rest', mv, duration: SIDE_SWITCH, rep: 1, of, side, label: 'Switch sides' });
        else steps.push({ kind: 'ready', mv, duration: READY_SECONDS, rep: 1, of, side, label: 'Get ready' });
        for (let rep = 1; rep <= of; rep++) {
          steps.push({ kind: 'hold', mv, duration: Math.max(1, m.holdSeconds), rep, of, side, label: 'Hold' });
          if (rep < of && m.restSeconds > 0) steps.push({ kind: 'rest', mv, duration: m.restSeconds, rep: rep + 1, of, side, label: 'Relax' });
        }
      });
    });
    return steps;
  }

  function stepsSeconds(steps) {
    return steps.reduce((sum, s) => sum + s.duration, 0);
  }

  function moveSeconds(m) {
    return stepsSeconds(moveSteps([m]));
  }

  /** Where `elapsedSec` of guided time puts you: { index, remaining (s), done }. */
  function stepAt(steps, elapsedSec) {
    let t = Math.max(0, elapsedSec);
    for (let i = 0; i < steps.length; i++) {
      if (t < steps[i].duration) return { index: i, remaining: steps[i].duration - t, done: false };
      t -= steps[i].duration;
    }
    return { index: steps.length, remaining: 0, done: true };
  }

  const MOVE_TARGET = { short: 45, long: 150 };

  /**
   * Pick the moves for a break, rotating through the enabled list so each break is
   * different. Adds moves until the target time is reached, always at least one,
   * and leaves a little of the break free. Returns { moves, rotation }.
   */
  function planMoves(allMoves, rotation, kind, breakSec) {
    const list = allMoves.filter((m) => m.enabled).sort((a, b) => a.order - b.order);
    if (!list.length || kind === 'focus') return { moves: [], rotation };
    const target = Math.min(MOVE_TARGET[kind] || MOVE_TARGET.short, Math.max(20, breakSec - 30));
    const picked = [];
    let total = 0;
    let r = rotation;
    while (picked.length < list.length) {
      const m = list[r % list.length];
      const sec = moveSeconds(m);
      if (picked.length && total + sec > breakSec - 15) break;
      picked.push({ ...m });
      total += sec;
      r++;
      if (total >= target) break;
    }
    return { moves: picked, rotation: r % list.length };
  }

  function movesStatus(p, stepsTotalSec) {
    if (!p.moves.length) return 'none';
    if (p.movesSkipped) return 'skipped';
    if (p.moveMs >= stepsTotalSec * 1000 - 500) return 'done';
    return p.moveMs > 0 ? 'partial' : 'missed';
  }

  // ---------- phase lifecycle (mutates state) ----------

  function startPhase(state, kind, now, today, id) {
    const durationSec = phaseSeconds(state.settings, kind);
    let moves = [];
    if (kind !== 'focus') {
      const plan = planMoves(state.moves, state.rotation, kind, durationSec);
      moves = plan.moves;
      state.rotation = plan.rotation;
    }
    state.current = {
      id: id || `p-${now.toString(36)}`,
      kind,
      date: today,
      startedAt: now,
      durationSec,
      pausedAt: null,
      pausedMs: 0,
      label: kind === 'focus' ? state.label.trim() : '',
      distractions: 0,
      moves,
      moveMs: 0,
      movesSkipped: false,
      postureDone: false,
    };
    return state.current;
  }

  function pausePhase(p, now) {
    if (p && p.pausedAt == null) p.pausedAt = now;
  }

  function resumePhase(p, now) {
    if (p && p.pausedAt != null) {
      p.pausedMs += Math.max(0, now - p.pausedAt);
      p.pausedAt = null;
    }
  }

  /**
   * End the current phase at `at` (a timestamp: the scheduled end for a phase that
   * ran out, or now for one stopped early). Logs it, advances the cycle and sets
   * state.next. Returns the record.
   */
  function endPhase(state, at, status, today) {
    const p = state.current;
    if (!p) return null;
    if (p.pausedAt != null && at > p.pausedAt) resumePhase(p, at);
    const actualSec = Math.round(Math.min(p.durationSec * 1000, elapsedMs(p, at)) / 1000);
    const total = stepsSeconds(moveSteps(p.moves));
    const rec = {
      id: p.id,
      kind: p.kind,
      date: p.date,
      startedAt: p.startedAt,
      endedAt: at,
      plannedSec: p.durationSec,
      actualSec,
      status,
      label: p.label,
      distractions: p.distractions,
      moves: p.moves.map((m) => m.name),
      movesStatus: movesStatus(p, total),
    };
    state.log.push(rec);
    state.current = null;
    if (state.cycle.date !== today) state.cycle = { date: today, count: 0 };
    if (p.kind === 'focus') {
      if (status === 'completed') {
        state.cycle.count++;
        state.next = nextAfter('focus', state.cycle.count, state.settings);
      } else {
        state.next = 'focus';
      }
    } else {
      if (p.kind === 'long') state.cycle.count = 0;
      state.next = 'focus';
    }
    return rec;
  }

  /** A break started from the "next" suggestion still counts as the set's long break if it was due. */
  function upcoming(state, today) {
    if (state.cycle.date !== today && state.next !== 'focus') return 'focus';
    return state.next;
  }

  // ---------- stats ----------

  function daySummary(log, date) {
    const day = log.filter((r) => r.date === date);
    const focus = day.filter((r) => r.kind === 'focus');
    const blocks = focus.filter((r) => r.status === 'completed');
    const breaks = day.filter((r) => r.kind !== 'focus' && r.movesStatus !== 'none');
    return {
      blocks: blocks.length,
      focusSec: focus.reduce((a, r) => a + r.actualSec, 0),
      breaks: breaks.length,
      moved: breaks.filter((r) => r.movesStatus === 'done').length,
      distractions: focus.reduce((a, r) => a + r.distractions, 0),
    };
  }

  function rangeSummary(log, from, to) {
    const rs = log.filter((r) => r.date >= from && r.date <= to);
    const days = new Set(rs.map((r) => r.date));
    const sum = { blocks: 0, focusSec: 0, breaks: 0, moved: 0, distractions: 0, days: 0 };
    for (const d of days) {
      const s = daySummary(rs, d);
      for (const k of Object.keys(s)) sum[k] += s[k];
      if (s.focusSec > 0) sum.days++;
    }
    return sum;
  }

  /** Most recent distinct focus labels, newest first. */
  function recentLabels(log, n = 5) {
    const out = [];
    for (let i = log.length - 1; i >= 0 && out.length < n; i--) {
      const l = log[i].kind === 'focus' ? log[i].label.trim() : '';
      if (l && !out.some((x) => x.toLowerCase() === l.toLowerCase())) out.push(l);
    }
    return out;
  }

  // ---------- export ----------

  function csvCell(v) {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function toCsv(log) {
    const head = ['date', 'start_time', 'kind', 'status', 'planned_min', 'actual_min', 'label', 'distractions', 'moves', 'moves_status'];
    const rows = log.slice().sort((a, b) => a.startedAt - b.startedAt).map((r) => {
      const t = new Date(r.startedAt);
      return [
        r.date,
        `${pad(t.getHours())}:${pad(t.getMinutes())}`,
        r.kind,
        r.status,
        (r.plannedSec / 60).toFixed(1),
        (r.actualSec / 60).toFixed(1),
        r.label,
        r.kind === 'focus' ? r.distractions : '',
        r.moves.join('; '),
        r.movesStatus === 'none' ? '' : r.movesStatus,
      ].map(csvCell).join(',');
    });
    return [head.join(','), ...rows].join('\n') + '\n';
  }

  return {
    toKey, fromKey, addDays, weekday, weekOf,
    SEED_MOVES, defaultSettings, freshState, normalize, cleanMove,
    phaseSeconds, elapsedMs, remainingMs, endsAt, cycleCount, nextAfter, upcoming,
    INTRO_SECONDS, READY_SECONDS, moveSteps, stepsSeconds, moveSeconds, stepAt, planMoves, movesStatus,
    startPhase, pausePhase, resumePhase, endPhase,
    daySummary, rangeSummary, recentLabels, toCsv,
  };
});
