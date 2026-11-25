import { severitySchema } from '@home-guardian/domain';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IncidentsPage } from '../../src/pages/IncidentsPage';
import type { Incident, IncidentDetail } from '../../src/types';

// Spec 006 — HU-06, tarea 10 (CA-06.2, CA-06.3, CA-06.4, CA-06.8, CA-06.9, CA-06.10, CA-06.11).
const make = (
  id: number,
  decisionCode: Incident['decisionCode'],
  severity: Incident['severity'],
  rule: Incident['rule'] = 'R-ZONA-01',
): Incident => ({
  id,
  robotId: 1,
  robotName: 'Aspiradora A1',
  rule,
  zoneName: rule === 'R-ZONA-01' ? 'Escaleras' : null,
  decisionCode,
  severity,
  collisionType: null,
  stateAfter: 'SAFE_STOP',
  origin: { x: 1, y: 2 },
  destination: { x: 3, y: 4 },
  reason: `motivo-${id}`,
  createdAt: '2025-03-04T15:04:05.000Z',
});

const critical = make(5, 'ORIGIN_IN_RESTRICTED_ZONE', 'CRITICAL');
const high = make(4, 'RESTRICTED_ZONE_VIOLATION', 'HIGH');
const medium = make(3, 'TRAJECTORY_CROSSES_ZONE', 'MEDIUM');
const low = make(2, 'POSITION_QUALITY_LOST', 'LOW', 'R-SIGNAL-01');
const ALL = [critical, high, medium, low];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** `bySeverity`: lo que responde la API a cada filtro (la UI no debe recalcularlo). */
function install(opts: {
  all?: Incident[];
  bySeverity?: Record<string, Incident[]>;
  fail?: string[];
}) {
  const all = opts.all ?? ALL;
  const fetchMock = vi.fn(async (url: string) => {
    const list = /^\/api\/incidents(?:\?severity=(\w+))?$/.exec(url);
    if (list) {
      const severity = list[1];
      if (severity !== undefined && opts.fail?.includes(severity)) {
        return json({ code: 'INTERNAL_ERROR', message: 'Fallo' }, 500);
      }
      return json(severity === undefined ? all : (opts.bySeverity?.[severity] ?? []));
    }
    const m = /^\/api\/incidents\/(\d+)$/.exec(url);
    const found = m ? all.find((i) => i.id === Number(m[1])) : undefined;
    return found
      ? json({ ...found, zonesSnapshot: [] } satisfies IncidentDetail)
      : json({ code: 'INCIDENT_NOT_FOUND', message: 'x' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const urls = (fetchMock: ReturnType<typeof install>) =>
  (fetchMock.mock.calls as unknown as [string][]).map((c) => c[0]);

const dataRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);

describe('IncidentsPage con filtro por severidad (HU-06)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('CA-06.11 el selector tiene la etiqueta "Filtrar por severidad" y sus opciones salen del dominio', async () => {
    install({});
    render(<IncidentsPage />);
    const select = await screen.findByRole('combobox', { name: 'Filtrar por severidad' });
    const labels = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(labels).toEqual(['Todas', ...severitySchema.options]);
    // La constante local de la UI no se desvía del esquema del dominio (DD-612).
    const { SEVERITY_OPTIONS } = await import('../../src/components/IncidentSeverityFilter');
    expect([...SEVERITY_OPTIONS]).toEqual([...severitySchema.options]);
  });

  it('CA-06.1/CA-06.8 filtrar muestra exactamente lo que devuelve la API, sin recalcular en el cliente', async () => {
    // La API responde un incidente LOW al filtro HIGH a propósito: la UI no debe descartarlo.
    const fetchMock = install({ bySeverity: { HIGH: [low] } });
    render(<IncidentsPage />);
    await screen.findByRole('table');
    await waitFor(() => expect(dataRows()).toHaveLength(4));

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Filtrar por severidad' }),
      'HIGH',
    );

    await waitFor(() => expect(dataRows()).toHaveLength(1));
    expect(urls(fetchMock)).toContain('/api/incidents?severity=HIGH');
    expect(within(dataRows()[0]!).getByText('POSITION_QUALITY_LOST')).toBeInTheDocument();
    expect(screen.getByTestId('incident-counter')).toHaveTextContent('1 eventos');
  });

  it('CA-06.9 la severidad se muestra como insignia dentro de la columna Decisión y las cabeceras no cambian', async () => {
    install({});
    render(<IncidentsPage />);
    const table = await screen.findByRole('table');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Fecha', 'Robot', 'Regla', 'Zona', 'Decisión']);

    await waitFor(() => expect(dataRows()).toHaveLength(4));
    const decision = within(dataRows()[0]!).getAllByRole('cell')[4]!;
    expect(decision).toHaveTextContent('ORIGIN_IN_RESTRICTED_ZONE');
    expect(within(decision).getByText('CRITICAL')).toBeInTheDocument();
  });

  it('CA-06.4 sin incidentes para el filtro: mensaje con role="status", "0 eventos" y sin el mensaje general', async () => {
    install({ bySeverity: { LOW: [] } });
    render(<IncidentsPage />);
    await waitFor(() => expect(dataRows()).toHaveLength(4));

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Filtrar por severidad' }),
      'LOW',
    );

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('No hay incidentes de severidad LOW.');
    expect(screen.getByTestId('incident-counter')).toHaveTextContent('0 eventos');
    expect(screen.queryByText(/Sin incidentes registrados/)).not.toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /R-ZONA-01|R-SIGNAL-01/ })).not.toBeInTheDocument();
  });

  it('CA-06.4 sin filtro y sin incidentes sigue el mensaje general (sin role="status")', async () => {
    install({ all: [] });
    render(<IncidentsPage />);
    expect(await screen.findByText(/Sin incidentes registrados/)).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('CA-06.2 "Restablecer filtro" vuelve a pedir sin severity y queda deshabilitado', async () => {
    const fetchMock = install({ bySeverity: { HIGH: [high] } });
    render(<IncidentsPage />);
    await waitFor(() => expect(dataRows()).toHaveLength(4));
    const reset = screen.getByRole('button', { name: 'Restablecer filtro' });
    expect(reset).toBeDisabled();

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Filtrar por severidad' }),
      'HIGH',
    );
    await waitFor(() => expect(dataRows()).toHaveLength(1));
    expect(reset).toBeEnabled();

    await userEvent.click(reset);
    await waitFor(() => expect(dataRows()).toHaveLength(4));
    expect(urls(fetchMock).at(-1)).toBe('/api/incidents');
    expect(reset).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Filtrar por severidad' })).toHaveValue('');
  });

  it('CA-06.2 elegir "Todas" equivale a restablecer', async () => {
    const fetchMock = install({ bySeverity: { HIGH: [high] } });
    render(<IncidentsPage />);
    await waitFor(() => expect(dataRows()).toHaveLength(4));
    const select = screen.getByRole('combobox', { name: 'Filtrar por severidad' });

    await userEvent.selectOptions(select, 'HIGH');
    await waitFor(() => expect(dataRows()).toHaveLength(1));
    await userEvent.selectOptions(select, 'Todas');

    await waitFor(() => expect(dataRows()).toHaveLength(4));
    expect(urls(fetchMock).at(-1)).toBe('/api/incidents');
    expect(screen.getByRole('button', { name: 'Restablecer filtro' })).toBeDisabled();
  });

  it('CA-06.10 el contador cuenta lo mostrado y el detalle sigue visible aunque el filtro excluya el incidente', async () => {
    install({ bySeverity: { LOW: [low] } });
    render(<IncidentsPage />);
    await waitFor(() => expect(dataRows()).toHaveLength(4));
    await userEvent.click(screen.getByRole('row', { name: /RESTRICTED_ZONE_VIOLATION/ }));
    await screen.findByTestId('incident-detail');

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Filtrar por severidad' }),
      'LOW',
    );

    await waitFor(() => expect(dataRows()).toHaveLength(1));
    expect(screen.getByTestId('incident-counter')).toHaveTextContent('1 eventos');
    expect(screen.getByTestId('incident-detail')).toBeInTheDocument();
  });

  it('CA-06.8 si el filtro falla muestra el callout y conserva la lista anterior', async () => {
    install({ fail: ['HIGH'] });
    render(<IncidentsPage />);
    await waitFor(() => expect(dataRows()).toHaveLength(4));

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Filtrar por severidad' }),
      'HIGH',
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('INTERNAL_ERROR');
    expect(dataRows()).toHaveLength(4);
  });

  it('CA-06.3 filtrar y restablecer solo emiten GET', async () => {
    const fetchMock = install({ bySeverity: { HIGH: [high] } });
    render(<IncidentsPage />);
    await waitFor(() => expect(dataRows()).toHaveLength(4));
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Filtrar por severidad' }),
      'HIGH',
    );
    await waitFor(() => expect(dataRows()).toHaveLength(1));
    await userEvent.click(screen.getByRole('button', { name: 'Restablecer filtro' }));
    await waitFor(() => expect(dataRows()).toHaveLength(4));

    for (const call of fetchMock.mock.calls as unknown as [string, RequestInit?][]) {
      expect(call[1]?.method ?? 'GET').toBe('GET');
    }
  });

  it('CA-06.9 el botón HU-06 deshabilitado ya no existe y el de HU-07 sigue deshabilitado', async () => {
    install({});
    render(<IncidentsPage />);
    await screen.findByRole('table');

    expect(screen.queryByRole('button', { name: /HU-06/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Exportar CSV · HU-07/ })).toBeDisabled();
    expect(screen.getByText('HU-07 reservada, no implementada.')).toBeInTheDocument();
  });
});
