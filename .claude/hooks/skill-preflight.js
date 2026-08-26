/**
 * skill-preflight — UserPromptSubmit hook. Supplies a project-policy note that names the
 * skills governing this turn, before Claude drafts anything.
 *
 * ## WHY THIS EXISTS, measured
 *
 * Skill invocations across 713 assistant messages in one session:
 *     34x supervisor-loop   <- the operator's prompt literally says "Load the supervisor-loop skill first"
 *      1x operator-prose    <- only after the operator asked for a skill review
 *      0x contract-design   <- never, while the agent authored a card carrying 3 contract defects
 *
 * Automatic selection from `description` + `when-to-use` did not fire for operator-prose across the
 * whole session. Against 214 paired prompt/response rows from that same session, the skill's hard
 * limits were exceeded in 158 responses (bold), 184 (em-dash) and 201 (length). An explicit
 * instruction inside the turn's prompt was the only thing that reliably loaded a skill.
 *
 * ## FAIL-OPEN BY DESIGN
 *
 * A missing node, a throw, or a timeout produces a hook error and the prompt proceeds WITHOUT the
 * note. That is correct for a style aid, so the note says "project policy" rather than "mandatory":
 * claiming enforcement this hook does not have is the marker-check failure it exists to reduce.
 *
 * ## WHY A FILE AND NOT `node -e`
 *
 * The first version was an inline `node -e '...'` with nested quotes. That is the transport class
 * `tools/openclinxr/openclaw/shell-prose-chokepoint.ts` exists to refuse, after three measured
 * incidents across two agents where zsh evaluated backticks inside such an argument and silently
 * deleted technical spans from published artifacts. The prose lives in a file; the shell sees a path.
 *
 * ## TRAPS THIS AVOIDS
 *
 * - `additionalContext` MUST nest inside `hookSpecificOutput`. At top level Claude Code silently
 *   ignores it, which looks implemented and does nothing.
 * - `systemMessage` is a TOP-LEVEL field, not part of `hookSpecificOutput`.
 * - `permissionDecision` is a PreToolUse field and has no meaning on UserPromptSubmit.
 * - The payload's prompt field is `prompt` (verified against a live `claude -p` run, 2026-08-26).
 */
import { readFileSync } from "node:fs";

/**
 * Prompt shapes that mean this turn will touch a contract, so contract-design applies too.
 * TUNED FOR RECALL. A false positive costs one skill load; a false negative permits a contract to
 * be authored without the rule written to stop vacuous proofs. Word boundaries keep `contractor`
 * and `proofread` out.
 */
const CONTRACT_SHAPED = new RegExp(
  [
    "done[_ -]?when",
    "acceptance criteri",
    "planted red",
    "\\bcontract(s|ual)?\\b",
    "\\bproofs?\\b",
    "destructive probe",
    "counterweight",
    "\\bthreshold(s)?\\b",
    "\\benum(s|eration)?\\b",
    "test[_ -]?fixtures?",
    "known[_ -]?good",
    "factory[_ -]?step",
    "\\bbriefFromIssue\\b",
  ].join("|"),
  "i",
);

export function buildPreflight(userInput) {
  const contract = CONTRACT_SHAPED.test(String(userInput ?? ""));
  const names = contract ? ["operator-prose", "contract-design"] : ["operator-prose"];
  const additionalContext = [
    "Project policy for this repository, supplied by a project hook.",
    "Operator-facing responses are governed by the project Skill operator-prose. Load it before drafting any response addressed to the human operator; do not rely on a remembered copy.",
    contract
      ? "This prompt involves contract design. The project Skill contract-design governs any done_when, planted RED, proof, threshold, enum, counterweight or test fixture. Load it before writing or editing the contract."
      : "If this turn later enters contract authoring or review, load contract-design at that transition.",
    "Load the skills before producing the governed output.",
  ].join(" ");
  return {
    systemMessage: `Skill preflight: ${names.join(", ")}`,
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext,
    },
  };
}

const isDirect = process.argv[1] && process.argv[1].endsWith("skill-preflight.js");
if (isDirect) {
  // Targeted control switch for the paired pilot. Suppresses ONLY this hook, leaving every other
  // settings source untouched — hook arrays merge across sources, so an empty array cannot remove it.
  if (process.env.OPENCLINXR_SKILL_PREFLIGHT === "0") process.exit(0);

  let raw = "";
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    raw = "";
  }
  let input = {};
  if (raw.trim()) {
    try {
      input = JSON.parse(raw);
    } catch (err) {
      // Do NOT silently emit a note built from an empty prompt: that would look correct and
      // classify every malformed turn as non-contract.
      process.stderr.write(`skill-preflight: unparseable hook input: ${String(err)}\n`);
      process.exit(1);
    }
  }
  process.stdout.write(JSON.stringify(buildPreflight(input.prompt ?? input.user_input ?? "")));
}
