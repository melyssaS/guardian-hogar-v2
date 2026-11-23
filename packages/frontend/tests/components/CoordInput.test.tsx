import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  CoordInput,
  emptyDraft,
  parseDestination,
  type CoordDraft,
} from '../../src/components/CoordInput';
import type { Point } from '../../src/types';

// Spec 003 — RF-01.2, RF-01.4, RF-01.5
describe('parseDestination', () => {
  it('vacío → sin punto ni error', () => {
    expect(parseDestination(emptyDraft)).toEqual({ point: null, error: null });
  });

  it.each([
    ['0', '0'],
    ['1000', '800'],
    ['250.5', '175'],
  ])('(%s, %s) dentro del plano, borde inclusivo', (x, y) => {
    expect(parseDestination({ x, y })).toEqual({
      point: { x: Number(x), y: Number(y) },
      error: null,
    });
  });

  it.each([
    ['-1', '10'],
    ['1000.1', '10'],
    ['10', '801'],
  ])('(%s, %s) fuera del plano → error', (x, y) => {
    const r = parseDestination({ x, y });
    expect(r.point).toBeNull();
    expect(r.error).toMatch(/dentro del plano/);
  });

  it.each([
    ['abc', '1'],
    ['1', ''],
  ])('(%s, %s) no numérico → error', (x, y) => {
    expect(parseDestination({ x, y }).error).toMatch(/numéricos/);
  });
});

function Harness({ onSubmit }: { onSubmit: (p: Point) => void }) {
  const [draft, setDraft] = useState<CoordDraft>(emptyDraft);
  return <CoordInput value={draft} onChange={setDraft} onSubmit={onSubmit} />;
}

describe('CoordInput', () => {
  it('RF-01.2 envía el punto escrito', async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText('Destino X'), '250');
    await userEvent.type(screen.getByLabelText('Destino Y'), '175');
    await userEvent.click(screen.getByRole('button', { name: /Solicitar movimiento/ }));
    expect(onSubmit).toHaveBeenCalledWith({ x: 250, y: 175 });
  });

  it('RF-01.5 impide el envío fuera del plano y lo explica', async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText('Destino X'), '1200');
    await userEvent.type(screen.getByLabelText('Destino Y'), '10');
    const button = screen.getByRole('button', { name: /Solicitar movimiento/ });
    expect(button).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/dentro del plano/);
    await userEvent.type(screen.getByLabelText('Destino Y'), '{enter}');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('deshabilita el envío mientras hay una solicitud en curso', () => {
    render(
      <CoordInput value={{ x: '1', y: '1' }} onChange={() => {}} onSubmit={() => {}} submitting />,
    );
    expect(screen.getByRole('button', { name: /Solicitar movimiento/ })).toBeDisabled();
  });
});
