import { describe, expect, it } from 'vitest';
import { audioParts, joinAudioParts } from './recordingParts.js';
import { recordedAt } from './minutes.js';

describe('recording parts', () => {
  it('reads one path as before, and several parts in order', () => {
    expect(audioParts({ audio_path: 'w/c/i-1.webm' })).toEqual(['w/c/i-1.webm']);
    expect(audioParts({ audio_path: null })).toEqual([]);
    const joined = joinAudioParts(['w/c/i-1700000000000.webm', 'w/c/i-p2-1700000001200.webm']);
    expect(audioParts({ audio_path: joined })).toEqual(['w/c/i-1700000000000.webm', 'w/c/i-p2-1700000001200.webm']);
    expect(joinAudioParts([])).toBe(null);
  });
  it('dates a long recording by its last part', () => {
    const i = { audio_path: joinAudioParts(['w/c/i-1700000000000.webm', 'w/c/i-p2-1700000001200.webm']), created_at: '2020-01-01T00:00:00Z' };
    expect(recordedAt(i).getTime()).toBe(1700000001200);
  });
});
