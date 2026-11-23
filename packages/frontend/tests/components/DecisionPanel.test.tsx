import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DecisionPanel } from '../../src/components/DecisionPanel';
import type { MoveResult } from '../../src/types';

// Spec 003 — RF-04.1..RF-04.3, CA-03.6
describe('DecisionPanel', () => {
  it('sin decisión muestra el estado vacío', () => {
    render(<DecisionPanel result={null} />);
    expect(screen.getByText(/Aún no hay decisiones/)).toBeInTheDocument();
  });

  it('ALLOW: muestra decisión, estado, posición y motivo de la API', () => {
    render(
      <DecisionPanel
        result={{
          decision: 'ALLOW',
          state: 'MOVING',
          position: { x: 450, y: 120 },
          reason: 'Destination and trajectory are clear',
        }}
      />,
    );
    expect(screen.getByTestId('decision')).toHaveTextContent('ALLOW');
    expect(screen.getByTestId('result-state')).toHaveTextContent('MOVING');
    expect(screen.getByTestId('result-position')).toHaveTextContent('(450, 120)');
    expect(screen.getByTestId('reason')).toHaveTextContent('Destination and trajectory are clear');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('RF-04.2 PREVENTIVE_STOP: indica parada preventiva, causa y zona', () => {
    render(
      <DecisionPanel
        result={{
          decision: 'PREVENTIVE_STOP',
          state: 'SAFE_STOP',
          position: { x: 120, y: 90 },
          collisionType: 'TRAJECTORY_CROSSES_ZONE',
          zoneName: 'Escaleras',
          reason: 'Trajectory crosses restricted zone: Escaleras',
        }}
      />,
    );
    expect(screen.getByTestId('decision')).toHaveTextContent('PARADA PREVENTIVA');
    const alert = screen.getByTestId('preventive-stop');
    expect(alert).toHaveTextContent('Parada preventiva');
    expect(alert).toHaveTextContent('La trayectoria cruza una zona restringida');
    expect(alert).toHaveTextContent('Escaleras');
  });

  it('RF-04.3 DENIED_SAFE_STOP: muestra la denegación SAFE_STOP_ACTIVE', () => {
    render(
      <DecisionPanel
        result={{
          decision: 'DENIED_SAFE_STOP',
          code: 'SAFE_STOP_ACTIVE',
          state: 'SAFE_STOP',
          position: { x: 120, y: 90 },
          reason: 'Robot is in SAFE_STOP; movement denied',
        }}
      />,
    );
    expect(screen.getByTestId('decision')).toHaveTextContent('SAFE_STOP_ACTIVE');
    expect(screen.getByTestId('denied')).toHaveTextContent('SAFE_STOP_ACTIVE');
  });

  it('CA-03.6 no recalcula: muestra la respuesta aunque contradiga la geometría', () => {
    // Destino dentro de "Escaleras" del prototipo, pero la API dice ALLOW: la UI lo respeta.
    const fromApi: MoveResult = {
      decision: 'ALLOW',
      state: 'MOVING',
      position: { x: 100, y: 300 },
      reason: 'server says so',
    };
    render(<DecisionPanel result={fromApi} />);
    expect(screen.getByTestId('decision')).toHaveTextContent('ALLOW');
    expect(screen.getByTestId('result-position')).toHaveTextContent('(100, 300)');
    expect(screen.getByLabelText('Respuesta JSON de la API').textContent).toBe(
      JSON.stringify(fromApi, null, 2),
    );
  });
});

describe('RF-02.3 la UI no replica la lógica de reglas', () => {
  const sources = import.meta.glob('../../src/**/*.{ts,tsx}', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>;

  it('ningún archivo del frontend usa las funciones de colisión del dominio', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(5);
    for (const [file, code] of Object.entries(sources)) {
      expect(code, file).not.toMatch(
        /\b(isCollision|segmentIntersectsAABB|pointInAABB|expandZone|decideMovement)\b/,
      );
    }
  });
});
