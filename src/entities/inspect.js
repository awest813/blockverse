// What the inspect card says about an animal (sneak and look at it): who it
// is, whose, its age and health, when it can breed, and what makes it itself.

import { itemInfo } from '../items/items.js';
import { worldClock } from '../core/clock.js';
import { DAY_LENGTH_SECONDS } from '../core/constants.js';
import { moodRate, moodWord } from '../world/ranch.js';

const WOOL = new Map([[0xf2f0ea, 'white'], [0xe8dcc0, 'cream'], [0xb8b6b0, 'grey']]);
const secs = (s) => (s >= 90 ? `${Math.round(s / 60)} min` : `${Math.max(1, Math.round(s))} s`);
const cap = (t) => t[0].toUpperCase() + t.slice(1);

export function describeAnimal(m) {
  const species = cap(m.petName ?? m.label ?? m.kind);
  const title = m.name ? `${m.name} (${species.toLowerCase()})` : species;
  const lines = [];
  lines.push(m.tamed ? 'Your pet' + (m.sitting ? ' — sitting' : '') : m.owned ? 'Your ' + (m.label ?? m.kind) : m.persistent ? 'Yours' : 'Wild');
  // age
  if (m.baby) lines.push(`Young — grows up in ${secs(m.grow ?? 0)}`);
  else if (Number.isFinite(m.born)) {
    const days = (worldClock.now - m.born) / DAY_LENGTH_SECONDS;
    lines.push(days < 1 ? 'Born today' : `Born ${Math.floor(days)} day${days >= 2 ? 's' : ''} ago`);
  }
  if (m.parents) lines.push('Bred on your ranch');
  const max = m.tamed ? m.maxTamedHealth ?? m.maxHealth : m.maxHealth;
  if (Number.isFinite(m.health)) lines.push(`Health ${Math.ceil(m.health)}${Number.isFinite(max) ? ` / ${max}` : ''}`);
  // its pen and how it feels about it
  if (m.breedItem && !m.tamed) {
    if (m.pen && m.moodWhy) {
      lines.push(`Home: a pen of ${m.pen.size} blocks, ${m.pen.animals} animal${m.pen.animals === 1 ? '' : 's'}`);
      lines.push(`${moodWord(m.mood)} — ${m.moodWhy.join(', ')}`);
    } else if (m.home && m.persistent) {
      const d = Math.round(Math.hypot(m.home.x + 0.5 - m.x, m.home.z + 0.5 - m.z));
      lines.push(d > 3 ? `Strayed from its pen (${d} blocks away)` : 'Out of its pen');
    } else if (m.persistent) lines.push('Roaming free');
  }
  // breeding
  if (m.breedItem && !m.tamed) {
    if (m.baby) { /* (too young) */ }
    else if (m.unhappy?.()) lines.push('Too unhappy to breed');
    else if (m.love > 0) lines.push('In love: bring it another of its kind');
    else if ((m.breedCooldown ?? 0) > 0) lines.push(`Can breed again in ${secs(m.breedCooldown)}`);
    else lines.push(`Ready to breed — eats ${itemInfo(m.breedItem)?.display.toLowerCase() ?? 'its food'}`);
  }
  // what makes it itself
  if (m.rideable) {
    lines.push(`Speed ${m.gallop.toFixed(1)} m/s · jump ${(m.jumpV * m.jumpV / 52).toFixed(1)} blocks`);
    if (!m.owned) lines.push(`Trust ${Math.round(m.temper ?? 0)}%`);
    else lines.push(m.saddled ? 'Saddled' : 'No saddle');
  }
  if (m.kind === 'sheep') {
    const wool = WOOL.get(m.woolTint) ?? 'dyed';
    lines.push(m.sheared ? `Shorn — wool grows back in ${secs((m.regrow ?? 0) / moodRate(m))}` : `Fleece: ${wool}`);
  }
  if (m.kind === 'chicken' && !m.baby && Number.isFinite(m.eggTimer)) lines.push(`Next egg in about ${secs(m.eggTimer / moodRate(m))}`);
  if (Number.isFinite(m.milkAt) && (m.kind === 'cow' || m.kind === 'goat')) {
    const left = m.milkAt - worldClock.now;
    lines.push(left > 0 ? `Milk again in ${secs(left)}` : 'Ready to milk');
  }
  return { title, lines };
}
