// World dimensions
export const CHUNK_X = 16;
export const CHUNK_Y = 128;
export const CHUNK_Z = 16;
export const CHUNK_AREA = CHUNK_X * CHUNK_Z;
export const CHUNK_VOLUME = CHUNK_X * CHUNK_Y * CHUNK_Z;

export const SEA_LEVEL = 42;
export const MAX_LIGHT = 15;

// Index of a block inside a chunk's flat arrays. x,z in [0,16), y in [0,128).
// Layout: y-major columns would thrash cache during column scans; we use
// (x, z, y) -> ((x * CHUNK_Z + z) * CHUNK_Y + y) so vertical scans are contiguous.
export function blockIndex(x, y, z) {
  return (x * CHUNK_Z + z) * CHUNK_Y + y;
}

export const DAY_LENGTH_SECONDS = 20 * 60; // one full day-night cycle

// Player physics
export const PLAYER_WIDTH = 0.6;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_EYE = 1.62;

export const GRAVITY = 28;         // blocks / s^2
export const JUMP_SPEED = 8.8;     // initial jump velocity
export const WALK_SPEED = 4.3;
export const SPRINT_SPEED = 5.9;
export const SNEAK_SPEED = 1.6;
export const FLY_SPEED = 11;
export const SWIM_SPEED = 2.6;

export const REACH_DISTANCE = 5;   // block interaction range

export const GAMEMODE_SURVIVAL = 0;
export const GAMEMODE_CREATIVE = 1;
