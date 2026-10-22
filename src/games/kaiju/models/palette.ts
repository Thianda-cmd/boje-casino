import type { KaijuId } from '../types'

/*
  The eight kaiju's colours, shared by the 3D models (models/*.ts), the SVG portraits (portraits.tsx) and the lobby
  cover (cover.tsx), so a kaiju looks the same everywhere. body / accent / glow are the roster's colours (rules.ts
  ROSTER); the rest are the extra tones each design needs (a darker body for the shaded side and the stripes, claws and
  teeth, moss, wing bands ...). Plain data, no three.js, so the page can import it without the 3D bundle.
*/

export interface KaijuColors {
  /** the main skin, fur, shell or plating */
  body: string
  /** the belly, face, underside or trim */
  accent: string
  /** what glows: eyes, plates, scars, cracks, coils, eyespots */
  glow: string
  /** the body a good deal darker: shaded sides, stripes, the far limbs in a portrait */
  dark: string
  /** a light tone for highlights, teeth and claws */
  light: string
  /** one more tone the design uses (moss, wing bands, hazard paint, suckers, fins ...) */
  extra: string
}

export const COLORS: Record<KaijuId, KaijuColors> = {
  rexor: { body: '#2f6b4f', accent: '#a9c99a', glow: '#5fe0ff', dark: '#1d4634', light: '#f3efd8', extra: '#3f8462' },
  gorrath: { body: '#4a3a35', accent: '#b98b6e', glow: '#ff8a3d', dark: '#2e2320', light: '#f1e6d6', extra: '#5e4a43' },
  titan: { body: '#8a97a8', accent: '#3a4656', glow: '#ff3b4f', dark: '#5f6b7c', light: '#dfe6ef', extra: '#f7c548' },
  kraka: { body: '#7b3f9e', accent: '#e7a0d4', glow: '#b06bff', dark: '#542a70', light: '#fbe3f3', extra: '#2a1238' },
  lumina: { body: '#d9b45a', accent: '#f6e7b0', glow: '#ffe36b', dark: '#8a6a2a', light: '#fffaf0', extra: '#4a3418' },
  pincer: { body: '#d0482f', accent: '#f2b39a', glow: '#ffb04f', dark: '#8f2c1c', light: '#fff1e8', extra: '#5a1c12' },
  bedrock: { body: '#6b6358', accent: '#a39a8a', glow: '#ff7a2f', dark: '#4a443c', light: '#cfc6b4', extra: '#6fa443' },
  voltra: { body: '#1f5e8c', accent: '#9fd8ff', glow: '#7df9ff', dark: '#143e5e', light: '#eaf7ff', extra: '#2f86b8' },
}

/** the ink every outline is drawn in, models and portraits alike: a deep night navy */
export const INK = '#0b1020'
