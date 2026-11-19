// A scene as one video file: its stills with their slow camera moves (grey cards where a shot has no picture), the subtitles, and the mixed sound.
// The same picture and sound rules as the animatic player in ui/app.js (motion, subtitle timing, layers, fades), done with ffmpeg on this computer.
import { writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";

let W = 1280, H = 720; const FPS = 24; // 1920 x 1080 when the scene has video clips (or when asked), else 1280 x 720
export const DUCK = { to: 0.35, before: 0.3, after: 0.4 }; // music under a voice: down to 35 %, easing over these seconds
const run = (args, minutes = 20) => new Promise((ok, bad) => execFile("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { timeout: minutes * 60000, maxBuffer: 1 << 24 }, (e, _o, err) => (e ? bad(new Error("ffmpeg: " + String(err || e.message).trim().split("\n").slice(-2).join(" "))) : ok())));

/** The camera move of a shot as the player shows it: a slow push, pull, pan or tilt over the still. */
export function motion(s) {
  const m = (s.camera && s.camera.motion) || {}, txt = String((s.camera && s.camera.move) || "").toLowerCase(), a = +m.amount || 0.1;
  const kind = m.kind || (/push|dolly in|zoom in|crane down|punch/.test(txt) ? "push" : /pull|zoom out|dolly out|crane up/.test(txt) ? "pull" : /pan|track|truck|arc|orbit/.test(txt) ? "pan" : /tilt/.test(txt) ? "tilt" : "still");
  const dir = m.dir || (/left/.test(txt) ? "left" : /right/.test(txt) ? "right" : /up/.test(txt) ? "up" : /down/.test(txt) ? "down" : kind === "pull" ? "out" : "in");
  return { kind, dir, a };
}
function zoompan(s, n) { // k runs 0 to 1 over the shot's frames
  const { kind, dir, a } = motion(s), k = n > 1 ? `(on/${n - 1})` : "0", sg = dir === "left" || dir === "up" ? 1 : -1, d = `((${k}-0.5)*${a}*${sg})`;
  const z = kind === "push" ? `1.04+${a}*${k}` : kind === "pull" ? `1.04+${a}*(1-${k})` : kind === "pan" || kind === "tilt" ? String(1.08 + a / 2) : "1.04";
  const x = `iw/2-iw/zoom/2${kind === "pan" ? `-${d}*iw` : ""}`, y = `ih/2-ih/zoom/2${kind === "tilt" ? `-${d}*ih` : ""}`;
  return `zoompan=z='${z}':x='${x}':y='${y}':d=1:s=${W}x${H}:fps=${FPS}`;
}
const fadeLen = (v, dur) => Math.max(0.1, Math.min(+v > 0 ? +v : 0.5, 3, Math.max(0.1, dur * 0.9)));
const COL = { black: "black", white: "white" };
/** A shot's fade from or to black or white, as ffmpeg filters on its piece. */
function fades(s, secs, i) { let f = "";
  if (COL[s.tin]) f += `,fade=t=in:st=0:d=${fadeLen(s.tin_dur, secs).toFixed(3)}:color=${COL[s.tin]}`;
  if (COL[s.tout]) { const d = fadeLen(s.tout_dur, secs); f += `,fade=t=out:st=${Math.max(0, secs - d).toFixed(3)}:d=${d.toFixed(3)}:color=${COL[s.tout]}`; }
  return f; }
/** The colour grade as ffmpeg filters (the same sums as the player's filter: contrast around mid grey, then the colour sums). */
export function gradeFilter(g) { if (!g) return ""; const off = (127.5 * (1 - g.k)).toFixed(3), lut = `clip(val*${g.k}+${off},0,255)`.replace(/\+-/, "-"), n = ["r", "g", "b"];
  return `format=gbrp,lutrgb=r='${lut}':g='${lut}':b='${lut}',colorchannelmixer=${g.m.map((row, i) => row.map((v, j) => `${n[i]}${n[j]}=${v}`).join(":")).join(":")},format=yuv420p,`; }
const stamp = (t) => { const c = Math.max(0, Math.round(t * 100)), h = Math.floor(c / 360000), m = Math.floor(c / 6000) % 60, s = Math.floor(c / 100) % 60; return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c % 100).padStart(2, "0")}`; };
const assText = (t) => String(t == null ? "" : t).replace(/[{}\\]/g, " ").replace(/\s+/g, " ").trim();

/** opts: { dir (scene folder), plan, sound, file(url) -> path on disk, out (mp4 path), say(msg) } */
export async function exportScene({ dir, plan, sound, file, out, say = () => {}, subtitles = true, size, grade }) {
  const shots = (plan.shots || []).filter((s) => (+s.duration || 0) > 0); if (!shots.length) throw new Error("the scene has no shots with a length");
  const clipOf = (s) => { const f = s.clip ? file(s.clip) : ""; return f && existsSync(f) ? f : ""; };
  [W, H] = size === "hd" || (size !== "sd" && shots.some(clipOf)) ? [1920, 1080] : [1280, 720];
  const work = join(dir, "export", ".work"); await rm(work, { recursive: true, force: true }); await mkdir(work, { recursive: true });
  const starts = []; let total = 0; for (const s of shots) { starts.push(total); total += +s.duration; }
  const frameAt = (t) => Math.round(t * FPS), lineOf = (id) => (plan.dialogue || []).find((d) => d.line_id === id);
  // 1. one silent piece per shot
  const list = [], pieces = [];
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i], n = Math.max(1, frameAt(starts[i] + +s.duration) - frameAt(starts[i])), piece = join(work, `p${String(i).padStart(3, "0")}.mp4`), pic = s.still ? file(s.still) : "";
    say(`Picture ${i + 1} of ${shots.length}`);
    const enc = ["-frames:v", String(n), "-r", String(FPS), "-c:v", "libx264", "-preset", "veryfast", "-crf", "17", "-pix_fmt", "yuv420p", "-an", piece];
    const clip = clipOf(s), secs = n / FPS, fd = fades(s, secs, i);
    if (clip) await run(["-ss", String(+s.clip_from || 0), "-i", clip, "-vf", `${+s.clip_speed > 0 && +s.clip_speed !== 1 ? `setpts=PTS/${+s.clip_speed},` : ""}fps=${FPS},scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,tpad=stop_mode=clone:stop_duration=${Math.ceil(+s.duration) + 1},format=yuv420p${fd}`, ...enc]); // a clip shorter than its shot holds on its last picture
    else if (pic && existsSync(pic)) await run(["-loop", "1", "-framerate", String(FPS), "-i", pic, "-vf", `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},setsar=1,${zoompan(s, n)},format=yuv420p${fd}`, ...enc]);
    else await run(["-f", "lavfi", "-i", `color=c=${s.title ? (s.title_bg === "white" ? "0xf4f1ea" : "0x000000") : "0x30333a"}:s=${W}x${H}:r=${FPS}`, "-vf", `format=yuv420p${fd}`, ...enc]);
    pieces.push({ piece, n });
  }
  // a cross-fade into a shot: the shot before it carries on (its clip if there is more of it, else its last picture) and melts into this one; no shot changes length
  for (let i = 1; i < shots.length; i++) { const s = shots[i], p = shots[i - 1]; if (s.tin !== "cross") continue;
    const d = fadeLen(s.tin_dur, +s.duration), nd = Math.max(2, Math.round(d * FPS)), tail = join(work, `t${String(i).padStart(3, "0")}.mp4`), mixed = join(work, `x${String(i).padStart(3, "0")}.mp4`), pc = clipOf(p), after = (+p.clip_from || 0) + +p.duration * (+p.clip_speed > 0 ? +p.clip_speed : 1);
    const enc = (k, f) => ["-frames:v", String(k), "-r", String(FPS), "-c:v", "libx264", "-preset", "veryfast", "-crf", "17", "-pix_fmt", "yuv420p", "-an", f];
    say(`Cross-fade into picture ${i + 1}`);
    if (pc && !(+p.clip_speed > 0 && +p.clip_speed !== 1) && (+p.clip_dur || 0) - after >= d) await run(["-ss", String(after), "-i", pc, "-vf", `fps=${FPS},scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,format=yuv420p`, ...enc(nd, tail)]);
    else { const last = join(work, `l${i}.png`); await run(["-sseof", "-0.2", "-i", pieces[i - 1].piece, "-update", "1", "-q:v", "1", last]); await run(["-loop", "1", "-framerate", String(FPS), "-i", last, "-vf", "format=yuv420p", ...enc(nd, tail)]); }
    await run(["-i", tail, "-i", pieces[i].piece, "-filter_complex", `[0:v]settb=AVTB,fps=${FPS}[a];[1:v]settb=AVTB,fps=${FPS}[b];[a][b]xfade=transition=fade:duration=${(nd / FPS).toFixed(4)}:offset=0,format=yuv420p[v]`, "-map", "[v]", ...enc(pieces[i].n, mixed)]);
    pieces[i].piece = mixed; }
  for (const x of pieces) list.push(`file '${x.piece.replace(/'/g, "'\\''")}'`);
  await writeFile(join(work, "list.txt"), list.join("\n") + "\n");
  // 2. the words on screen: subtitles (a shot's lines share its time by word count), and for a shot with no picture its framing and action
  const ev = [];
  shots.forEach((s, i) => {
    const a = starts[i], d = +s.duration, cam = s.camera || {};
    if (s.title || s.title_sub) { const dark = !clipOf(s) && !(s.still && existsSync(file(s.still))) && s.title_bg === "white", fx = `{\\fad(${Math.round(Math.min(400, d * 250))},${Math.round(Math.min(400, d * 250))})${dark ? "\\c&H201C18&\\3c&HEAF1F4&" : ""}}`, low = s.title_pos === "low";
      ev.push(`Dialogue: 2,${stamp(a)},${stamp(a + d)},${low ? "TitleLow" : "Title"},,0,0,0,,${fx}${s.title ? `{\\b1\\fs${low ? 70 : 88}}${assText(s.title)}` : ""}${s.title && s.title_sub ? "\\N" : ""}${s.title_sub ? `{\\b0\\fs${low ? 34 : 40}}${assText(s.title_sub)}` : ""}`); }
    else if (!clipOf(s) && !(s.still && existsSync(file(s.still)))) { ev.push(`Dialogue: 0,${stamp(a)},${stamp(a + d)},CardHead,,0,0,0,,${assText(cam.framing || "Shot " + s.shot_id)}`); if (s.action) ev.push(`Dialogue: 0,${stamp(a)},${stamp(a + d)},CardText,,0,0,0,,${assText(s.action)}`); }
    const ls = subtitles ? (s.lines || []).map(lineOf).filter(Boolean) : []; if (!ls.length) return;
    const w = ls.map((l) => Math.max(1, String(l.text).split(/\s+/).length)), sum = w.reduce((x, y) => x + y, 0); let acc = 0;
    ls.forEach((l, j) => { const from = a + (acc / sum) * d; acc += w[j]; const to = a + (acc / sum) * d;
      ev.push(`Dialogue: 1,${stamp(from)},${stamp(to)},${l.mouth === "off" ? "SubOff" : "Sub"},,0,0,0,,${l.speaker ? `{\\c&H8AD9FF&}${assText(l.speaker)}:{\\c&HFFFFFF&} ` : ""}${assText(l.text)}`); });
  });
  const style = (name, size, colour, bold, italic, align, mv) => `Style: ${name},DejaVu Sans,${size},${colour},&H000000FF,&H00000000,&H96000000,${bold},${italic},0,0,100,100,0,0,1,2.2,1,${align},90,90,${mv},1`;
  await writeFile(join(work, "words.ass"), ["[Script Info]", "ScriptType: v4.00+", "PlayResX: 1280", "PlayResY: 720", "WrapStyle: 0", "ScaledBorderAndShadow: yes", "", "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    style("Sub", 36, "&H00FFFFFF", -1, 0, 2, 40), style("SubOff", 36, "&H00FFFFFF", -1, -1, 2, 40), style("CardHead", 34, "&H00FFFFFF", -1, 0, 8, 90), style("CardText", 28, "&H00D6CEC9", 0, 0, 8, 190),
    style("Title", 88, "&H00FFFFFF", 0, 0, 5, 0), style("TitleLow", 70, "&H00FFFFFF", 0, 0, 2, 70), "",
    "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text", ...ev, ""].join("\n"));
  // 3. the sound: every clip that would be heard, at its place, its layer's and its own loudness, with its fades
  const m = {}; shots.forEach((s, i) => { m[s.shot_id] = starts[i]; });
  const tracks = Array.isArray(sound && sound.tracks) ? sound.tracks : [], solo = tracks.some((t) => t.solo), ins = [], parts = [];
  const heard = (t) => t && !t.mute && (!solo || t.solo), place = (c) => { const at = Math.max(0, (c.shot && m[c.shot] != null ? m[c.shot] : 0) + (+c.offset || 0)), from = +c.from || 0; return [at, at + Math.max(0.05, +c.len > 0 ? +c.len : Math.max(0, (+c.dur || 0) - from) || 1)]; };
  // when anyone speaks: a music clip set to dip goes down to 35 % from just before a voice clip until just after it (the same rule as the player)
  const talk = []; for (const iv of (Array.isArray(sound && sound.clips) ? sound.clips : []).filter((c) => { const t = tracks.find((x) => x.id === c.track); return !c.off && t && t.kind === "voice" && heard(t); }).map(place).sort((a, b) => a[0] - b[0])) { const last = talk[talk.length - 1]; if (last && iv[0] <= last[1] + 0.7) last[1] = Math.max(last[1], iv[1]); else talk.push(iv.slice()); }
  const dip = talk.length ? `,volume=eval=frame:volume='${talk.map(([s, e]) => `if(lt(t,${(s - DUCK.before).toFixed(3)})+gt(t,${(e + DUCK.after).toFixed(3)}),1,if(lt(t,${s.toFixed(3)}),1-(t-${(s - DUCK.before).toFixed(3)})/${DUCK.before}*${1 - DUCK.to},if(lte(t,${e.toFixed(3)}),${DUCK.to},${DUCK.to}+(t-${e.toFixed(3)})/${DUCK.after}*${1 - DUCK.to})))`).reduce((a, b) => `min(${a},${b})`)}'` : "";
  for (const c of Array.isArray(sound && sound.clips) ? sound.clips : []) {
    const t = tracks.find((x) => x.id === c.track) || { gain: 1 }; if (c.off || t.mute || (solo && !t.solo)) continue; // a take that is not the one in use is left out
    const f = file(c.url); if (!f || !existsSync(f)) continue;
    const at = Math.max(0, (c.shot && m[c.shot] != null ? m[c.shot] : 0) + (+c.offset || 0)); if (at >= total) continue;
    const from = +c.from || 0, len = Math.min(total - at, Math.max(0.05, +c.len > 0 ? +c.len : Math.max(0, (+c.dur || 0) - from) || 1)), g = Math.max(0, (c.gain == null ? 1 : +c.gain) * (t.gain == null ? 1 : +t.gain)), fi = Math.min(len, +c.fadeIn || 0), fo = Math.min(len, +c.fadeOut || 0);
    const k = ins.length / 2 + 1; ins.push("-i", f);
    parts.push(`[${k}:a]atrim=start=${from}:duration=${len},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,volume=${g.toFixed(3)}${fi > 0 ? `,afade=t=in:st=0:d=${fi}` : ""}${fo > 0 ? `,afade=t=out:st=${(len - fo).toFixed(3)}:d=${fo}` : ""},adelay=${Math.round(at * 1000)}:all=1${c.duck && t.kind === "music" ? dip : ""}[a${k}]`);
  }
  const n = parts.length, mix = n ? parts.join(";") + ";" + parts.map((_, i) => `[a${i + 1}]`).join("") + `amix=inputs=${n}:normalize=0:duration=longest,alimiter=limit=0.97,apad[aout]` : "anullsrc=r=48000:cl=stereo[aout]";
  say("Putting the picture, words and sound together");
  const ass = join(work, "words.ass").replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
  await run(["-f", "concat", "-safe", "0", "-i", join(work, "list.txt"), ...ins, "-filter_complex", `[0:v]${gradeFilter(grade)}ass='${ass}'[vout];${mix}`, "-map", "[vout]", "-map", "[aout]", "-t", total.toFixed(3),
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(FPS), "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out]);
  await rm(work, { recursive: true, force: true });
  return { seconds: total, shots: shots.length, clips: n };
}
