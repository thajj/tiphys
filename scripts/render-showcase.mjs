// Export a real browser recording as full-size WebM, MP4, and a poster.
// Requires ffmpeg with libvpx-vp9 and libx264, plus ffprobe on PATH.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [inputArgument, ...options] = process.argv.slice(2);
if (!inputArgument || options.length % 2) {
  throw new Error("Usage: node scripts/render-showcase.mjs INPUT_WEBM [--timing JSON] [--start SECONDS] [--end SECONDS] [--poster-seconds SECONDS] [--output DIRECTORY]");
}
const flags = new Map();
for (let index = 0; index < options.length; index += 2) {
  if (!["--timing", "--start", "--end", "--poster-seconds", "--output"].includes(options[index])) throw new Error("Unknown option: " + options[index]);
  if (flags.has(options[index])) throw new Error("Duplicate option: " + options[index]);
  flags.set(options[index], options[index + 1]);
}
const input = path.resolve(inputArgument);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destination = path.resolve(flags.get("--output") ?? path.join(root, "docs", "media"));
const run = (command, args, capture = false) => {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: capture ? "pipe" : "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(command + " failed: " + (result.stderr || "exit " + result.status));
  return result.stdout;
};
const probe = file => JSON.parse(run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height,pix_fmt,nb_frames,r_frame_rate,avg_frame_rate:format=duration,size", "-of", "json", file], true));
const frameRate = rate => {
  const [numerator, denominator = 1] = String(rate).split("/").map(Number);
  return numerator / denominator;
};
const source = probe(input);
const sourceStream = source.streams[0];
const sourceFps = frameRate(sourceStream?.avg_frame_rate) || frameRate(sourceStream?.r_frame_rate);
const sourceDuration = Number(source.format.duration);
const timing = flags.has("--timing") ? JSON.parse(await readFile(flags.get("--timing"), "utf8")) : {};
if (timing.completed === false) throw new Error("Refusing to export an incomplete showcase recording; rerun the capture until every assertion passes");
const start = Number(flags.get("--start") ?? timing.startSeconds ?? 0);
const requestedEnd = Number(flags.get("--end") ?? timing.endSeconds ?? sourceDuration);
if (![start, requestedEnd, sourceDuration, sourceFps].every(Number.isFinite) || sourceFps <= 0
  || start < 0 || requestedEnd <= start || requestedEnd > sourceDuration + 0.1) {
  throw new Error("Invalid trim range " + start + "–" + requestedEnd + " for " + sourceDuration + "s recording");
}
const end = Math.min(requestedEnd, sourceDuration);
const duration = end - start;
if (sourceStream?.width !== 1600 || sourceStream?.height !== 1000) {
  throw new Error("The showcase composition requires a 1600×1000 recording with a 96px caption footer");
}
// Poster time is relative to the exported clip, not the untrimmed recording.
const posterSeconds = Number(flags.get("--poster-seconds") ?? timing.posterSeconds ?? Math.min(3, duration / 2));
if (!Number.isFinite(posterSeconds) || posterSeconds < 0 || posterSeconds >= duration) throw new Error("Poster time must fall within the exported clip");
const fps = 60;
const camera = timing.camera ?? [];
if (!Array.isArray(camera)) throw new Error("Invalid camera timeline");
const ease = progress => {
  const value = Math.max(0, Math.min(1, progress));
  return value ** 3 * (value * (value * 6 - 15) + 10);
};
let previousTime = -Infinity;
for (const cue of camera) {
  if (![cue.videoSeconds, cue.zoom, cue.centerX, cue.centerY, cue.durationSeconds].every(Number.isFinite)
    || cue.videoSeconds < previousTime || cue.zoom < 1 || cue.zoom > 2
    || cue.centerX < 0 || cue.centerX > 1600 || cue.centerY < 0 || cue.centerY > 904
    || cue.durationSeconds < 0 || cue.durationSeconds > 3) throw new Error("Invalid camera cue: " + JSON.stringify(cue));
  previousTime = cue.videoSeconds;
}
// A quintic ease starts and stops with zero velocity and acceleration. If a cue
// interrupts a move, begin from its current interpolated position, without a jump.
const cameraExpression = (field, initial) => {
  let expression = String(initial);
  let last = { time: -Infinity, duration: 0, from: initial, to: initial };
  for (const cue of camera) {
    const from = last.duration ? last.from + (last.to - last.from) * ease((cue.videoSeconds - last.time) / last.duration) : last.to;
    const elapsed = `(on/${fps}-${(cue.videoSeconds - start).toFixed(4)})`;
    const progress = `clip(${elapsed}/${cue.durationSeconds || 1},0,1)`;
    const smoothed = `(${progress}*${progress}*${progress}*(${progress}*(${progress}*6-15)+10))`;
    const value = cue.durationSeconds ? `${from}+(${cue[field] - from})*${smoothed}` : String(cue[field]);
    expression = `if(gte(on/${fps},${(cue.videoSeconds - start).toFixed(4)}),${value},${expression})`;
    last = { time: cue.videoSeconds, duration: cue.durationSeconds, from, to: cue[field] };
  }
  return expression;
};
const zoom = cameraExpression("zoom", 1);
const centerX = cameraExpression("centerX", 800);
const centerY = cameraExpression("centerY", 452);
await mkdir(destination, { recursive: true });
const temporary = await mkdtemp(path.join(destination, ".showcase-"));
try {
  const webm = path.join(temporary, "tiphys-showcase.webm");
  const mp4 = path.join(temporary, "tiphys-showcase.mp4");
  const poster = path.join(temporary, "tiphys-showcase-poster.png");
  const metadata = path.join(temporary, "tiphys-showcase.json");
  const mask = path.join(temporary, "corners.png");
  // Keep the source UI at its full output size. The subtle frame uses only 16px
  // on each side; captions stay outside the app, never over its controls.
  run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
    "color=white:s=1568x886,format=gray,geq=lum='if(lte(pow(max(12-X,0)+max(X-(W-13),0),2)+pow(max(12-Y,0)+max(Y-(H-13),0),2),144),255,0)'",
    "-frames:v", "1", "-update", "1", mask]);
  // The recorder's native frame rate is preserved in the QA metadata. The 60fps
  // export smooths camera movement only; it does not invent intermediate UI frames.
  const composition = [
    `[0:v]setpts=PTS-STARTPTS,fps=${fps},split[app][captions]`,
    `[app]crop=1600:904:0:0,scale=3200:1808:flags=lanczos,zoompan=z='${zoom}':x='max(0,min(iw-iw/zoom,(${centerX})*2-iw/zoom/2))':y='max(0,min(ih-ih/zoom,(${centerY})*2-ih/zoom/2))':d=1:s=1600x904:fps=${fps},scale=1568:886:flags=lanczos,format=rgb24[framed]`,
    "[framed][1:v]alphamerge[rounded]",
    `color=c=0x0b1222:s=1600x904:r=${fps}[background]`,
    "[background][rounded]overlay=16:9:shortest=1[stage]",
    "[captions]crop=1600:96:0:904[footer]",
    "[stage][footer]vstack=inputs=2:shortest=1,split[webm][mp4]",
  ].join(";");
  // Encode both directly from the composed recording. Neither delivery format
  // is transcoded from the other, so the fallback adds no generation loss.
  run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(start), "-i", input,
    "-loop", "1", "-framerate", String(fps), "-i", mask,
    "-filter_complex", composition,
    "-map", "[webm]", "-t", String(duration), "-an", "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "20",
    "-deadline", "good", "-cpu-used", "2", "-row-mt", "1", "-tile-columns", "2", "-g", "120",
    "-pix_fmt", "yuv420p", "-map_metadata", "-1", webm,
    "-map", "[mp4]", "-t", String(duration), "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "17",
    "-pix_fmt", "yuv420p", "-g", "120", "-movflags", "+faststart", "-map_metadata", "-1", mp4]);

  // PNG preserves text sharpness for README clients that cannot play video.
  run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(posterSeconds), "-i", webm,
    "-frames:v", "1", "-update", "1", poster]);
  const exports = [];
  for (const [file, codec] of [[webm, "vp9"], [mp4, "h264"]]) {
    const info = probe(file);
    const stream = info.streams[0];
    const actualDuration = Number(info.format.duration);
    if (stream?.codec_name !== codec || stream?.pix_fmt !== "yuv420p"
      || stream?.width !== 1600 || stream?.height !== 1000) throw new Error("Unexpected encoding or dimensions: " + file);
    const actualFrameRate = frameRate(stream.avg_frame_rate) || frameRate(stream.r_frame_rate);
    if (!Number.isFinite(actualFrameRate) || Math.abs(actualFrameRate - fps) > 0.01) throw new Error("Unexpected output frame rate: " + file);
    if (!Number.isFinite(actualDuration) || Math.abs(actualDuration - duration) > Math.max(.15, 2 / sourceFps)) throw new Error("Encoded duration differs from the selected range: " + file);
    // Decode every frame before any committed asset is replaced.
    run("ffmpeg", ["-v", "error", "-xerror", "-i", file, "-f", "null", "-"]);
    exports.push({ file: path.basename(file), codec, width: stream.width, height: stream.height,
      frameRate: fps, durationSeconds: actualDuration, bytes: Number(info.format.size) });
  }
  const posterInfo = probe(poster);
  if (posterInfo.streams[0]?.codec_name !== "png" || posterInfo.streams[0]?.width !== 1600 || posterInfo.streams[0]?.height !== 1000) throw new Error("Invalid poster");
  run("ffmpeg", ["-v", "error", "-xerror", "-i", poster, "-f", "null", "-"]);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(input)) hash.update(chunk);
  const seenChapters = new Set();
  const chapters = (timing.chapters ?? []).filter(chapter => {
    if (!Number.isFinite(chapter.videoSeconds) || chapter.videoSeconds >= end || seenChapters.has(chapter.chapter)) return false;
    seenChapters.add(chapter.chapter);
    return true;
  }).map(chapter => ({ chapter: chapter.chapter, title: chapter.title,
    seconds: Math.max(0, Number((chapter.videoSeconds - start).toFixed(3))) }));
  const readingHolds = (timing.readingHolds ?? []).filter(hold => Number.isFinite(hold.startSeconds)
    && Number.isFinite(hold.endSeconds) && hold.endSeconds > start && hold.startSeconds < end)
    .map(hold => ({ scene: hold.scene, startSeconds: Number(Math.max(0, hold.startSeconds - start).toFixed(3)),
      endSeconds: Number(Math.min(duration, hold.endSeconds - start).toFixed(3)) }));
  // Copy only public capture facts. Never persist machine-specific file paths or
  // arbitrary recorder fields into the metadata committed alongside the media.
  const capture = timing.capture ? {
    kind: timing.capture.kind, nativeFrameRate: timing.capture.nativeFrameRate,
    reducedMotion: timing.capture.reducedMotion, actions: timing.capture.actions,
  } : undefined;
  const provenance = timing.source ? {
    url: typeof timing.source.url === "string" && /^https?:\/\//.test(timing.source.url) ? timing.source.url : undefined,
    fixture: typeof timing.source.fixture === "string" && !path.isAbsolute(timing.source.fixture) && !path.win32.isAbsolute(timing.source.fixture)
      && !timing.source.fixture.split(/[\\/]/).includes("..") ? timing.source.fixture : undefined,
    copiedAndVerified: timing.source.copiedAndVerified,
  } : undefined;
  const details = {
    schemaVersion: 1,
    completed: timing.completed,
    capture, provenance,
    source: { sha256: hash.digest("hex"), width: sourceStream.width, height: sourceStream.height,
      frameRate: sourceFps, startSeconds: start, endSeconds: end },
    motion: "UI motion comes from the browser recording at its native frame rate. Exported camera movement is evaluated at 60 fps.",
    durationSeconds: duration,
    primary: path.basename(webm), fallback: path.basename(mp4),
    poster: { file: path.basename(poster), seconds: posterSeconds, width: 1600, height: 1000 },
    chapters, readingHolds, exports,
  };
  await writeFile(metadata, JSON.stringify(details, null, 2) + "\n");
  for (const file of [webm, mp4, poster, metadata]) await rename(file, path.join(destination, path.basename(file)));
  console.log(JSON.stringify(details, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
