import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { IncidentCounts } from '../../src/components/IncidentCounts';
import type { IncidentCounts as Counts } from '../../src/types';

// Spec 008 — HU-08: componente de presentación de los conteos por tipo. Solo muestra; no calcula.

const idle = { loading: false, error: null };

const populated: Counts = {
  total: 3,
  byType: [
    { rule: 'R-ZONA-01', title: 'No circular por zonas restringidas', count: 2 },
    { rule: 'R-SIGNAL-01', title: 'Posición no confiable o ausente', count: 1 },
    { rule: 'R-DATA-01', title: 'Información de zonas no disponible', count: 0 },
  ],
};

const empty: Counts = {
  total: 0,
  byType: [
    { rule: 'R-ZONA-01', title: 'No circular por zonas restringidas', count: 0 },
    { rule: 'R-SIGNAL-01', title: 'Posición no confiable o ausente', count: 0 },
    { rule: 'R-DATA-01', title: 'Información de zonas no disponible', count: 0 },
  ],
};

describe('IncidentCounts', () => {
  it('CA-08.6 renderiza los 3 títulos, sus números y el total', () => {
    render(<IncidentCounts counts={populated} status={idle} />);

    const zona = screen.getByTestId('count-R-ZONA-01');
    expect(zona).toHaveTextContent('No circular por zonas restringidas');
    expect(zona).toHaveTextContent('2');
    expect(screen.getByTestId('count-R-SIGNAL-01')).toHaveTextContent('1');
    expect(screen.getByTestId('count-R-DATA-01')).toHaveTextContent('0');
    expect(screen.getByTestId('count-total')).toHaveTextContent('3');
  });

  it('CA-08.8 con todo en 0 muestra 0 en cada tipo (no oculta categorías)', () => {
    render(<IncidentCounts counts={empty} status={idle} />);

    expect(screen.getByTestId('count-R-ZONA-01')).toHaveTextContent('0');
    expect(screen.getByTestId('count-R-SIGNAL-01')).toHaveTextContent('0');
    expect(screen.getByTestId('count-R-DATA-01')).toHaveTextContent('0');
    expect(screen.getByTestId('count-total')).toHaveTextContent('0');
  });
});
