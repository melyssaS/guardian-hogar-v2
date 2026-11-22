import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ZoneForm } from '../../src/components/ZoneForm';

async function fill(values: Partial<Record<'name' | 'x' | 'y' | 'width' | 'height', string>>) {
  const user = userEvent.setup();
  for (const [field, value] of Object.entries(values)) {
    const input = screen.getByRole(field === 'name' ? 'textbox' : 'spinbutton', {
      name: new RegExp(
        `^${{ name: 'Nombre', x: 'X', y: 'Y', width: 'Ancho', height: 'Alto' }[field]}`,
      ),
    });
    await user.clear(input);
    if (value) await user.type(input, value);
  }
  await user.click(screen.getByRole('button', { name: /crear zona|guardar cambios/i }));
}

describe('ZoneForm', () => {
  it('envía una zona válida (RF-02.1)', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(<ZoneForm onSubmit={onSubmit} />);
    await fill({ name: 'Escaleras', x: '100', y: '100', width: '200', height: '150' });
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Escaleras',
      x: 100,
      y: 100,
      width: 200,
      height: 150,
      active: true,
    });
  });

  it('permite crear la habitación como área permitida (zona inactiva)', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(<ZoneForm onSubmit={onSubmit} />);
    await userEvent.setup().click(screen.getByRole('checkbox', { name: 'Zona restringida' }));
    await fill({ name: 'Estudio' });
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Estudio', active: false }),
    );
  });

  it('marca nombre vacío y dimensiones ≤ 0 sin enviar', async () => {
    const onSubmit = vi.fn();
    render(<ZoneForm onSubmit={onSubmit} />);
    await fill({ name: '', width: '0', height: '-5' });
    expect(screen.getByText('El nombre es obligatorio')).toBeInTheDocument();
    expect(screen.getAllByText('Debe ser mayor que 0')).toHaveLength(2);
    expect(screen.getByRole('textbox', { name: /nombre/i })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('marca una zona fuera del plano sin enviar', async () => {
    const onSubmit = vi.fn();
    render(<ZoneForm onSubmit={onSubmit} />);
    await fill({ name: 'A', x: '900', width: '200' });
    expect(screen.getByText(/dentro del plano 1000 × 800/)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('CA-02.5 en edición precarga valores y envía los cambios (RF-02.2)', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(
      <ZoneForm
        initial={{
          id: 3,
          name: 'Cuna',
          x: 10,
          y: 20,
          width: 30,
          height: 40,
          active: false,
          createdAt: '2025-01-01T00:00:00.000Z',
        }}
        onSubmit={onSubmit}
      />,
    );
    expect(screen.getByRole('textbox', { name: /nombre/i })).toHaveValue('Cuna');
    await fill({ width: '60' });
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Cuna',
      x: 10,
      y: 20,
      width: 60,
      height: 40,
      active: false,
    });
  });
});
