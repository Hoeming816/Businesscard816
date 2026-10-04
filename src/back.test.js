import { describe, expect, it, vi } from 'vitest';
import { currentBack, pushBack } from './back.js';

describe('menu bar Back', () => {
  it('runs the most recently opened Back, and falls back when it closes', () => {
    const section = vi.fn();
    const meeting = vi.fn();
    expect(currentBack()).toBe(null);
    const offSection = pushBack({ run: section });
    const offMeeting = pushBack({ run: meeting });
    currentBack().run();
    expect(meeting).toHaveBeenCalledTimes(1);
    offMeeting();
    currentBack().run();
    expect(section).toHaveBeenCalledTimes(1);
    offSection();
    expect(currentBack()).toBe(null);
  });
});
