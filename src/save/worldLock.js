// One tab per world: two tabs playing the same world would each save over
// the other's changes. A Web Lock is held for as long as a world is open
// (released automatically if the tab closes or crashes).

const lockName = (id) => `blockverse-world:${id}`;

// Resolves to a release function, or null if another tab holds the world.
export function acquireWorldLock(id) {
  if (!navigator.locks) return Promise.resolve(() => {});   // no Web Locks: carry on unguarded
  return new Promise((resolve) => {
    navigator.locks.request(lockName(id), { ifAvailable: true }, (lock) => {
      if (!lock) { resolve(null); return undefined; }
      return new Promise((release) => resolve(release));
    }).catch(() => resolve(() => {}));
  });
}

// Is this world open in another tab right now?
export async function worldOpenElsewhere(id) {
  if (!navigator.locks?.query) return false;
  try {
    const { held } = await navigator.locks.query();
    return held.some((l) => l.name === lockName(id));
  } catch { return false; }
}
