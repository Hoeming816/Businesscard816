import { describe, expect, it } from 'vitest';
import { FEATURES, featureOn } from './features.js';

describe('featureOn', () => {
  it('is on unless switched off', () => {
    expect(featureOn({ features: {} }, 'share')).toBe(true);
    expect(featureOn({}, 'share')).toBe(true);
    expect(featureOn(null, 'share')).toBe(true);
    expect(featureOn({ features: { share: false } }, 'share')).toBe(false);
    expect(featureOn({ features: { share: true } }, 'share')).toBe(true);
  });
  it('lists the keys the server enforces', () => {
    expect(FEATURES.map((f) => f.key)).toEqual(['scan_ai', 'share', 'recording', 'ai_minutes', 'minutes_tab']);
  });
});
