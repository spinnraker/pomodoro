const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine.js');

const T = '2026-11-07';
const MIN = 60000;
const byId = (id) => E.SEED_MOVES.find((m) => m.id === id);
const fresh = () => E.freshState(T);

test('date helpers are calendar-based', () => {
  assert.equal(E.addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(E.addDays('2026-03-08', 1), '2026-03-09'); // US DST
  assert.equal(E.weekday('2026-11-02'), 0); // Monday
  assert.deepEqual(E.weekOf('2026-11-08').slice(0, 2), ['2026-11-02', '2026-11-03']);
});

test('defaults are a classic pomodoro: 25 / 5 / 15, long break every 4', () => {
  const s = E.defaultSettings();
  assert.equal(E.phaseSeconds(s, 'focus'), 25 * 60);
  assert.equal(E.phaseSeconds(s, 'short'), 5 * 60);
  assert.equal(E.phaseSeconds(s, 'long'), 15 * 60);
  assert.equal(s.longEvery, 4);
});

test('seed moves skip neck circles and head tilts back', () => {
  for (const m of E.SEED_MOVES) assert.doesNotMatch(m.name + m.cue, /circle|roll your head|look up at the ceiling/i);
  assert.equal(E.SEED_MOVES[0].id, 'chin-tucks');
});

test('timer counts wall-clock time and excludes pauses', () => {
  const st = fresh();
  const p = E.startPhase(st, 'focus', 0, T);
  assert.equal(E.remainingMs(p, 10 * MIN), 15 * MIN);
  E.pausePhase(p, 10 * MIN);
  assert.equal(E.remainingMs(p, 20 * MIN), 15 * MIN); // paused: frozen
  E.resumePhase(p, 20 * MIN);
  assert.equal(E.remainingMs(p, 25 * MIN), 10 * MIN);
  assert.equal(E.endsAt(p), 35 * MIN);
});

test('cycle: short breaks, then a long break after every 4th focus block', () => {
  const st = fresh();
  const seen = [];
  let now = 0;
  for (let i = 0; i < 9; i++) {
    const kind = E.upcoming(st, T);
    seen.push(kind);
    const p = E.startPhase(st, kind, now, T, `p${i}`);
    now = E.endsAt(p);
    E.endPhase(st, now, 'completed', T);
  }
  assert.deepEqual(seen, ['focus', 'short', 'focus', 'short', 'focus', 'short', 'focus', 'long', 'focus']);
  assert.equal(st.cycle.count, 1); // reset by the long break, then one more block
});

test('stopping focus early logs the minutes but not a block, and offers focus again', () => {
  const st = fresh();
  E.startPhase(st, 'focus', 0, T);
  const r = E.endPhase(st, 12 * MIN, 'stopped', T);
  assert.equal(r.actualSec, 12 * 60);
  assert.equal(r.status, 'stopped');
  assert.equal(st.next, 'focus');
  assert.equal(st.cycle.count, 0);
  assert.equal(E.daySummary(st.log, T).blocks, 0);
  assert.equal(E.daySummary(st.log, T).focusSec, 12 * 60);
});

test('ending while paused counts only active time', () => {
  const st = fresh();
  const p = E.startPhase(st, 'focus', 0, T);
  E.pausePhase(p, 5 * MIN);
  const r = E.endPhase(st, 30 * MIN, 'stopped', T);
  assert.equal(r.actualSec, 5 * 60);
});

test('a finished phase never logs more than its planned length', () => {
  const st = fresh();
  E.startPhase(st, 'focus', 0, T);
  const r = E.endPhase(st, 90 * MIN, 'completed', T);
  assert.equal(r.actualSec, 25 * 60);
});

test('cycle count resets on a new day', () => {
  const st = fresh();
  st.cycle = { date: '2026-11-06', count: 3 };
  assert.equal(E.cycleCount(st, T), 0);
  st.next = 'long';
  assert.equal(E.upcoming(st, T), 'focus');
  E.startPhase(st, 'focus', 0, T);
  E.endPhase(st, 25 * MIN, 'completed', T);
  assert.deepEqual(st.cycle, { date: T, count: 1 });
  assert.equal(st.next, 'short');
});

test('hold moves: intro, get ready, holds with rests between, no trailing rest', () => {
  const steps = E.moveSteps([byId('chin-tucks')]);
  assert.deepEqual(steps.slice(0, 4).map((s) => s.kind), ['intro', 'ready', 'hold', 'rest']);
  assert.equal(steps.filter((s) => s.kind === 'hold').length, 5);
  assert.equal(steps.filter((s) => s.kind === 'rest').length, 4);
  assert.equal(steps[steps.length - 1].kind, 'hold');
  assert.equal(E.moveSeconds(byId('chin-tucks')), 5 + 3 + 25 + 12);
});

test('each-side moves do left, switch, then right', () => {
  const steps = E.moveSteps([byId('upper-trap')]);
  assert.deepEqual(steps.map((s) => s.kind), ['intro', 'ready', 'hold', 'rest', 'hold']);
  assert.deepEqual(steps.filter((s) => s.kind === 'hold').map((s) => s.side), ['left', 'right']);
  assert.equal(steps[3].label, 'Switch sides');
});

test('breathing alternates in and out', () => {
  const steps = E.moveSteps([byId('breathe')]).slice(1);
  assert.equal(steps.length, 8);
  assert.deepEqual(steps.slice(0, 2).map((s) => [s.kind, s.duration]), [['in', 4], ['out', 6]]);
});

test('stepAt maps guided time onto steps', () => {
  const steps = E.moveSteps([byId('chin-tucks')]);
  assert.deepEqual(E.stepAt(steps, 0), { index: 0, remaining: 5, done: false });
  assert.equal(E.stepAt(steps, 6).index, 1); // get ready
  assert.equal(E.stepAt(steps, 8).index, 2); // first hold
  assert.equal(E.stepAt(steps, 9.5).remaining, 3.5);
  assert.equal(E.stepAt(steps, 999).done, true);
});

test('short breaks get about a minute of moves, rotating each time', () => {
  const st = fresh();
  const a = E.planMoves(st.moves, 0, 'short', 300);
  assert.deepEqual(a.moves.map((m) => m.id), ['chin-tucks']);
  const b = E.planMoves(st.moves, a.rotation, 'short', 300);
  assert.deepEqual(b.moves.map((m) => m.id), ['far-look', 'scap-squeezes']);
  const total = E.stepsSeconds(E.moveSteps(b.moves));
  assert.ok(total >= 45 && total <= 90, `total ${total}`);
});

test('long breaks get a few minutes of moves', () => {
  const st = fresh();
  const plan = E.planMoves(st.moves, 0, 'long', 900);
  const total = E.stepsSeconds(E.moveSteps(plan.moves));
  assert.ok(plan.moves.length >= 3);
  assert.ok(total >= 150 && total < 240, `total ${total}`);
});

test('planMoves skips disabled moves and wraps around', () => {
  const moves = fresh().moves.map((m) => ({ ...m, enabled: ['wrists', 'chin-tucks'].includes(m.id) }));
  const a = E.planMoves(moves, 1, 'short', 300);
  assert.deepEqual(a.moves.map((m) => m.id), ['wrists', 'chin-tucks']); // wrists alone is under 45 s
  assert.equal(E.planMoves(moves, 0, 'short', 300).moves[0].id, 'chin-tucks');
  assert.deepEqual(E.planMoves(moves.map((m) => ({ ...m, enabled: false })), 0, 'short', 300).moves, []);
});

test('a very short break still gets one move, and never overruns much', () => {
  const plan = E.planMoves(fresh().moves, 0, 'short', 60);
  assert.equal(plan.moves.length, 1);
});

test('break records say whether the moves were done', () => {
  const st = fresh();
  st.next = 'short';
  let p = E.startPhase(st, 'short', 0, T);
  const total = E.stepsSeconds(E.moveSteps(p.moves));
  p.moveMs = total * 1000;
  assert.equal(E.endPhase(st, 5 * MIN, 'completed', T).movesStatus, 'done');
  p = E.startPhase(st, 'short', 0, T);
  p.moveMs = 10000;
  assert.equal(E.endPhase(st, 5 * MIN, 'completed', T).movesStatus, 'partial');
  p = E.startPhase(st, 'short', 0, T);
  p.movesSkipped = true;
  assert.equal(E.endPhase(st, 5 * MIN, 'completed', T).movesStatus, 'skipped');
  E.startPhase(st, 'short', 0, T);
  assert.equal(E.endPhase(st, 5 * MIN, 'completed', T).movesStatus, 'missed');
  const sum = E.daySummary(st.log, T);
  assert.equal(sum.breaks, 4);
  assert.equal(sum.moved, 1);
});

test('focus records keep the label and distractions', () => {
  const st = fresh();
  st.label = '  Thesis chapter 2 ';
  const p = E.startPhase(st, 'focus', 0, T);
  p.distractions = 3;
  const r = E.endPhase(st, 25 * MIN, 'completed', T);
  assert.equal(r.label, 'Thesis chapter 2');
  assert.equal(E.daySummary(st.log, T).distractions, 3);
  assert.deepEqual(E.recentLabels(st.log), ['Thesis chapter 2']);
});

test('recent labels are distinct and newest first', () => {
  const log = ['A', 'b', 'B', '', 'c'].map((label, i) => ({ kind: 'focus', label, startedAt: i }));
  assert.deepEqual(E.recentLabels(log), ['c', 'B', 'A']);
});

test('rangeSummary adds up days', () => {
  const st = fresh();
  for (const [d, n] of [['2026-11-05', 2], ['2026-11-06', 0], [T, 3]]) {
    for (let i = 0; i < n; i++) { E.startPhase(st, 'focus', 0, d); E.endPhase(st, 25 * MIN, 'completed', d); }
  }
  const sum = E.rangeSummary(st.log, '2026-11-01', T);
  assert.equal(sum.blocks, 5);
  assert.equal(sum.days, 2);
  assert.equal(sum.focusSec, 5 * 25 * 60);
});

test('normalize repairs bad data and counts what it dropped', () => {
  const { state, dropped } = E.normalize({
    settings: { focusMin: 999, shortMin: 'x', autoFocus: true },
    moves: [{ name: 'Custom', reps: 3, holdSeconds: 10 }, { nope: 1 }],
    log: [{ kind: 'focus', date: T, actualSec: 60 }, { kind: 'nap', date: T }],
    current: { kind: 'focus', date: T, startedAt: 1000, durationSec: 1500 },
    next: 'long',
  }, T);
  assert.equal(dropped, 2);
  assert.equal(state.settings.focusMin, 90);
  assert.equal(state.settings.shortMin, 5);
  assert.equal(state.settings.autoFocus, true);
  assert.equal(state.moves.length, 1);
  assert.equal(state.log.length, 1);
  assert.equal(state.current.durationSec, 1500);
  assert.equal(state.next, 'long');
});

test('normalize of garbage gives a fresh state', () => {
  const { state, dropped } = E.normalize('nope', T);
  assert.equal(dropped, 1);
  assert.equal(state.moves.length, E.SEED_MOVES.length);
});

test('csv export quotes labels with commas', () => {
  const st = fresh();
  st.label = 'Email, admin';
  E.startPhase(st, 'focus', new Date(2026, 10, 7, 9, 5).getTime(), T);
  E.endPhase(st, new Date(2026, 10, 7, 9, 30).getTime(), 'completed', T);
  const csv = E.toCsv(st.log).trim().split('\n');
  assert.equal(csv[0].split(',')[0], 'date');
  assert.equal(csv[1], '2026-11-07,09:05,focus,completed,25.0,25.0,"Email, admin",0,,');
});
