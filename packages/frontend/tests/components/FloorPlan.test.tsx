import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FloorPlan, type PlanRobot } from '../../src/components/FloorPlan';
import type { Zone } from '../../src/types';

const zone = (id: number, name: string, active: boolean): Zone => ({
  id,
  name,
  x: 29,
  y: 226,
  width: 160,
  height: 178,
  active,
  createdAt: '2025-01-01T00:00:00.000Z',
});

const shape = (id: number) => screen.getByTestId(`zone-${id}`).querySelector('rect');

describe('FloorPlan', () => {
  it('CA-01.1 dibuja el plano 1000×800 con origen arriba-izquierda y cuadrícula cada 100', () => {
    render(<FloorPlan zones={[]} />);
    expect(screen.getByTestId('floor-plan')).toHaveAttribute('viewBox', '0 0 1000 800');
    // 11 líneas verticales + 9 horizontales
    expect(screen.getByTestId('grid').querySelectorAll('line')).toHaveLength(20);
  });

  it('dibuja cada zona en su posición y tamaño reales', () => {
    render(<FloorPlan zones={[zone(1, 'Escaleras', true)]} />);
    const rect = shape(1);
    expect(rect).toHaveAttribute('x', '29');
    expect(rect).toHaveAttribute('y', '226');
    expect(rect).toHaveAttribute('width', '160');
    expect(rect).toHaveAttribute('height', '178');
  });

  it('CA-01.2 zona activa = restringida: borde rojo discontinuo y señalización del prototipo', () => {
    render(<FloorPlan zones={[zone(1, 'Escaleras', true)]} />);
    const g = screen.getByTestId('zone-1');
    expect(g).toHaveAttribute('data-state', 'restricted');
    const rect = shape(1);
    expect(rect).toHaveAttribute('stroke', '#e9aab0');
    expect(rect).toHaveAttribute('stroke-dasharray', '7 5');
    expect(rect).toHaveAttribute('fill', '#fdefee');
    expect(within(g).getByText('⊘ Escaleras')).toBeInTheDocument();
    expect(within(g).getByText('ZONA RESTRINGIDA')).toBeInTheDocument();
  });

  it('CA-01.2 / CA-02.6 zona inactiva = permitida: verde claro, borde continuo, sin destacar', () => {
    render(<FloorPlan zones={[zone(2, 'Sala', false)]} />);
    const g = screen.getByTestId('zone-2');
    expect(g).toHaveAttribute('data-state', 'allowed');
    const rect = shape(2);
    expect(rect).toHaveAttribute('stroke', '#c7e1dc');
    expect(rect).toHaveAttribute('fill', '#f9fdfb');
    expect(rect).not.toHaveAttribute('stroke-dasharray');
    expect(within(g).getByText('Sala')).toBeInTheDocument();
    expect(within(g).getByText('ÁREA PERMITIDA')).toBeInTheDocument();
  });

  it('el accesible del plano resume cuántas zonas están restringidas', () => {
    render(<FloorPlan zones={[zone(1, 'Escaleras', true), zone(2, 'Sala', false)]} />);
    expect(screen.getByRole('img', { name: /1 zona restringida de 2/ })).toBeInTheDocument();
  });
});

// Spec 003 — tarea 14 (RF-01.1, RF-04.4) y RC-15 (RF-10.2, CA-03.16, CA-03.30, DD-139)
const planRobot = (over: Partial<PlanRobot> = {}): PlanRobot => ({
  id: 1,
  name: 'Aspiradora A1',
  type: 'VACUUM',
  state: 'IDLE',
  position: { x: 300, y: 120 },
  ...over,
});

const robotFill = (id: number) =>
  screen.getByTestId(`robot-${id}`).querySelectorAll('circle')[1]?.getAttribute('fill');

describe('FloorPlan con robots (spec 003)', () => {
  it('sin robots ni onSelectPoint se comporta como en la spec 001', () => {
    render(<FloorPlan zones={[]} />);
    expect(screen.queryByTestId(/^robot-/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('destination-marker')).not.toBeInTheDocument();
    expect(screen.getByTestId('floor-plan')).not.toHaveStyle({
      cursor: 'crosshair',
    });
  });

  it.each([
    ['VACUUM', 'IDLE', '#3176d2'],
    ['VACUUM', 'MOVING', '#3176d2'],
    ['VACUUM', 'RECOVERING', '#3176d2'],
    ['GUARD', 'IDLE', '#665dd3'],
    ['VACUUM', 'SAFE_STOP', '#bd4954'],
    ['GUARD', 'SAFE_STOP', '#bd4954'],
    ['VACUUM', 'DEGRADED', '#8893a2'],
    ['GUARD', 'DEGRADED', '#8893a2'],
  ] as const)('pinta el %s en %s con el color del prototipo', (type, state, color) => {
    render(<FloorPlan zones={[]} robots={[planRobot({ type, state })]} />);
    const robot = screen.getByTestId('robot-1');
    expect(robot).toHaveAttribute('data-state', state);
    expect(robot).toHaveStyle({ transform: 'translate(300px, 120px)' });
    expect(robotFill(1)).toBe(color);
    expect(robot).toHaveTextContent(state);
  });

  it('CA-03.16 dibuja un marcador por robot con data-testid robot-<id> y su etiqueta', () => {
    render(
      <FloorPlan
        zones={[]}
        robots={[
          planRobot(),
          planRobot({ id: 2, name: 'Vigilante V2', type: 'GUARD', position: { x: 488, y: 290 } }),
        ]}
      />,
    );
    expect(screen.getByTestId('robot-1')).toHaveAttribute('data-x', '300');
    expect(screen.getByTestId('robot-1')).toHaveTextContent('Aspiradora A1');
    expect(screen.getByTestId('robot-2')).toHaveAttribute('data-x', '488');
    expect(screen.getByTestId('robot-2')).toHaveTextContent('Vigilante V2');
    expect(robotFill(1)).toBe('#3176d2');
    expect(robotFill(2)).toBe('#665dd3');
  });

  it('marca el destino y la trayectoria desde el robot seleccionado', () => {
    render(
      <FloorPlan
        zones={[]}
        robots={[
          planRobot({ position: { x: 120, y: 90 } }),
          planRobot({ id: 2, position: { x: 488, y: 290 } }),
        ]}
        selectedRobotId={2}
        destination={{ x: 450, y: 120 }}
      />,
    );
    const line = screen.getByTestId('destination-marker').querySelector('line');
    expect(line).toHaveAttribute('x1', '488');
    expect(line).toHaveAttribute('x2', '450');
  });

  it('el clic emite el punto del plano', () => {
    const onSelectPoint = vi.fn();
    render(<FloorPlan zones={[]} onSelectPoint={onSelectPoint} />);
    const svg = screen.getByTestId('floor-plan');
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 1000,
      height: 800,
      right: 1000,
      bottom: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    fireEvent.click(svg, { clientX: 250, clientY: 175 });
    expect(onSelectPoint).toHaveBeenCalledWith({ x: 250, y: 175 });
  });
});
