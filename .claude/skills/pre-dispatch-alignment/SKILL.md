---
name: pre-dispatch-alignment
description: "Slice-SELECTION gate answering 'should this slice exist at all', before operationalizing or dispatching - direction currency (cite the current-rail directive; deprecated rail = pin and re-scope), prior art (search the registry URLs before hand-authoring hair/skin/eyes/brows/clothing/viseme/animation/rooms - an operator URL handed you later is a failed search), writer collision (peer handoffs + recent commits on the surface), size (biggest coherent vertical). Write the four answers as labeled Direction - / Prior art - / Collision - / Size - lines in the issue body BEFORE done_when exists. Clause design -> contract-design; dispatch mechanics -> orchestrator-dispatch-loop."
when-to-use: select a slice, dispatch, operationalize, asset lane, humanoid, anny, mpfb, hair, skin, eyes, eyebrows, clothing, viseme, animation, rooms, build from scratch, another agent is working on, slice too small, bigger effort, stale direction
---

# The pre-dispatch gate

Four checks. Every one exists because skipping it drew an operator correction, and three drew seven or
more.

## 1. Direction currency - is this the CURRENT rail?

Measured: the operator restated one strategic directive near-verbatim **three times** (transition away
from Anny-only assets, MPFB-first), then had to catch the drift anyway - *"Aren't you transitioning to
MPFB instead, why are you working on anny"*, *"confirm that you're working on viseme on MPFB2 models
and not ANNY models"*, *"put a pin in it"* for stale Anny work.

- Before any asset/humanoid/room slice, grep the latest operator directives and active MADRs for the
  current rail. If the slice advances a deprecated one: pin it, re-scope onto the current rail.
- **The cause is dispatchable-certainty bias** - known files and writable contracts on the old rail
  keep winning selection. *"I know how to contract it"* is not a reason.
- **A migration is not done until it is VISIBLE.** *"have you promoted mpfb2 - I don't see those
  humanoids in scenes"*. A transition claimed in coordination files without promoted assets is drift.

## 2. Prior art before authoring - the operator is not my scout

**Twelve messages** handed me a URL, a tool, or a review document for something I was building or
about to build: MakeHuman asset packs (skins, eyebrows, eyelashes, all packs), MPFB script samples and
the makehair thesis, MPFB community viseme support, meshoptimizer, a storybook harness, the
Mesh2Motion/Animato evaluation package, a room-realism review, Rapier + IWSDK.

Search these FIRST for any hair / skin / eyes / brows / lashes / clothing / viseme / animation / room
capability:

- MakeHuman asset packs: `https://static.makehumancommunity.org/assets/assetpacks.html`
- MPFB script samples: `https://github.com/makehumancommunity/mpfb2/blob/master/script_samples/index.md`
- meshoptimizer, for post-generation decimation - never gate early output on triangle count
- prior in-repo evaluation packages and MADRs, before any new bake-off

Record FOUND (with licence) or NOT FOUND in the slice record. **If the operator hands me a URL for
something I was about to hand-author, that is a failed search** - log it so the registry list grows.
The repo has a curious-researcher rule and it did not bind; a rule without a gate is prose.

## 3. Collision - is another writer on this surface?

*"The other agent is working on clothing - you should avoid overwriting it's work"*, and *"there was
work that grok did independently with infigen - check latest in codebase"*.

- Before touching a surface, check peer handoffs and recent commits on that lane.
- Claimed by another agent means take a disjoint lane, or coordinate through the handoff file first.
- Overwriting another agent's uncommitted work is unmergeable loss - this repo has already lost 40
  tracked files to exactly that.

## 4. Size to capability, not to the contract I already know how to write

*"please take on this work through to completion - these smaller slices are inefficient"*, then
*"Is it possible to take on bigger efforts each tick... I feel it understates your capabilities"* - and
then the same correction **again**, near-verbatim. One repeat is a pattern.

- Default slice = the **biggest coherent vertical** the workers can carry with staged checkpoints.
  Staging mechanics live in `grok-worker-monitoring` section 3.
- **If two consecutive slices could have been one, that was one slice.** Log it.

## The gate, compressed

One line each, before every dispatch:

1. **Direction** - which current-rail directive does this advance? (cite it)
2. **Prior art** - which registry was searched, what was found?
3. **Collision** - which handoffs and commits were checked?
4. **Size** - why is this not two slices?

**Four answers is aligned. Four silences is drift on credit.**
