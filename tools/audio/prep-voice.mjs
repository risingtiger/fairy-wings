// Gets a raw recorded voice line (an ElevenLabs export, a phone recording, ...) ready for the game.
//
// Trims the silence off both ends (keeping a short breath of it so nothing starts or stops abruptly),
// mixes down to mono 44.1 kHz, and loudness-normalises every line to the same level (measures its EBU R128
// integrated loudness, applies one fixed gain so the voice keeps its natural dynamics, and a limiter just
// catches any peak that gain pushes over the ceiling), so lines from different takes, voices and tools
// all sit alike, clearly above the music and sound effects. Writes a 128 kbps mp3 (plays in
// Chrome and Safari) named after the line's id; register it in src/game/voiceovers.ts.
//
// Writes assets/voice/<id>.mp3. Needs ffmpeg on the PATH (with libmp3lame).
//
// Usage: node tools/audio/prep-voice.mjs <raw-file> <line-id> [<raw-file> <line-id> ...]
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Target loudness (LUFS), peak ceiling (dBFS), what counts as silence, and how much of it to keep. */
const LOUDNESS = -16, PEAK = -1.5, SILENCE_DB = -50, KEEP = 0.05;
const OUT = 'assets/voice';
// only catches the odd peak the gain pushes over the ceiling; leaves everything else alone
const limit = `alimiter=limit=${10 ** (PEAK / 20)}:level=false:attack=2:release=50`;

const args = process.argv.slice(2);
if (args.length === 0 || args.length % 2) { console.error('usage: node tools/audio/prep-voice.mjs <raw-file> <line-id> [...]'); process.exit(1); }
const run = (cmd, a) => execFileSync(cmd, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
// ffmpeg reports its measurements on stderr
const measure = (file, filter) => spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', filter, '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
const seconds = (file) => Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]));
/** Integrated loudness (LUFS) of `file`, after any `filters`. */
const lufs = (file, filters) => Number(/I:\s+(-?[\d.]+) LUFS/.exec(measure(file, [filters, 'ebur128'].filter(Boolean).join(',')).split('Summary:')[1] ?? '')?.[1]);

fs.mkdirSync(OUT, { recursive: true });
for (let i = 0; i < args.length; i += 2) {
  const src = args[i], id = args[i + 1];
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) throw new Error(`line id "${id}" should be kebab-case, e.g. elf-hello-crystal`);
  const out = path.join(OUT, `${id}.mp3`);
  // silenceremove only trims the start; the end is trimmed on the reversed signal. Tiny fades against clicks.
  const trim = `silenceremove=start_periods=1:start_threshold=${SILENCE_DB}dB:start_silence=${KEEP}`;
  const prep = `aformat=channel_layouts=mono,${trim},areverse,${trim},afade=t=in:d=0.005,areverse,afade=t=in:d=0.005`;
  // measure the trimmed line, then apply the gain that brings it to the target; the mp3 encoder's
  // lowpass takes a little off (K-weighting counts the highs), so measure the result and correct once
  const before = lufs(src, prep);
  if (!Number.isFinite(before)) throw new Error(`could not measure ${src}`);
  const encode = (db) => run('ffmpeg', ['-v', 'error', '-y', '-i', src, '-af', `${prep},volume=${db.toFixed(2)}dB,${limit}`, '-ar', '44100', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '128k', out]);
  const db = LOUDNESS - before;
  encode(db);
  const miss = LOUDNESS - lufs(out);
  if (Math.abs(miss) > 0.1) encode(db + miss);
  console.log(`${out}: ${seconds(src).toFixed(2)} s, ${lufs(src)} LUFS -> ${seconds(out).toFixed(2)} s, ${lufs(out)} LUFS`);
}
