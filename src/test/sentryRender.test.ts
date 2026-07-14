import { describe, it, expect } from 'vitest';
import {
  assigneeName,
  deriveSentryState,
  formatCount,
  levelEmoji,
} from '../providers/sentry/render';
import type { SentryIssue } from '../providers/sentry/api';

const base: SentryIssue = { id: '1', title: 'x' };

describe('deriveSentryState', () => {
  it('resolved', () => {
    expect(deriveSentryState({ ...base, status: 'resolved' })).toEqual({
      label: 'Resolved',
      kind: 'resolved',
    });
  });
  it('unresolved', () => {
    expect(deriveSentryState({ ...base, status: 'unresolved' })).toEqual({
      label: 'Unresolved',
      kind: 'unresolved',
    });
  });
  it('ignored maps to gray', () => {
    expect(deriveSentryState({ ...base, status: 'ignored' }).kind).toBe('closed-notplanned');
  });
  it('unknown status falls through', () => {
    expect(deriveSentryState({ ...base, status: 'weird' })).toEqual({
      label: 'weird',
      kind: 'unknown',
    });
  });
});

describe('formatCount', () => {
  it('formats small numbers', () => {
    expect(formatCount(42)).toBe('42');
    expect(formatCount('999')).toBe('999');
  });
  it('formats thousands', () => {
    expect(formatCount(1500)).toBe('1.5k');
    expect(formatCount(2000)).toBe('2k');
  });
  it('formats millions', () => {
    expect(formatCount(3_400_000)).toBe('3.4M');
  });
  it('handles undefined/NaN', () => {
    expect(formatCount(undefined)).toBe('0');
    expect(formatCount('abc')).toBe('0');
  });
});

describe('levelEmoji', () => {
  it('maps known levels', () => {
    expect(levelEmoji('error')).not.toBe('');
    expect(levelEmoji('warning')).not.toBe('');
  });
  it('is case-insensitive', () => {
    expect(levelEmoji('ERROR')).toBe(levelEmoji('error'));
  });
  it('returns empty for unknown/missing', () => {
    expect(levelEmoji('nope')).toBe('');
    expect(levelEmoji(undefined)).toBe('');
  });
});

describe('assigneeName', () => {
  it('prefers name over email', () => {
    expect(assigneeName({ ...base, assignedTo: { name: 'Jane', email: 'j@x.com' } })).toBe('Jane');
  });
  it('falls back to email', () => {
    expect(assigneeName({ ...base, assignedTo: { email: 'j@x.com' } })).toBe('j@x.com');
  });
  it('returns empty when unassigned', () => {
    expect(assigneeName({ ...base, assignedTo: null })).toBe('');
  });
});
