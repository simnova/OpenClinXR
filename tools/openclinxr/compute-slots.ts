import { readComputeSlotsStatus } from "@openclinxr/compute-slots/slots";

const status = readComputeSlotsStatus();
if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
} else {
  process.stdout.write(`Compute slots: ${status.root}\n`);
  for (const pool of status.pools) {
    process.stdout.write(`${pool.pool} (${pool.holders.length}/${pool.size} held)\n`);
    if (pool.holders.length === 0) process.stdout.write("  holders: none\n");
    for (const holder of pool.holders) {
      process.stdout.write(
        `  slot-${holder.slot}: pid=${holder.pid} alive=${holder.alive} age=${Math.round(holder.ageMs / 1000)}s label=${JSON.stringify(holder.label)} cwd=${holder.cwd}\n`,
      );
    }
    if (pool.waiters.length === 0) process.stdout.write("  waiters: none\n");
    for (const [index, waiter] of pool.waiters.entries()) {
      process.stdout.write(
        `  waiter-${index + 1}: pid=${waiter.pid} alive=${waiter.alive} age=${Math.round(waiter.ageMs / 1000)}s label=${JSON.stringify(waiter.label)} cwd=${waiter.cwd}\n`,
      );
    }
  }
}
