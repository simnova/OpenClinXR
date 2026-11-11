/**
 * FU1/FU2 offline regressions for the RR1 runner (no browser, ffmpeg-backed).
 *
 * R7 root cause (FU2): speechOnsetSeconds returned the FIRST silence_end even
 * when the stream starts with sound, so an inter-word gap (run-1: 0.987) stood
 * in for the onset and measuredAudioDelayMs placed speech ~1 s early. The fix
 * returns the leading-silence end only when the stream starts silent.
 *
 * M2: run-1's hold segment was a 472-byte header-only webm (sub-frame
 * `-t`), unopenable by the concat demuxer, which then dropped the faculty
 * segment (combined 49.6 s = learner only).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  HOLD_FRAME_SECONDS,
  holdConcatPlan,
  learnerHoldEncodeArgs,
  measuredAudioDelayMs,
  speechOnsetSeconds,
} from "../xr-sync/rr1-run.mjs";

function ffprobeJson(path: string): { format?: { duration?: string }; streams?: Array<Record<string, unknown>> } {
  return JSON.parse(execFileSync("ffprobe", [
    "-v", "error", "-show_streams", "-show_format", "-of", "json", path,
  ], { encoding: "utf8" })) as { format?: { duration?: string }; streams?: Array<Record<string, unknown>> };
}

function videoProfile(path: string): Record<string, unknown> {
  const probed = ffprobeJson(path);
  const video = probed.streams?.find((stream) => stream["codec_type"] === "video");
  return {
    codec: video?.["codec_name"],
    width: video?.["width"],
    height: video?.["height"],
    pixFmt: video?.["pix_fmt"],
    fps: video?.["r_frame_rate"],
    timeBase: video?.["time_base"],
  };
}

function mediaDuration(path: string): number {
  return Number(ffprobeJson(path).format?.duration ?? Number.NaN);
}

describe("FU2 speechOnsetSeconds returns the leading-silence end only", () => {
  function makeWav(dir: string, name: string, inputs: string[], filter: string): string {
    const out = join(dir, name);
    const args: string[] = ["-y", "-v", "error"];
    for (const source of inputs) {
      args.push("-f", "lavfi", "-i", source);
    }
    args.push("-filter_complex", filter, "-ar", "48000", "-ac", "1", out);
    execFileSync("ffmpeg", args);
    return out;
  }

  function tone(seconds: number): string {
    return `sine=frequency=880:sample_rate=48000:duration=${seconds}`;
  }

  function silence(seconds: number): string {
    return `anullsrc=r=48000:cl=mono:d=${seconds}`;
  }

  it("R1 a stream starting with sound has onset 0, not its first gap end", () => {
    const dir = mkdtempSync(join(tmpdir(), "rr1-onset-"));
    const wav = makeWav(dir, "tone-gap-tone.wav", [tone(0.3), silence(0.2), tone(0.3)], "[0:a][1:a][2:a]concat=n=3:v=0:a=1");
    expect(speechOnsetSeconds(wav)).toBe(0);
  });

  it("R2 control: 0.4 s of leading silence reports its end within a frame", () => {
    const dir = mkdtempSync(join(tmpdir(), "rr1-onset-"));
    const wav = makeWav(dir, "silence-tone.wav", [silence(0.4), tone(0.3)], "[0:a][1:a]concat=n=2:v=0:a=1");
    expect(Math.abs(speechOnsetSeconds(wav) - 0.4)).toBeLessThanOrEqual(0.02);
  });

  it("fixed delay for a sound-first source is the full line frame", () => {
    expect(measuredAudioDelayMs(7.585, 0)).toBe(7585);
  });
});

describe("FU1 hold/concat plan", () => {
  it("skips a sub-frame hold and keeps a real hold", () => {
    expect(holdConcatPlan(0)).toEqual({ includeHold: false });
    expect(holdConcatPlan(HOLD_FRAME_SECONDS - 0.001)).toEqual({ includeHold: false });
    expect(holdConcatPlan(HOLD_FRAME_SECONDS)).toEqual({ includeHold: true });
    expect(holdConcatPlan(2.5)).toEqual({ includeHold: true });
  });

  it("hold encode args pin the learner segment profile", () => {
    const args = learnerHoldEncodeArgs({ framePng: "hold.png", seconds: 0.32, outPath: "hold.webm" });
    expect(args.slice(0, 2)).toEqual(["-y", "-v"]);
    for (const token of ["libvpx", "yuv420p", "25", "hold.png", "0.32"]) {
      expect(args).toContain(token);
    }
    expect(args.at(-1)).toBe("hold.webm");
  });
});

describe("FU1 learner+hold+faculty concat", () => {
  it("combined duration equals the summed segments within one frame", () => {
    const dir = mkdtempSync(join(tmpdir(), "rr1-concat-"));
    const learner = join(dir, "learner.webm");
    execFileSync("ffmpeg", [
      "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=960x600:rate=25:duration=0.4",
      "-an", "-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "5", "-pix_fmt", "yuv420p", "-r", "25", learner,
    ]);
    const faculty = join(dir, "faculty.webm");
    execFileSync("ffmpeg", [
      "-y", "-v", "error", "-f", "lavfi", "-i", "smptebars=size=960x600:rate=25:duration=0.4",
      "-an", "-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "5", "-pix_fmt", "yuv420p", "-r", "25", faculty,
    ]);
    const png = join(dir, "hold.png");
    execFileSync("ffmpeg", ["-y", "-v", "error", "-sseof", "-0.04", "-i", learner, "-frames:v", "1", png]);
    const hold = join(dir, "hold.webm");
    execFileSync("ffmpeg", learnerHoldEncodeArgs({ framePng: png, seconds: 0.32, outPath: hold }));
    const expectedProfile = { codec: "vp8", width: 960, height: 600, pixFmt: "yuv420p", fps: "25/1", timeBase: "1/1000" };
    for (const segment of [learner, hold, faculty]) {
      expect(videoProfile(segment)).toEqual(expectedProfile);
    }
    const list = join(dir, "concat.txt");
    writeFileSync(list, [`file '${learner}'`, `file '${hold}'`, `file '${faculty}'`].join("\n").concat("\n"));
    const combined = join(dir, "combined.webm");
    execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", combined]);
    const summed = mediaDuration(learner) + mediaDuration(hold) + mediaDuration(faculty);
    expect(Number.isFinite(summed) && summed > 0).toBe(true);
    expect(Math.abs(mediaDuration(combined) - summed)).toBeLessThanOrEqual(0.04);
  }, 120000);
});
