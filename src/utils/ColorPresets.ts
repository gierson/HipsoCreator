export type FalloffType = 'smooth' | 'linear' | 'sharp';

export interface ColorPreset {
  name: string;
  colors: string[];
}

export const COLOR_PRESETS: Record<string, ColorPreset> = {
  classic: {
    name: 'Klasyczny',
    colors: ['#2D6A4F', '#40916C', '#52B788', '#B7E4C7', '#FEFAE0', '#DDA15E', '#BC6C25', '#9B2226'],
  },
  bathymetric: {
    name: 'Batymetryczny',
    colors: ['#03045E', '#023E8A', '#0077B6', '#00B4D8', '#48CAE4', '#90E0EF', '#ADE8F4', '#CAF0F8'],
  },
  mono: {
    name: 'Mono',
    colors: ['#1a1a2e', '#2a2a4e', '#3a3a5e', '#5a5a8e', '#7a7aae', '#9a9ace', '#babaf0', '#dadaff'],
  },
  earth: {
    name: 'Ziemisty',
    colors: ['#3d2b1f', '#5c3a2b', '#6b4226', '#8b5e3c', '#a0522d', '#b87a4b', '#c9a96e', '#f5f0e1'],
  },
};

/** Interpolate a preset palette to any number of layers */
export function interpolateColors(presetKey: string, count: number): string[] {
  const preset = COLOR_PRESETS[presetKey];
  if (!preset) return Array(count).fill('#888888');
  const src = preset.colors;

  if (count === src.length) return [...src];

  const result: string[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1);
    const srcIdx = t * (src.length - 1);
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, src.length - 1);
    const frac = srcIdx - lo;
    result.push(lerpColor(src[lo], src[hi], frac));
  }
  return result;
}

function lerpColor(a: string, b: string, t: number): string {
  const ar = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`;
}
