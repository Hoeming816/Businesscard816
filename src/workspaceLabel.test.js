import { describe, expect, it } from 'vitest';
import { switcherLabel, workspaceLabel } from './workspaceLabel.js';

const own = { name: "Ana Cruz's cards", owner_id: 'u1' };
const other = { name: "Hoe Ming Wong's cards", owner_id: 'u9' };

describe('workspace labels', () => {
  it('never shows the owner name of a sign-up workspace', () => {
    expect(workspaceLabel(own, 'u1')).toBe('My cards');
    expect(workspaceLabel(other, 'u1')).toBe('Team cards');
    expect(switcherLabel(other, 'u1', 1)).toBe('My cards');
  });
  it('keeps names people chose', () => {
    expect(workspaceLabel({ name: 'Aspencom Sales', owner_id: 'u9' }, 'u1')).toBe('Aspencom Sales');
  });
});
