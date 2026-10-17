// The world's clock: seconds of game time since the world began (it runs
// while you play, and jumps when you sleep). Game keeps `now` up to date and
// saves it; anything that needs "how long ago" (an animal's birth, a crop's
// last tick in a saved chunk) reads it from here.
export const worldClock = { now: 0 };
