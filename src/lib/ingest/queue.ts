const pending: Promise<void>[] = [];

/** Run after the webhook response. Single process, no separate worker. */
export function enqueueIngest(task: () => Promise<void>): void {
  const job = task().finally(() => {
    const index = pending.indexOf(job);
    if (index >= 0) pending.splice(index, 1);
  });
  pending.push(job);
}

export async function drainIngestQueue(): Promise<void> {
  while (pending.length > 0) {
    await Promise.all(pending.slice());
  }
}
