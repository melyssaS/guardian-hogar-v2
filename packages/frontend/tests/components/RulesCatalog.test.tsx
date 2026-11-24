import { RULES } from '@home-guardian/domain';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RulesCatalog } from '../../src/components/RulesCatalog';

// Spec 001 — RC-12 (RF-06.3, CA-02.12)
describe('RulesCatalog', () => {
  it('muestra las tres reglas con id, título, descripción y HU', () => {
    render(<RulesCatalog />);
    for (const rule of RULES) {
      const card = screen.getByTestId(`rule-${rule.id}`);
      expect(card).toHaveTextContent(rule.id);
      expect(card).toHaveTextContent(rule.title);
      expect(card).toHaveTextContent(rule.description);
      for (const story of rule.stories) {
        expect(card).toHaveTextContent(story);
      }
    }
    expect(screen.getByText('R-ZONA-01', { exact: false })).toBeInTheDocument();
  });

  it('muestra la tarjeta «Fuera del MVP»', () => {
    render(<RulesCatalog />);
    expect(screen.getByText(/Fuera del MVP/i)).toBeInTheDocument();
  });

  it('no hace llamadas HTTP', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    render(<RulesCatalog />);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
