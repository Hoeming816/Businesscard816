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

import { canEditInteraction } from './perms.js';

describe('meetings without a contact', () => {
  it('belong only to whoever recorded them', () => {
    const i = { contact_id: null, created_by: 'u1' };
    expect(canEditInteraction(i, null, 'viewer', 'u1')).toBe(true);
    expect(canEditInteraction(i, null, 'admin', 'u2')).toBe(false);
  });
  it('with a contact follow the card owner', () => {
    const c = { created_by: 'u1' };
    expect(canEditInteraction({ contact_id: 'c' }, c, 'editor', 'u1')).toBe(true);
    expect(canEditInteraction({ contact_id: 'c' }, c, 'editor', 'u2')).toBe(false);
    expect(canEditInteraction({ contact_id: 'c' }, undefined, 'editor', 'u1')).toBe(false);
  });
});
