// Pool of terrain-generation workers with a job queue.

export class GenPool {
  constructor(seed, version, size = Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) - 2))) {
    this.workers = [];
    this.queue = [];          // [{cx, cz, resolve}]
    this.pending = new Map(); // jobId -> {resolve, worker}
    this.nextJob = 1;
    this.idle = [];

    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL('../workers/genWorker.js', import.meta.url), { type: 'module' });
      w.postMessage({ type: 'init', seed, version });
      w.onmessage = (e) => this.onResult(w, e.data);
      w.onerror = (e) => console.error('[genWorker] error:', e.message, e.filename, e.lineno);
      w.onmessageerror = (e) => console.error('[genWorker] message error', e);
      this.workers.push(w);
      this.idle.push(w);
    }
  }

  // Returns a promise resolving to {blocks, heightMap, biomeMap, entities},
  // or null if the job was pruned before it ran.
  generate(cx, cz) {
    return new Promise((resolve) => {
      this.queue.push({ cx, cz, resolve });
      this.pump();
    });
  }

  pump() {
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop();
      const job = this.queue.shift();
      const jobId = this.nextJob++;
      this.pending.set(jobId, { resolve: job.resolve, worker: w });
      w.postMessage({ type: 'gen', cx: job.cx, cz: job.cz, jobId });
    }
  }

  onResult(worker, msg) {
    if (msg.type !== 'chunk') return;
    const p = this.pending.get(msg.jobId);
    this.pending.delete(msg.jobId);
    this.idle.push(worker);
    this.pump();
    if (p) p.resolve({ blocks: msg.blocks, heightMap: msg.heightMap, biomeMap: msg.biomeMap, entities: msg.entities });
  }

  // Drop queued jobs that are no longer wanted (e.g. player moved away).
  // Dropped jobs resolve to null so their callers can forget the chunk and
  // request it again later.
  prune(keepFn) {
    const keep = [];
    for (const j of this.queue) {
      if (keepFn(j.cx, j.cz)) keep.push(j);
      else j.resolve(null);
    }
    this.queue = keep;
  }

  dispose() {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.queue = [];
  }
}
