export const HEAT_LEVELS = 10;

export interface LineHeat {
  hot: boolean;
  level: number;
}

const DAY = 86400;

// Hot lines changed within the threshold, cold ones before it. Within each side the level runs from 0 (the newest
// change in the file) to HEAT_LEVELS - 1 (the oldest), by rank among the file's distinct change times, so a file
// whose history spans a week and one that spans ten years both use the whole range.
export class HeatmapScale {
  static compute(lineTimes: number[], now: number, coldThresholdDays: number): LineHeat[] {
    const threshold = now - coldThresholdDays * DAY;
    const hotTimes = HeatmapScale.collectDistinct(lineTimes.filter((time) => time >= threshold));
    const coldTimes = HeatmapScale.collectDistinct(lineTimes.filter((time) => time < threshold));

    return lineTimes.map((time) => {
      const hot = time >= threshold;
      const times = hot ? hotTimes : coldTimes;
      const rank = times.indexOf(time);
      const level = times.length <= 1 ? 0 : Math.round((rank / (times.length - 1)) * (HEAT_LEVELS - 1));
      return { hot, level };
    });
  }

  private static collectDistinct(times: number[]): number[] {
    return Array.from(new Set(times)).sort((left, right) => right - left);
  }

  // Newer lines are brighter: level 0 gets the full strength, the oldest a fifth of it.
  static getOpacity(level: number): number {
    return 1 - (level / (HEAT_LEVELS - 1)) * 0.8;
  }
}
