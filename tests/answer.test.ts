import { describe, expect, it } from 'vitest';
import { check, normalize } from '../src/answer';

describe('normalize', () => {
  it('drops punctuation, case and Spanish marks', () => {
    expect(normalize('¿Cómo estás?')).toBe('cómo estás');
    expect(normalize('  ¡Hola,  amigo!  ')).toBe('hola amigo');
  });
  it('unifies apostrophes', () => {
    expect(normalize('L’homme')).toBe(normalize("l'homme"));
    expect(normalize("j' ai")).toBe("j'ai");
  });
});

describe('check', () => {
  it('accepts the exact answer and any accepted variant', () => {
    expect(check('hablo', ['hablo'])).toMatchObject({ ok: true, verdict: 'exact' });
    expect(check('Tal vez', ['quizás', 'tal vez'])).toMatchObject({ ok: true, verdict: 'exact', best: 'tal vez' });
  });
  it('rejects empty input', () => {
    expect(check('  ', ['casa']).ok).toBe(false);
  });
  it('a missing accent is fine unless accents are strict', () => {
    expect(check('esta', ['está'])).toMatchObject({ ok: true, verdict: 'accent' });
    expect(check('esta', ['está'], { strictAccents: true })).toMatchObject({ ok: false, verdict: 'accent' });
  });
  it('in grammar, one accent is a different form', () => {
    expect(check('hablo', ['habló'], { strictForm: true }).ok).toBe(false);
    expect(check('habia', ['había'], { strictForm: true }).ok).toBe(false);
  });
  it('tolerates a typo in longer words only', () => {
    expect(check('biblioteka', ['biblioteca'])).toMatchObject({ ok: true, verdict: 'typo' });
    expect(check('la', ['el']).ok).toBe(false);
    expect(check('mesa', ['masa']).ok).toBe(false); // 4 letters: no tolerance
  });
  it('a word without its article is "partial", not right', () => {
    expect(check('casa', ['la casa'], { partial: ['casa'] })).toMatchObject({ ok: false, verdict: 'partial' });
  });
  it('a different word is wrong', () => {
    expect(check('perro', ['gato'])).toMatchObject({ ok: false, verdict: 'wrong' });
  });
});
