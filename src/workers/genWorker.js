// Terrain generation worker: receives chunk coordinates, returns block data.

import { WorldGen } from '../world/worldgen.js';

let gen = null;

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    gen = new WorldGen(msg.seed, msg.version);
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
    const { blocks, heightMap, biomeMap, entities } = out;
    self.postMessage(
      { type: 'chunk', jobId, cx, cz, blocks, heightMap, biomeMap, entities },
      [blocks.buffer, heightMap.buffer, biomeMap.buffer],
    );
  }
};
