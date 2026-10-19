// Terrain generation worker: receives chunk coordinates, returns block data.

import { makeGen } from '../world/dimensions.js';

let gen = null;

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    gen = makeGen(msg.seed, msg.version, msg.dimension);   // the overworld's or the Scorchlands' terrain
    return;
  }
  if (msg.type === 'gen') {
    const { cx, cz, jobId } = msg;
    let out;
    try {
      out = gen.generateChunk(cx, cz);
    } catch (err) {
      // report it so the pool frees this worker instead of waiting forever
      self.postMessage({ type: 'chunk', jobId, cx, cz, error: String(err?.stack ?? err) });
      return;
    }
    const { blocks, heightMap, biomeMap, entities, meta = null } = out;
    self.postMessage(
      { type: 'chunk', jobId, cx, cz, blocks, heightMap, biomeMap, entities, meta },
      meta ? [blocks.buffer, heightMap.buffer, biomeMap.buffer, meta.buffer] : [blocks.buffer, heightMap.buffer, biomeMap.buffer],
    );
  }
};
