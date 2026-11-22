import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FloorPlan } from '../../src/components/FloorPlan';
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
