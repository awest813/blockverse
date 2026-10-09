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
    const { blocks, heightMap, biomeMap, entities } = gen.generateChunk(cx, cz);
    self.postMessage(
      { type: 'chunk', jobId, cx, cz, blocks, heightMap, biomeMap, entities },
      [blocks.buffer, heightMap.buffer, biomeMap.buffer],
    );
  }
};
