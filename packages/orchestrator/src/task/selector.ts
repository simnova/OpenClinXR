export async function selectNextTask() {
  // TODO: In production, parse from proposals/, iterations/, or a proper backlog system
  // For now, return a realistic placeholder task
  return {
    id: 'task-' + Date.now(),
    title: 'Advance next clinical simulation scenario with evidence validation',
    type: 'clinical',
    priority: 'high',
  };
}