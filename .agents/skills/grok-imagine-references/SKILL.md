---
name: grok-imagine-references
description: How to generate reference images and videos with Grok Imagine (image_gen, image_edit, reference_to_video) from a headless grok CLI worker, for motion targets and visual references. Load before any Imagine call.
---

# Grok Imagine from a headless worker

Imagine tools exist only inside a grok session. Claude, Codex and OpenCode cannot call them directly; they launch a one-shot grok worker that does. Upstream tool reference (parameters, prompt craft): `~/.grok/bundled/skills/imagine/SKILL.md`. This file covers what that one does not: how this repo invokes it, what failed, and how outputs are used.

## Invocation

```bash
direnv exec /Volumes/files/src/openclinxr env OPENCLINXR_RAW_GROK_SANCTIONED=1 OPENCLINXR_WORKER=1 GROK_SUBAGENTS=1 \
  ~/.grok/bin/grok -p "$(cat prompt.md)" --agent general-purpose \
  --tools image_gen,image_edit,reference_to_video,write,read_file,list_dir,run_terminal_command \
  --model muse-spark-1-go --output-format json --max-turns 30 \
  --cwd <scratch dir> > run.json 2> run.err < /dev/null
```

| part | why |
|---|---|
| `direnv exec` | supplies the API key; without it the call 401s, which reads like a provider outage |
| `--model muse-spark-1-go` | driver model for the session. Never `grok-4.7` without operator approval (Opus-priced). Generations are billed by Imagine regardless of driver |
| `--tools` allowlist | keeps the worker to Imagine plus file I/O and ffmpeg; it cannot wander into the repo |
| `--cwd <scratch dir>` | outputs and frames land outside the repo. References are not shipped assets |
| `< /dev/null` | without it the CLI can wait on stdin |
| answer field | `.text` in `run.json`; `.result` is always null |

Raw outputs land in the grok session directory, `~/.grok/sessions/<cwd>/<sessionId>/images/N.jpg` and `.../videos/N.mp4`. Have the worker copy them to named files in the scratch dir and record both paths.

## The three tools

| tool | input | use it for |
|---|---|---|
| `image_gen` | `prompt`, `aspect_ratio` (`16:9`, `1:1`, `9:16`, `3:2`, `2:3`, `auto`) | a new still with no source: the first frame of a reference video |
| `image_edit` | `prompt` (what changes, what stays), `image` (absolute path, list allowed), optional `aspect_ratio` | a variant of an existing image with the same person, framing and light |
| `reference_to_video` | `prompt`, `aspect_ratio`, `duration` 1-15 s, `resolution_name` 480p/720p, and at least one of `images`, `first_frame`, `last_frame`, `keyframes` (up to 4, 1/3 s grid), `voices` | every video. There is no text-to-video tool; `video_gen` is not exposed |

`image_edit` downscales references to about 768 px on the long side, so pick a source for composition and identity, not fine detail. No `n`/`count`: one call per variant.

## Workflows

**Motion reference video (used for the stepping turn and arm settle, 2026-10-11):**
1. `image_gen` the first frame: subject, pose at clip start, camera side and height, distance, full body head to feet, plain floor and wall, even light.
2. `reference_to_video` with `first_frame` = that file, `duration` 6, `720p`, `16:9`. The prompt starts "The camera is locked off and never moves", then states the motion as positions and timings ("takes two more steps, stops, arms settle at the sides over about half a second, then stands still for the last two seconds"). Bare verbs produce bobbing in place.
3. `ffmpeg -y -i ref.mp4 -vf fps=4 frames/frame_%03d.png`, then a contact sheet. Grade the motion before it becomes a target.

**Where `image_edit` fits:**
- **End frame for a travelling or turning subject:** edit the first frame ("same person, same camera, now turned 90 degrees to face the camera, feet shoulder width"), pass it as `last_frame`. Pinning both ends stops the model inventing the destination.
- **Second angle of the same take:** edit the side first-frame into an overhead or front view of the same person rather than a fresh `image_gen`, which drifts in body and clothing.
- **Body-readable reference:** edit a clothed frame to "same person, same pose, plain fitted dark clothing" so knee and hip angles are visible. Motion is graded on the bare body (lab coats hide the hip and knee).
- **Pose variant:** "same person, arms relaxed at the sides" for an idle target still.

Not yet used in this repo; the first use should record what it produced here.

## Prompt rules that go in every brief

Paste these verbatim. They were added after the first run, when the worker hit a tool error and wrote 8 KB grey ffmpeg videos named like the real outputs:

> HARD RULES: never create placeholder or synthetic files. If any tool returns an error, upgrade notice, moderation block or storage error, write it verbatim into refs.json and STOP.

Also require `refs.json`: each step's tool, prompt, parameters, returned path, output path and byte size, plus `errors: []`. Check it, and check byte sizes against a real clip (a 6 s 720p clip ran about 1.4 MB), before trusting any file.

## Using the output

- References are visual targets for a brief (rhythm, step count, timing, end pose), never shipped assets and never committed. Cite the scratch path in the brief.
- Read numbers off the frames (step count, duration in frames at a known fps), not off the prompt. The model may not do what was asked.
- No named real people (upstream rule: reference-first with a real photo and a web search). Moderation block means stop; do not rephrase to get around it.
- Video is gated: free tiers return an upgrade notice, ZDR mode returns a storage error. Relay and stop.

## Related

`grok-worker-monitoring` (liveness, resume), `model-routing` (driver model choice).
