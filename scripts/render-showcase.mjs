// Frame the real Playwright recording with smooth camera moves and fixed captions.
// Requires ffmpeg (with libx264), ffprobe, and gifsicle on PATH.
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [inputArgument, ...options] = process.argv.slice(2);
if (!inputArgument || options.length % 2) {
  throw new Error("Usage: node scripts/render-showcase.mjs INPUT_WEBM [--timing JSON] [--start SECONDS] [--end SECONDS]");
}
const flags = new Map();
for (let index = 0; index < options.length; index += 2) {
  if (!["--timing", "--start", "--end"].includes(options[index])) throw new Error("Unknown option: " + options[index]);
  flags.set(options[index], options[index + 1]);
}
const input = path.resolve(inputArgument);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destination = path.join(root, "docs", "media");
const run = (command, args, capture = false) => {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: capture ? "pipe" : "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(command + " failed: " + (result.stderr || "exit " + result.status));
  return result.stdout;
};
const probe = file => JSON.parse(run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height,pix_fmt,nb_frames,r_frame_rate:format=duration,size", "-of", "json", file], true));
const source = probe(input);
run("gifsicle", ["--version"], true);
const sourceDuration = Number(source.format.duration);
const timing = flags.has("--timing") ? JSON.parse(await readFile(flags.get("--timing"), "utf8")) : {};
const start = Number(flags.get("--start") ?? timing.startSeconds ?? 0);
const end = Number(flags.get("--end") ?? timing.endSeconds ?? sourceDuration);
if (![start, end, sourceDuration].every(Number.isFinite) || start < 0 || end <= start || end > sourceDuration + 0.5) {
  throw new Error("Invalid trim range " + start + "–" + end + " for " + sourceDuration + "s recording");
}
if (source.streams[0]?.width !== 1600 || source.streams[0]?.height !== 1000) {
  throw new Error("The showcase composition requires a 1600×1000 recording with a 96px caption footer");
}
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
  const video = path.join(temporary, "argocanvas-showcase.mp4");
  const gif = path.join(temporary, "argocanvas-showcase.gif");
  const unoptimizedGif = path.join(temporary, "unoptimized.gif");
  const mask = path.join(temporary, "corners.png");
  // Make one reusable rounded mask; it never follows the pointer or highlights a control.
  run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
    "color=white:s=1536x868,format=gray,geq=lum='if(lte(pow(max(16-X,0)+max(X-(W-17),0),2)+pow(max(16-Y,0)+max(Y-(H-17),0),2),256),255,0)'",
    "-frames:v", "1", "-update", "1", mask]);
  // The source UI/cursor is recorded at 25 fps. Camera motion is independently
  // evaluated at 60 fps. Supersampling reduces integer-crop jitter during pans.
  const composition = [
    `[0:v]setpts=PTS-STARTPTS,fps=${fps},split[app][captions]`,
    `[app]crop=1600:904:0:0,scale=3200:1808:flags=lanczos,zoompan=z='${zoom}':x='max(0,min(iw-iw/zoom,(${centerX})*2-iw/zoom/2))':y='max(0,min(ih-ih/zoom,(${centerY})*2-ih/zoom/2))':d=1:s=1600x904:fps=${fps},scale=1536:868:flags=lanczos,format=rgb24[framed]`,
    "[framed][1:v]alphamerge[rounded]",
    `color=c=0x0b1222:s=1600x904:r=${fps}[background]`,
    "[background][rounded]overlay=32:18:shortest=1[stage]",
    "[captions]crop=1600:96:0:904[footer]",
    "[stage][footer]vstack=inputs=2:shortest=1[out]",
  ].join(";");
  run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(start), "-i", input,
    "-loop", "1", "-framerate", String(fps), "-i", mask, "-t", String(end - start),
    "-an", "-filter_complex", composition, "-map", "[out]", "-c:v", "libx264", "-preset", "slow", "-crf", "20",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-map_metadata", "-1", video]);
  // A shared palette and rectangle differencing keep the README loop small.
  // Disable dithering so flat UI surfaces and small text stay clean.
  // Prefer a smaller frame over dropping animation frames when camera motion
  // makes the README loop large. The full-resolution MP4 is always preserved.
  let gifBytes = 0;
  for (const [width, colors] of [[960, 128], [896, 128], [800, 128], [800, 96]]) {
    run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", video, "-filter_complex",
      `fps=12,scale=${width}:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`,
      "-loop", "0", unoptimizedGif]);
    // Lossless frame/transparency optimization keeps longer reading holds small
    // without introducing noise around text or lowering the frame rate.
    run("gifsicle", ["--optimize=3", unoptimizedGif, "--output", gif]);
    gifBytes = (await stat(gif)).size;
    console.log(`GIF candidate: ${width}px, ${colors} colors, ${(gifBytes / 1024 / 1024).toFixed(2)} MiB`);
    if (gifBytes <= 10 * 1024 * 1024) break;
  }
  const videoInfo = probe(video);
  const gifInfo = probe(gif);
  if (videoInfo.streams[0]?.codec_name !== "h264" || videoInfo.streams[0]?.pix_fmt !== "yuv420p") throw new Error("Unexpected video encoding");
  if (Math.abs(Number(videoInfo.format.duration) - (end - start)) > 0.2) throw new Error("Encoded duration differs from the selected range");
  if (Math.abs(Number(gifInfo.format.duration) - Number(videoInfo.format.duration)) > 0.25) throw new Error("GIF and MP4 durations differ");
  if (gifBytes > 10 * 1024 * 1024) throw new Error(`GIF is ${(gifBytes / 1024 / 1024).toFixed(2)} MiB; shorten the recording before publishing`);
  // Decode both entire files before replacing the committed showcase.
  for (const file of [video, gif]) run("ffmpeg", ["-v", "error", "-xerror", "-i", file, "-f", "null", "-"]);
  await rename(video, path.join(destination, path.basename(video)));
  await rename(gif, path.join(destination, path.basename(gif)));
  console.log(JSON.stringify({ durationSeconds: Number(videoInfo.format.duration), mp4: videoInfo.streams[0], mp4Bytes: Number(videoInfo.format.size), gif: gifInfo.streams[0], gifBytes }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
