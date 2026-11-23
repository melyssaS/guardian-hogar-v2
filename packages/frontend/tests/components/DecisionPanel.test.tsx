import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DecisionPanel } from '../../src/components/DecisionPanel';
import type { MoveResponse } from '../../src/types';

// Spec 003 — RC-12 (RF-04.1..RF-04.3, CA-03.2, CA-03.4, CA-03.6): el panel muestra la respuesta
// del vigilante (spec 002) con su vocabulario, sin recalcular reglas ni inventar códigos.
const base = { robotId: 1, positionQuality: 'RELIABLE' } as const;

const authorized: MoveResponse = {
  ...base,
  decision: 'AUTHORIZED',
  state: 'IDLE',
  position: { x: 450, y: 120 },
};

const denied: MoveResponse = {
  ...base,
  decision: 'DENIED',
  code: 'TRAJECTORY_CROSSES_ZONE',
  state: 'SAFE_STOP',
  position: { x: 120, y: 90 },
  collisionType: 'TRAJECTORY_CROSSES_ZONE',
  incidentId: 7,
  rule: 'R-ZONA-01',
  zoneName: 'Escaleras',
  reason: 'Trajectory crosses restricted zone: Escaleras',
};

const rejected = (code: 'SAFE_STOP_ACTIVE' | 'BUSY'): MoveResponse => ({
  ...base,
  decision: 'REJECTED',
  code,
  state: code === 'BUSY' ? 'MOVING' : 'SAFE_STOP',
  position: { x: 120, y: 90 },
  reason: `Rejected: ${code}`,
});

describe('DecisionPanel', () => {
  it('sin decisión muestra el estado vacío', () => {
    render(<DecisionPanel result={null} />);
    expect(screen.getByText(/Aún no hay decisiones/)).toBeInTheDocument();
  });

  it('AUTHORIZED: muestra decisión, estado, posición y calidad de la API', () => {
    render(<DecisionPanel result={authorized} />);
    expect(screen.getByTestId('decision')).toHaveTextContent('AUTHORIZED');
    expect(screen.getByTestId('result-state')).toHaveTextContent('IDLE');
    expect(screen.getByTestId('result-position')).toHaveTextContent('(450, 120)');
    expect(screen.getByTestId('result-quality')).toHaveTextContent('RELIABLE');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('RF-04.2 DENIED: parada preventiva con code, zona e incidentId', () => {
    render(<DecisionPanel result={denied} />);
    expect(screen.getByTestId('decision')).toHaveTextContent('DENIED');
    const alert = screen.getByTestId('preventive-stop');
    expect(alert).toHaveTextContent('Parada preventiva');
    expect(alert).toHaveTextContent('TRAJECTORY_CROSSES_ZONE');
    expect(alert).toHaveTextContent('Escaleras');
    expect(alert).toHaveTextContent('Incidente #7');
    expect(screen.getByTestId('result-zone')).toHaveTextContent('Escaleras');
    expect(screen.getByTestId('result-state')).toHaveTextContent('SAFE_STOP');
    expect(screen.getByTestId('reason')).toHaveTextContent(
      'Trajectory crosses restricted zone: Escaleras',
    );
  });

  it('DENIED sin zona (denegación por datos): zona "—" y sin nombre inventado', () => {
    render(
      <DecisionPanel
        result={{
          ...denied,
          code: 'INSUFFICIENT_DATA',
          collisionType: null,
          zoneName: null,
          rule: 'R-DATA-01',
        }}
      />,
    );
    expect(screen.getByTestId('preventive-stop')).toHaveTextContent('INSUFFICIENT_DATA');
    expect(screen.getByTestId('result-zone')).toHaveTextContent('—');
  });

  it('RF-04.3 REJECTED SAFE_STOP_ACTIVE: muestra el rechazo con el code recibido', () => {
    render(<DecisionPanel result={rejected('SAFE_STOP_ACTIVE')} />);
    expect(screen.getByTestId('decision')).toHaveTextContent('REJECTED');
    expect(screen.getByTestId('rejected')).toHaveTextContent('SAFE_STOP_ACTIVE');
    expect(screen.queryByTestId('preventive-stop')).not.toBeInTheDocument();
  });

  it('RF-04.3 REJECTED BUSY: muestra BUSY y no inventa SAFE_STOP_ACTIVE', () => {
    render(<DecisionPanel result={rejected('BUSY')} />);
    const panel = screen.getByTestId('rejected');
    expect(panel).toHaveTextContent('BUSY');
    expect(panel).not.toHaveTextContent('SAFE_STOP_ACTIVE');
    expect(screen.getByTestId('result-state')).toHaveTextContent('MOVING');
  });

  it('REJECTED no muestra incidente (el rechazo no crea incidente)', () => {
    render(<DecisionPanel result={rejected('SAFE_STOP_ACTIVE')} />);
    expect(screen.queryByText(/Incidente #/)).not.toBeInTheDocument();
  });

  it('CA-03.6 no recalcula: muestra la respuesta aunque contradiga la geometría', () => {
    // Destino dentro de "Escaleras" del prototipo, pero la API dice AUTHORIZED: la UI lo respeta.
    const fromApi: MoveResponse = { ...authorized, position: { x: 100, y: 300 } };
    render(<DecisionPanel result={fromApi} />);
    expect(screen.getByTestId('decision')).toHaveTextContent('AUTHORIZED');
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
