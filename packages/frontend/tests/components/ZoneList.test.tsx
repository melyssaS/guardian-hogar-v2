import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ZoneList } from '../../src/components/ZoneList';
import type { Zone } from '../../src/types';

const zones: Zone[] = [
  { id: 1, name: 'Sala', x: 29, y: 30, width: 250, height: 178, active: false, createdAt: '' },
  { id: 3, name: 'Escaleras', x: 29, y: 226, width: 160, height: 178, active: true, createdAt: '' },
];

function setup() {
  const handlers = { onToggleActive: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn() };
  render(<ZoneList zones={zones} {...handlers} />);
  return handlers;
}

describe('ZoneList', () => {
  it('muestra el estado de circulación como en el prototipo', () => {
    setup();
    const sala = screen.getByTestId('zone-row-1');
    expect(within(sala).getByText('Circulación permitida')).toBeInTheDocument();
    const stairs = screen.getByTestId('zone-row-3');
    expect(within(stairs).getByText('No se permite circular')).toBeInTheDocument();
  });

  it('el switch refleja el estado: encendido = restringida', () => {
    setup();
    const on = screen.getByRole('button', { name: 'Permitir Escaleras' });
    expect(on).toHaveAttribute('aria-pressed', 'true');
    expect(on).toHaveClass('switch', 'on');
    const off = screen.getByRole('button', { name: 'Restringir Sala' });
    expect(off).toHaveAttribute('aria-pressed', 'false');
    expect(off).not.toHaveClass('on');
  });

  it('CA-02.6 el switch activa y desactiva la zona', async () => {
    const user = userEvent.setup();
    const { onToggleActive } = setup();
    await user.click(screen.getByRole('button', { name: 'Permitir Escaleras' }));
    expect(onToggleActive).toHaveBeenLastCalledWith(zones[1]);
    await user.click(screen.getByRole('button', { name: 'Restringir Sala' }));
    expect(onToggleActive).toHaveBeenLastCalledWith(zones[0]);
  });

  it('RF-02.2 editar una zona', async () => {
    const user = userEvent.setup();
    const { onEdit } = setup();
    await user.click(screen.getByRole('button', { name: 'Editar Sala' }));
    expect(onEdit).toHaveBeenCalledWith(zones[0]);
  });

  it('CA-02.7 eliminar una zona', async () => {
    const user = userEvent.setup();
    const { onDelete } = setup();
    await user.click(screen.getByRole('button', { name: 'Eliminar Escaleras' }));
    expect(onDelete).toHaveBeenCalledWith(zones[1]);
  });

  it('deshabilita los controles mientras hay una operación en curso', () => {
    render(
      <ZoneList zones={zones} busy onToggleActive={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />,
    );
    for (const b of screen.getAllByRole('button')) expect(b).toBeDisabled();
  });

  it('muestra un mensaje cuando no hay zonas', () => {
    render(<ZoneList zones={[]} onToggleActive={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('No hay habitaciones registradas.')).toBeInTheDocument();
  });
});
