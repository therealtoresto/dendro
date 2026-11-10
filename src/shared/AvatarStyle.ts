// The pattern's grid: 5×5 cells inside the circle a 20×20 picture is clipped to.
const ART_GRID = 5;
// Centers the grid: (20 − (4 × 2.85 + 2.5)) / 2; its corners stay inside the circle.
const ART_START = 3.05;
const ART_STEP = 2.85;
const ART_CELL = 2.5;

export class AvatarStyle {
  // A picture for someone without one, drawn from a hash of the email: a mirrored 5×5 pattern in two shades of
  // the person's hue over a darker ground, with a glow of a neighbouring hue. The same email always gets the same
  // picture, in every view. `round` clips it to a circle, for places that cannot round it with CSS.
  static renderArt(email: string, round = false): string {
    const key = `${email.trim().toLowerCase()}|${round}`;
    const cached = AvatarStyle.artCache.get(key);
    if (cached) {
      return cached;
    }

    const first = AvatarStyle.hashText(key);
    const second = AvatarStyle.hashText(`${key}|cells`);
    const hue = first % 360;
    const accentHue = (hue + 30 + ((first >>> 9) % 90)) % 360;
    const shades = [`hsl(${hue} 80% 72%)`, `hsl(${accentHue} 75% 62%)`];
    const glowX = (first >>> 17) % 2 === 0 ? 3 : 17;

    let cells = '';
    let filled = 0;
    for (let row = 0; row < ART_GRID; row++) {
      for (let column = 0; column < Math.ceil(ART_GRID / 2); column++) {
        const bits = (second >>> ((row * 3 + column) * 2)) & 3;
        const isCenterColumn = column === Math.floor(ART_GRID / 2);
        if (bits === 0 && !(filled === 0 && isCenterColumn && row === ART_GRID - 1)) {
          continue;
        }
        filled++;
        const fill = shades[bits === 3 ? 1 : 0];
        for (const mirrored of new Set([column, ART_GRID - 1 - column])) {
          const x = ART_START + mirrored * ART_STEP;
          const y = ART_START + row * ART_STEP;
          cells += `<rect x="${x}" y="${y}" width="${ART_CELL}" height="${ART_CELL}" rx="0.6" fill="${fill}"/>`;
        }
      }
    }

    const body =
      `<rect width="20" height="20" fill="hsl(${hue} 40% 23%)"/>` +
      `<circle cx="${glowX}" cy="2" r="12" fill="hsl(${accentHue} 65% 45%)" opacity="0.45"/>` +
      cells;
    const content = round ? `<clipPath id="c"><circle cx="10" cy="10" r="10"/></clipPath><g clip-path="url(#c)">${body}</g>` : body;
    const art = `<svg class="avatar-art" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true">${content}</svg>`;
    AvatarStyle.artCache.set(key, art);
    return art;
  }

  private static readonly artCache = new Map<string, string>();

  // FNV-1a: small, fast and spreads similar emails far apart.
  private static hashText(text: string): number {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  }

  // The same person keeps the same color everywhere: graph rows, details, blame annotations.
  static getColor(email: string): string {
    let hash = 0;
    for (let index = 0; index < email.length; index++) {
      hash = (hash * 31 + email.charCodeAt(index)) | 0;
    }
    return `hsl(${Math.abs(hash) % 360} 45% 42%)`;
  }
}
