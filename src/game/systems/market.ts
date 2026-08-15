import { COLORS, PATTERNS, TUNING } from '../tuning.ts';
import type { MarketModifiers } from '../types.ts';
import { getDayDef } from './calendar.ts';

const ALL_TRAITS = [...COLORS, ...PATTERNS] as const;

function generateMildMarket(): MarketModifiers {
  const shuffled = [...ALL_TRAITS].sort(() => Math.random() - 0.5);
  const count = 1 + Math.floor(Math.random() * 2); // 1-2 affected traits
  const modifiers: MarketModifiers = {};
  for (let i = 0; i < count; i++) {
    const trait = shuffled[i];
    const roll = TUNING.MARKET_MILD_MIN + Math.random() * (TUNING.MARKET_MILD_MAX - TUNING.MARKET_MILD_MIN);
    modifiers[trait] = Math.round(roll * 100) / 100;
  }
  return modifiers;
}

export function computeMarketForDay(day: number): MarketModifiers {
  const def = getDayDef(day);
  if (def?.scriptedMarket) return { ...def.scriptedMarket };
  return generateMildMarket();
}

export function describeTopModifier(modifiers: MarketModifiers): string | null {
  const entries = Object.entries(modifiers) as [string, number][];
  if (entries.length === 0) return null;
  entries.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const [trait, value] = entries[0];
  const pct = Math.round(value * 100);
  const sign = pct >= 0 ? '+' : '';
  return `${trait} ${sign}${pct}%`;
}
