import { runInNewContext } from "node:vm";
import { type CallExpression, createSourceFile, type FunctionDeclaration, forEachChild, isCallExpression, isFunctionDeclaration, isIdentifier, isNoSubstitutionTemplateLiteral, isStringLiteral, isTemplateHead, isTemplateMiddle, isTemplateTail, ModuleKind, type Node, ScriptTarget, type SourceFile, transpileModule } from "typescript";
export type ProducerContract = { gateText: string; producerStrings: string; realProducerCalls: number; gateCallsInProducer: number };
function namedDeclarations(sf: SourceFile, name: string): FunctionDeclaration[] {
  const out: FunctionDeclaration[] = [];
  for (const stmt of sf.statements) {
    if (isFunctionDeclaration(stmt) && stmt.name !== undefined && stmt.name.text === name) {
      out.push(stmt);
    }
  }
  return out;
}
function collectProducerStrings(body: Node, into: string[]): void {
  const visit = (node: Node): void => {
    if (isStringLiteral(node) || isNoSubstitutionTemplateLiteral(node) || isTemplateHead(node) || isTemplateMiddle(node) || isTemplateTail(node)) {
      into.push(node.text);
    }
    forEachChild(node, visit);
  };
  visit(body);
}
function countCalls(sf: SourceFile, producer: FunctionDeclaration): { realProducerCalls: number; gateCallsInProducer: number } {
  let realProducerCalls = 0;
  let gateCallsInProducer = 0;
  const inProducer = (pos: number): boolean => pos >= producer.pos && pos <= producer.end;
  const visit = (node: Node): void => {
    const call: CallExpression | null = isCallExpression(node) ? node : null;
    if (call !== null && isIdentifier(call.expression)) {
      if (call.expression.text === "addActorSpecificIdentityVariantCue" && !inProducer(call.pos)) {
        realProducerCalls += 1;
      }
      if (call.expression.text === "shouldShowProceduralHumanoidDetailCues" && inProducer(call.pos)) {
        gateCallsInProducer += 1;
      }
    }
    forEachChild(node, visit);
  };
  visit(sf);
  return { realProducerCalls, gateCallsInProducer };
}
export function analyzeProducerContract(source: string): ProducerContract {
  const sf: SourceFile = createSourceFile("role-visuals.ts", source, ScriptTarget.Latest, true);
  const gates = namedDeclarations(sf, "shouldShowProceduralHumanoidDetailCues");
  const producers = namedDeclarations(sf, "addActorSpecificIdentityVariantCue");
  if (gates.length !== 1 || producers.length !== 1) {
    throw new Error(`expected exactly one gate and one producer declaration, found ${gates.length}/${producers.length}`);
  }
  const gate: FunctionDeclaration = gates[0] as FunctionDeclaration;
  const producer: FunctionDeclaration = producers[0] as FunctionDeclaration;
  if (gate.body === undefined) {
    throw new Error("gate declaration has no body");
  }
  if (producer.body === undefined) {
    throw new Error("producer declaration has no body");
  }
  const parts: string[] = [];
  collectProducerStrings(producer.body, parts);
  const counts = countCalls(sf, producer);
  return { gateText: gate.getText(sf), producerStrings: parts.join("\n"), realProducerCalls: counts.realProducerCalls, gateCallsInProducer: counts.gateCallsInProducer };
}
export type GateFn = (ctx: unknown, mode: string) => boolean;
export function evaluateActualGate(gateText: string): GateFn {
  const js: string = transpileModule(gateText.replace(/^export\s+/, ""), { compilerOptions: { module: ModuleKind.None, target: ScriptTarget.ES2020 } }).outputText;
  const fn: unknown = runInNewContext(`${js}\nshouldShowProceduralHumanoidDetailCues;`, {}, { timeout: 2000 });
  if (typeof fn !== "function") {
    throw new Error("transpiled gate did not evaluate to a function");
  }
  return fn as GateFn;
}
export function gateBehavior(gate: GateFn): { fallback: boolean; realFace: boolean; marker: boolean } {
  const off = { shouldShowAffordanceMarkers: (): boolean => false };
  const on = { shouldShowAffordanceMarkers: (): boolean => true };
  return { fallback: gate(off, "primitive_fallback"), realFace: gate(off, "generated_glb"), marker: gate(on, "generated_glb") };
}
