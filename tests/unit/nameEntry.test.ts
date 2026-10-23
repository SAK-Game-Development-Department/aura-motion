import { describe, expect, it } from 'vitest';
import { applyModifier } from '../../src/ui/nameEntry';
import { checkName, nameKey, normalizeName } from '../../src/exhibit/playerName';

describe('name entry', () => {
  it('゛ ゜ 小 modify the last kana (and toggle back)', () => {
    expect(applyModifier('タカ', '゛')).toBe('タガ');
    expect(applyModifier('タガ', '゛')).toBe('タカ');
    expect(applyModifier('ハ', '゜')).toBe('パ');
    expect(applyModifier('バ', '゜')).toBe('パ');
    expect(applyModifier('ツ', '小')).toBe('ッ');
    expect(applyModifier('ッ', '小')).toBe('ツ');
    expect(applyModifier('', '゛')).toBe('');
    expect(applyModifier('A', '゛')).toBe('A');
  });

  it('names are normalized and the same player is matched across kana/width/case', () => {
    expect(normalizeName('  ﾀﾂﾔ  ')).toBe('タツヤ');
    expect(nameKey('たつや')).toBe(nameKey('タツヤ'));
    expect(nameKey('Ａｂｃ')).toBe(nameKey('abc'));
  });

  it('length, characters and bad words are checked', () => {
    expect(checkName('タツヤ')).toBeNull();
    expect(checkName('')).not.toBeNull();
    expect(checkName('アイウエオカキクケ')).not.toBeNull();
    expect(checkName('<b>')).not.toBeNull();
    expect(checkName('バカ')).not.toBeNull();
    expect(checkName('ばか')).not.toBeNull();
  });
});
