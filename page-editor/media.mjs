// Video files made or brought in: one way to make them play well in every browser (19 Nov 2026, the late and choppy clip).
// A clip that is already H.264 / yuv420p with AAC sound (or none) is only re-wrapped with its index at the front (seconds, no
// quality lost); anything else is converted. ffmpeg reads only local files here (no network protocols), with a time limit.
import { execFile } from "node:child_process";

const ff = (bin, args, ms) => new Promise((ok, bad) => execFile(bin, args, { timeout: ms, maxBuffer: 1 << 24 }, (e, o, err) => (e ? bad(new Error(String(err || e.message).trim().split("\n").pop())) : ok(String(o)))));
/** For any input that came from outside (an upload, a model's answer): local files only, and only the containers Ibasho takes
 * (no playlists, no concat lists, no network). Put before the -i it guards. */
export const SAFE_IN = ["-protocol_whitelist", "file", "-format_whitelist", "mov,matroska,mp3,wav,aac,ogg,flac"];
const LOCAL = SAFE_IN;

/** The streams of a local media file: { video: {codec, pix}, audio: {codec} | null }. */
export async function probe(src) {
  let j; try { j = JSON.parse(await ff("ffprobe", [...LOCAL, "-v", "error", "-show_entries", "stream=codec_type,codec_name,pix_fmt", "-of", "json", src], 60000)); }
  catch { throw Object.assign(new Error("That file could not be read as a video (Ibasho takes mp4, mov, m4v and webm)."), { status: 400 }); }
  const v = (j.streams || []).find((s) => s.codec_type === "video"), a = (j.streams || []).find((s) => s.codec_type === "audio");
  return { video: v ? { codec: v.codec_name, pix: v.pix_fmt } : null, audio: a ? { codec: a.codec_name } : null };
}
/** src -> out as an mp4 every browser plays and can start before it has all arrived. Returns "copied" or "converted". */
export async function webMp4(src, out) {
  const p = await probe(src);
  if (!p.video) throw new Error("That file has no picture in it.");
  const plain = p.video.codec === "h264" && p.video.pix === "yuv420p" && (!p.audio || p.audio.codec === "aac");
  if (plain) { await ff("ffmpeg", ["-hide_banner", "-loglevel", "error", ...LOCAL, "-y", "-i", src, "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy", "-movflags", "+faststart", out], 300000); return "copied"; }
  await ff("ffmpeg", ["-hide_banner", "-loglevel", "error", ...LOCAL, "-y", "-i", src, "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "17", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out], 900000);
  return "converted";
}
/** The sound of an mp4 on its own (an .m4a beside it), so the player does not download the whole video a second time for its sound. */
export async function soundOf(mp4, m4a) {
  await ff("ffmpeg", ["-hide_banner", "-loglevel", "error", ...LOCAL, "-y", "-i", mp4, "-vn", "-c:a", "copy", "-movflags", "+faststart", m4a], 120000);
}
