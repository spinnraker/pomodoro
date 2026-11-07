# Pomo

A focus timer whose breaks get you moving. Each break starts with a short guided move for your neck, shoulders, eyes or wrists, run the same way as Neck PT. Same look and setup as Habito, Hiyoko and Neck PT: black and white, no account, works offline.

## Use it

```sh
npm start          # http://localhost:8080
npm test           # engine tests
```

No dependencies and no build step. To put it on your iPhone, host the folder on any static host (GitHub Pages works: Settings → Pages → deploy from this branch), open it in Safari, then Share → Add to Home Screen. It runs full-screen and offline. Data stays on the device; use Setup → Export backup to keep a copy.

## How a day goes

1. Type what the block is for (optional; recent labels come back as one-tap chips) and tap **Start focus**. Default is 25 minutes.
2. While you work: **Distracted +1** when you catch yourself drifting, then go back to it. Halfway through, a soft double tone and "Posture check: chin back, shoulders down."
3. When the block ends, a chime, and the break starts on its own: "Stand up if you can. First, chin tucks." The move runs like a PT session: name and cue on screen, a soft tone to start each hold, quiet ticks for the last 3 seconds, a gentle two-note tone to release.
4. When the moves are done, the rest of the break is yours. Look away from the screen.
5. When the break's over, a chime. Tap **Start focus** when you're ready (or turn on auto-start in Setup).

Every 4th block (configurable) is followed by a long break with about 3 minutes of moves instead of 1.

## Why it's built this way

| Rule | Why |
|---|---|
| **The break starts with a move, not your phone.** | A break spent scrolling isn't rest for your neck or eyes. Starting the break with something to do beats "remember to stretch". |
| **Moves rotate.** Each break picks up where the last one left off. | Variety without choosing. Over a day you cover neck, shoulders, chest, eyes, wrists and breathing. |
| **About a minute in short breaks, three in long ones.** | Small enough that you won't skip it. |
| **Moves only count while they're on screen.** | "Breaks moved" in History means you did them, not that the timer ran out. Skipping is allowed and logged as skipped, never punished. |
| **Look far away is in the rotation.** | Focusing at a distance for 20 seconds relaxes the eye muscles that hold near focus all block. |
| **Distracted +1 instead of pausing.** | Noticing the drift is the skill. Counting it, without stopping the clock, shows you how you're trending per block. |
| **Posture check halfway.** | Head drifts forward slowly over a block. One cue in the middle catches it. |
| **Stopping early still counts the minutes.** | The block doesn't count toward your goal, but the work you did isn't thrown away. |
| **Daily goal fills the week dots.** Full dot = goal met, half = at least one block. | Same forgiving week view as Habito. |

## Break moves

Chin tucks · Look far away · Shoulder blade squeezes · Stand and reach · Upper trap stretch · Wrist stretch · Doorway chest stretch · Slow breaths.

All are gentle and desk-friendly, with no neck circles or tipping the head back. Turn off or reorder any of them in Setup. Your full routine stays in Neck PT; these are small top-ups.

## What a home-screen web app can't do

- **No notification when a block ends while you're in another app.** iPhone home-screen web apps can't schedule notifications. The timer keeps counting in the background; when you come back it shows "Focus ended at 10:42" and logs it correctly, but it won't start the break automatically, because you might not be there. Easiest setup: leave Pomo open on the desk (it keeps the screen awake while a timer runs).
- **Voice and tones** use the Web Speech and Web Audio APIs. If you hear nothing, check the ringer switch and volume.
- **Haptics**: iPhone Safari has no vibration API, so cues are tones and voice. Android phones also vibrate.

## How it works

- `engine.js` is pure logic with tests. Phases are wall-clock timestamps (start, pause total), so the timer survives backgrounding and reloads. Break moves compile into a flat list of timed steps (intro → get ready → hold → rest …), the same approach as Neck PT; `stepAt()` maps on-screen time onto that list.
- `app.js` handles the UI and saves to `localStorage` (`pomo:v1`). Saved and imported data is checked when it loads. Anything that can't be read is kept under a `pomo:v1:unreadable:*` key instead of being overwritten.
- `sw.js` caches the app for offline use. Bump `CACHE` when you ship changes.

Break moves are gentle range only. Stop any move that hurts or makes arm tingling or numbness worse, and check with your clinician. This app isn't medical advice.
