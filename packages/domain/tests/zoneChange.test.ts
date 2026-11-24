import { describe, expect, it } from 'vitest';
import { classifyZoneUpdate } from '../src/index.js';
import type { Zone } from '../src/index.js';

// Spec 001 — RC-3 (RF-05.3, DD-013)
const base: Zone = {
  id: 1,
  name: 'Escaleras',
  x: 100,
  y: 100,
  width: 200,
  height: 150,
  active: true,
  createdAt: '2025-01-01T00:00:00.000Z',
};

describe('classifyZoneUpdate (RF-05.3)', () => {
  it('solo active false→true = ACTIVATE', () => {
    const before: Zone = { ...base, active: false };
    const after: Zone = { ...base, active: true };
    expect(classifyZoneUpdate(before, after)).toBe('ACTIVATE');
  });

  it('solo active true→false = DEACTIVATE', () => {
    const before: Zone = { ...base, active: true };
    const after: Zone = { ...base, active: false };
    expect(classifyZoneUpdate(before, after)).toBe('DEACTIVATE');
  });

  it('otro campo sin tocar active = UPDATE', () => {
    expect(classifyZoneUpdate(base, { ...base, width: 50 })).toBe('UPDATE');
  });

  it('otro campo junto con active = UPDATE', () => {
    const before: Zone = { ...base, active: false };
    const after: Zone = { ...base, active: true, width: 50 };
    expect(classifyZoneUpdate(before, after)).toBe('UPDATE');
  });

  it('sin cambios = null', () => {
    expect(classifyZoneUpdate(base, { ...base })).toBeNull();
  });

  it('ignora diferencias de id y createdAt (no son datos editables)', () => {
    const after: Zone = { ...base, id: 99, createdAt: '2030-01-01T00:00:00.000Z' };
    expect(classifyZoneUpdate(base, after)).toBeNull();
  });
});
