// What makes each farm animal its own: a trait or two per species, rolled
// when it's first met, passed on to its young (one parent's, or between the
// two, give or take a little), and shown on its card.
//
//   cow, goat  milk    how soon it gives milk again (×)
//   goat       temper  how ready it is to charge (×)
//   chicken    laying  how often it lays (×)
//   sheep      fleece  how much wool a shearing gives (1-3)
//   pig        litter  the chance of twins (1-2)
//
// Horses and camels keep their own (gallop, jump, health, coat).

const TRAITS = {
  cow: { milk: [0.7, 1.5] },
  goat: { milk: [0.7, 1.5], temper: [0.3, 1.7] },
  chicken: { laying: [0.7, 1.5] },
  sheep: { fleece: [1, 3] },
  pig: { litter: [1, 2] },
};

// how it reads on the card, from the bottom of its range to the top
const WORDS = {
  milk: ['thin', 'fair', 'good', 'rich'],
  temper: ['placid', 'calm', 'spirited', 'fiery'],
  laying: ['slow', 'fair', 'good', 'prolific'],
  fleece: ['thin', 'fair', 'thick', 'luxuriant'],
  litter: ['small', 'fair', 'good', 'large'],
};
const NAMES = { milk: 'Milk', temper: 'Temper', laying: 'Laying', fleece: 'Fleece', litter: 'Litters' };

const clamp = (v, [lo, hi]) => Math.max(lo, Math.min(hi, v));
// rolled in the middle of the range more often than at its ends
const roll = ([lo, hi]) => lo + ((Math.random() + Math.random()) / 2) * (hi - lo);

// the animal's traits (rolled the first time they're asked for)
export function traitsOf(m) {
  const spec = TRAITS[m.kind];
  if (!spec) return null;
  if (!m.traits) {
    m.traits = {};
    for (const [k, range] of Object.entries(spec)) m.traits[k] = roll(range);
  }
  return m.traits;
}

// one trait (1 if the species hasn't got it)
export function trait(m, key) {
  return traitsOf(m)?.[key] ?? 1;
}

// A youngster's: each trait one parent's (or between them), give or take a
// little; now and then one that's better than either.
export function inheritTraits(baby, a, b) {
  const spec = TRAITS[baby.kind];
  if (!spec) return;
  const ta = traitsOf(a), tb = traitsOf(b);
  baby.traits = {};
  for (const [k, range] of Object.entries(spec)) {
    const r = Math.random(), span = range[1] - range[0];
    let v = r < 0.35 ? ta[k] : r < 0.7 ? tb[k] : (ta[k] + tb[k]) / 2;
    v += (Math.random() - 0.5) * 0.15 * span;
    if (Math.random() < 0.04) v += 0.25 * span;   // a standout
    baby.traits[k] = clamp(v, range);
  }
}

// saved traits, checked (a species' own, finite, in range)
export function cleanTraits(kind, t) {
  const spec = TRAITS[kind];
  if (!spec || !t || typeof t !== 'object') return null;
  const out = {};
  for (const [k, range] of Object.entries(spec)) if (Number.isFinite(t[k])) out[k] = clamp(t[k], range);
  return Object.keys(out).length === Object.keys(spec).length ? out : null;
}

// the card's lines: "Milk: rich"
export function traitLines(m) {
  const t = traitsOf(m);
  if (!t) return [];
  return Object.entries(TRAITS[m.kind]).map(([k, [lo, hi]]) => {
    const q = Math.min(3, Math.floor(((t[k] - lo) / (hi - lo)) * 4));
    return `${NAMES[k]}: ${WORDS[k][q]}`;
  });
}
