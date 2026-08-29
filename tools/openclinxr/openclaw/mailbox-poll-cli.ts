import { pollWatchedMailboxes } from "./mailbox-watch.js";

const digest = await pollWatchedMailboxes(process.cwd());
process.stdout.write(`${digest}\n`);
