/**
 * Shared GIF / MP4 assembly for marketing frame sequences.
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * @param {string[]} framePaths
 * @param {string} gifPath
 */
export async function framesToGif(framePaths, gifPath) {
  const listFile = path.join(path.dirname(gifPath), `.frames-${path.basename(gifPath, ".gif")}.txt`);
  const content = framePaths.map((p) => `file '${p.replace(/\\/g, "/")}'\nduration 0.65`).join("\n");
  await fs.writeFile(listFile, content + "\n", "utf8");
  await runFfmpeg([
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listFile,
    "-filter_complex",
    "[0:v]fps=10,scale=1280:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3",
    "-loop",
    "0",
    gifPath,
  ]);
  await fs.unlink(listFile).catch(() => {});
}

/**
 * @param {string[]} framePaths
 * @param {string} mp4Path
 */
export async function framesToMp4(framePaths, mp4Path) {
  const listFile = path.join(path.dirname(mp4Path), `.frames-${path.basename(mp4Path, ".mp4")}.txt`);
  const content = framePaths.map((p) => `file '${p.replace(/\\/g, "/")}'\nduration 0.5`).join("\n");
  await fs.writeFile(listFile, content + "\n", "utf8");
  await runFfmpeg([
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listFile,
    "-vf",
    "fps=24,scale=1920:-2:flags=lanczos",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    mp4Path,
  ]);
  await fs.unlink(listFile).catch(() => {});
}

/**
 * @param {string[]} args
 */
function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", args, { stdio: "inherit" });
    ff.on("error", reject);
    ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`))));
  });
}
