export async function routeToAgent(task: any) {
  const type = task.type || 'default';

  // Map task types to your existing role-based agents
  if (['clinical', 'medical', 'patient'].includes(type)) {
    return { name: 'physicians', role: 'clinical decision making' };
  }
  if (['adversarial', 'redteam', 'security'].includes(type)) {
    return { name: 'adversarial', role: 'red team / edge case finder' };
  }
  if (['leadership', 'strategy', 'priority'].includes(type)) {
    return { name: 'leadership', role: 'high-level decision making' };
  }

  return { name: 'coordinator', role: 'general coordination' };
}