import type { AppleColor, ApplePattern } from '../tuning.ts';

const COLOR_WORDS: Record<AppleColor, string[]> = {
  Red: ['Crimson', 'Ruby', 'Scarlet'],
  Green: ['Emerald', 'Green', 'Jade'],
  Yellow: ['Golden', 'Amber', 'Sunny'],
  Purple: ['Violet', 'Royal', 'Purple'],
};

const STAT_WORDS = {
  sweetness: ['Sweet', 'Honey', 'Sugar'],
  size: ['Giant', 'Big', 'Colossal'],
  yieldStat: ['Bounty', 'Plenty', 'Prolific'],
};

const PATTERN_WORDS: Record<ApplePattern, string[]> = {
  Plain: [],
  Speckled: ['Speckle', 'Dapple'],
  Striped: ['Stripe', 'Ribbon'],
};

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateVarietyName(traits: {
  color: AppleColor;
  pattern: ApplePattern;
  sweetness: number;
  size: number;
  yieldStat: number;
}): string {
  const adjective = pick(COLOR_WORDS[traits.color]);

  const patternWords = PATTERN_WORDS[traits.pattern];
  const usePattern = patternWords.length > 0 && Math.random() < 0.45;

  let noun: string;
  if (usePattern) {
    noun = pick(patternWords);
  } else {
    const stats: Array<['sweetness' | 'size' | 'yieldStat', number]> = [
      ['sweetness', traits.sweetness],
      ['size', traits.size],
      ['yieldStat', traits.yieldStat],
    ];
    stats.sort((a, b) => b[1] - a[1]);
    const dominant = stats[0][0];
    noun = pick(STAT_WORDS[dominant]);
  }

  return `${adjective} ${noun}`.toUpperCase();
}
