// Pool of terrain-generation workers with a job queue.

import { WorldGen } from './worldgen.js';

export class GenPool {
  constructor(seed, version, size = Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) - 2))) {
    this.workers = [];
    this.queue = [];          // [{cx, cz, resolve}]
    this.pending = new Map(); // jobId -> {job, worker}
    this.nextJob = 1;
    this.idle = [];
    this.seed = seed;
    this.version = version;
    this.local = null;        // main-thread generator, once no worker is left

    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL('../workers/genWorker.js', import.meta.url), { type: 'module' });
      w.postMessage({ type: 'init', seed, version });
      w.onmessage = (e) => this.onResult(w, e.data);
      // a worker that can't load (e.g. a tab left open across a redeploy,
      // whose old worker file is gone) or that crashed: drop it
      w.onerror = (e) => {
        console.error('[genWorker] error:', e.message ? `${e.message} (${e.filename}:${e.lineno})` : 'the worker script failed to load');
        e.preventDefault?.();
        this.retire(w);
      };
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
    if (!this.workers.length) { this.pumpLocal(); return; }
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop();
      const job = this.queue.shift();
      const jobId = this.nextJob++;
      this.pending.set(jobId, { job, worker: w });
      w.postMessage({ type: 'gen', cx: job.cx, cz: job.cz, jobId });
    }
  }

  onResult(worker, msg) {
    if (msg.type !== 'chunk') return;
    const p = this.pending.get(msg.jobId);
    this.pending.delete(msg.jobId);
    this.idle.push(worker);
    this.pump();
    if (!p) return;
    if (msg.error) {
      // try it once more here rather than leave a hole in the world
      console.error('[genWorker] chunk failed:', msg.error);
      p.job.resolve(this.generateLocal(p.job.cx, p.job.cz));
      return;
    }
    p.job.resolve({ blocks: msg.blocks, heightMap: msg.heightMap, biomeMap: msg.biomeMap, entities: msg.entities });
  }

  retire(worker) {
    if (!this.workers.includes(worker)) return;
    worker.terminate();
    this.workers = this.workers.filter((w) => w !== worker);
    this.idle = this.idle.filter((w) => w !== worker);
    // its unfinished jobs go back to the front of the queue
    for (const [id, p] of this.pending) {
      if (p.worker === worker) { this.pending.delete(id); this.queue.unshift(p.job); }
    }
    if (!this.workers.length) console.warn('[genPool] no terrain workers left; generating on the main thread');
    this.pump();
  }

  // Fallback with no workers: one chunk per task, so the game keeps running
  // (with some stutter) instead of waiting forever for terrain.
  pumpLocal() {
    if (this.localTimer || !this.queue.length) return;
    this.localTimer = setTimeout(() => {
      this.localTimer = 0;
      const job = this.queue.shift();
      if (job) job.resolve(this.generateLocal(job.cx, job.cz));
      this.pumpLocal();
    }, 0);
  }

  // null if it fails here too (the world asks for missing chunks again later)
  generateLocal(cx, cz) {
    try {
      this.local ??= new WorldGen(this.seed, this.version);
      return this.local.generateChunk(cx, cz);
    } catch (err) {
      console.error('[genPool] chunk failed:', err);
      return null;
    }
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
    clearTimeout(this.localTimer);
    this.localTimer = 0;
    this.queue = [];
  }
}
