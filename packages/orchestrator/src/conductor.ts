import { EventEmitter } from 'events';
import { checkEvidenceGates } from './evidence/gate-checker';
import { selectNextTask } from './task/selector';
import { routeToAgent } from './routing/agent-router';
import { runWorkflowPhase } from './workflow/phases';

export class Conductor extends EventEmitter {
  private isRunning = false;
  private intervalMs = 8000;

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('[Conductor] 🚀 Starting full evidence-gated orchestrator for OpenClinXR...');

    while (this.isRunning) {
      try {
        await this.tick();
      } catch (err) {
        console.error('[Conductor] Error during tick:', err);
        this.emit('error', err);
      }
      await new Promise(r => setTimeout(r, this.intervalMs));
    }
  }

  stop() {
    this.isRunning = false;
    console.log('[Conductor] Stopping orchestrator...');
  }

  private async tick() {
    const gates = await checkEvidenceGates();
    if (!gates.canProceed) {
      console.log('[Conductor] Evidence gates blocking progress. Waiting...');
      return;
    }

    const task = await selectNextTask();
    if (!task) {
      console.log('[Conductor] No high-priority tasks ready. Idling...');
      return;
    }

    console.log(`[Conductor] 🔄 Processing task: ${task.id} - ${task.title}`);

    const agent = await routeToAgent(task);
    const result = await runWorkflowPhase(agent, task);

    this.emit('taskCompleted', { task, result });
    console.log(`[Conductor] ✅ Task completed: ${task.id}`);
  }
}

export const conductor = new Conductor();