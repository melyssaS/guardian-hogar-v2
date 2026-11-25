import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IncidentsPage } from '../../src/pages/IncidentsPage';
import type { Incident, IncidentCounts, IncidentDetail, Zone } from '../../src/types';

// Spec 003 — RC-16/RC-17 (RF-09.1..RF-09.6; CA-03.15, CA-03.26, CA-03.27).
const stairs: Zone = {
  id: 3,
  name: 'Escaleras',
  x: 29,
  y: 226,
  width: 160,
  height: 178,
  active: true,
  createdAt: '2025-01-01T00:00:00.000Z',
};

const zoneIncident: Incident = {
  id: 2,
  robotId: 1,
  robotName: 'Aspiradora A1',
  rule: 'R-ZONA-01',
  zoneName: 'Escaleras',
  decisionCode: 'RESTRICTED_ZONE_VIOLATION',
  collisionType: 'RESTRICTED_ZONE_VIOLATION',
  stateAfter: 'SAFE_STOP',
  origin: { x: 120, y: 90 },
  destination: { x: 100, y: 300 },
  reason: 'El destino está dentro de una zona restringida',
  createdAt: '2025-03-04T15:04:05.000Z',
};

const signalIncident: Incident = {
  id: 1,
  robotId: 2,
  robotName: 'Vigilante V2',
  rule: 'R-SIGNAL-01',
  zoneName: null,
  decisionCode: 'POSITION_QUALITY_LOST',
  collisionType: null,
  stateAfter: 'DEGRADED',
  origin: { x: 488, y: 290 },
  destination: { x: 488, y: 290 },
  reason: 'Pérdida de señal de posición',
  createdAt: '2025-03-04T15:00:00.000Z',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** Conteos derivados de una lista, en el orden del catálogo (lo que devolvería el backend). */
function countsOf(incidents: Incident[]): IncidentCounts {
  const rules: { rule: IncidentCounts['byType'][number]['rule']; title: string }[] = [
    { rule: 'R-ZONA-01', title: 'No circular por zonas restringidas' },
    { rule: 'R-SIGNAL-01', title: 'Posición no confiable o ausente' },
    { rule: 'R-DATA-01', title: 'Información de zonas no disponible' },
  ];
  const byType = rules.map((r) => ({
    ...r,
    count: incidents.filter((i) => i.rule === r.rule).length,
  }));
  return { total: byType.reduce((n, t) => n + t.count, 0), byType };
}

interface InstallOptions {
  failList?: boolean;
  failCounts?: boolean;
}

function install(incidents: Incident[], options: InstallOptions = {}) {
  const { failList = false, failCounts = false } = options;
  const detail = (i: Incident): IncidentDetail => ({ ...i, zonesSnapshot: [stairs] });
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/incidents/counts') {
      return failCounts
        ? json({ code: 'INTERNAL_ERROR', message: 'Fallo conteos' }, 500)
        : json(countsOf(incidents));
    }
    if (url === '/api/incidents') {
      return failList ? json({ code: 'INTERNAL_ERROR', message: 'Fallo' }, 500) : json(incidents);
    }
    const m = /^\/api\/incidents\/(\d+)$/.exec(url);
    const found = m ? incidents.find((i) => i.id === Number(m[1])) : undefined;
    return found ? json(detail(found)) : json({ code: 'INCIDENT_NOT_FOUND', message: 'x' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('IncidentsPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('RF-09.1 lista la tabla Fecha · Robot · Regla · Zona · Decisión con el contador "N eventos"', async () => {
    install([zoneIncident, signalIncident]);
    render(<IncidentsPage />);

    const table = await screen.findByRole('table');
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers).toEqual(['Fecha', 'Robot', 'Regla', 'Zona', 'Decisión']);
    expect(screen.getByTestId('incident-counter')).toHaveTextContent('2 eventos');

    // Orden tal como lo entrega la API (más reciente primero).
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('Aspiradora A1')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('R-ZONA-01')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Escaleras')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('RESTRICTED_ZONE_VIOLATION')).toBeInTheDocument();
  });

  it('CA-03.15 al seleccionar un incidente muestra su detalle con el snapshot de zonas', async () => {
    const fetchMock = install([zoneIncident, signalIncident]);
    render(<IncidentsPage />);

    await userEvent.click(await screen.findByRole('row', { name: /R-ZONA-01/ }));

    const detail = await screen.findByTestId('incident-detail');
    expect(fetchMock).toHaveBeenCalledWith('/api/incidents/2', expect.anything());
    expect(detail).toHaveTextContent('R-ZONA-01');
    expect(detail).toHaveTextContent('RESTRICTED_ZONE_VIOLATION');
    expect(detail).toHaveTextContent('SAFE_STOP');
    expect(detail).toHaveTextContent('(120, 90)');
    expect(detail).toHaveTextContent('(100, 300)');
    expect(detail).toHaveTextContent('El destino está dentro de una zona restringida');
    const snapshot = within(detail).getByTestId('zones-snapshot');
    expect(snapshot).toHaveTextContent('Escaleras');
  });

  it('CA-03.26 sin incidentes muestra estado vacío y "0 eventos"', async () => {
    install([]);
    render(<IncidentsPage />);

    expect(await screen.findByTestId('incident-counter')).toHaveTextContent('0 eventos');
    expect(screen.getByText(/Sin incidentes registrados/)).toBeInTheDocument();
    expect(screen.queryByTestId('incident-detail')).not.toBeInTheDocument();
  });

  it('RF-09.6 el incidente R-SIGNAL-01 se muestra con "—" en la columna Zona', async () => {
    install([signalIncident]);
    render(<IncidentsPage />);

    const row = await screen.findByRole('row', { name: /R-SIGNAL-01/ });
    const cells = within(row).getAllByRole('cell');
    expect(cells[3]).toHaveTextContent('—');
    expect(within(row).getByText('POSITION_QUALITY_LOST')).toBeInTheDocument();
  });

  it('CA-03.27 los botones HU-06 y HU-07 están deshabilitados', async () => {
    install([zoneIncident]);
    render(<IncidentsPage />);
    await screen.findByRole('table');

    expect(screen.getByRole('button', { name: /Filtrar por severidad · HU-06/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Exportar CSV · HU-07/ })).toBeDisabled();
  });

  it('RF-09.5 es de solo lectura: solo se hacen GET', async () => {
    const fetchMock = install([zoneIncident]);
    render(<IncidentsPage />);
    await userEvent.click(await screen.findByRole('row', { name: /R-ZONA-01/ }));
    await screen.findByTestId('incident-detail');

    for (const call of fetchMock.mock.calls as unknown as [string, RequestInit?][]) {
      expect(call[1]?.method ?? 'GET').toBe('GET');
    }
  });

  it('muestra el error de la API si falla la carga', async () => {
    install([], { failList: true });
    render(<IncidentsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('INTERNAL_ERROR');
  });

  it('CA-08.6 al montar pide conteos y los muestra en el marcador de HU-08', async () => {
    const fetchMock = install([zoneIncident, zoneIncident, signalIncident]);
    render(<IncidentsPage />);

    const counts = await screen.findByTestId('incident-counts');
    expect(fetchMock).toHaveBeenCalledWith('/api/incidents/counts', expect.anything());
    expect(within(counts).getByTestId('count-R-ZONA-01')).toHaveTextContent('2');
    expect(within(counts).getByTestId('count-R-SIGNAL-01')).toHaveTextContent('1');
    expect(within(counts).getByTestId('count-R-DATA-01')).toHaveTextContent('0');
    expect(within(counts).getByTestId('count-total')).toHaveTextContent('3');
  });

  it('CA-08.7 al volver a montar pide los conteos de nuevo y refleja el valor vigente', async () => {
    const first = install([zoneIncident]);
    const view = render(<IncidentsPage />);
    const counts1 = await screen.findByTestId('incident-counts');
    expect(within(counts1).getByTestId('count-total')).toHaveTextContent('1');
    expect(first).toHaveBeenCalledWith('/api/incidents/counts', expect.anything());

    view.unmount();
    vi.unstubAllGlobals();

    const second = install([zoneIncident, signalIncident]);
    render(<IncidentsPage />);
    const counts2 = await screen.findByTestId('incident-counts');
    expect(second).toHaveBeenCalledWith('/api/incidents/counts', expect.anything());
    expect(within(counts2).getByTestId('count-total')).toHaveTextContent('2');
  });

  it('CA-08.9 el error de conteos se muestra en IncidentCounts y no afecta tabla ni callout global', async () => {
    install([zoneIncident], { failCounts: true });
    render(<IncidentsPage />);

    // La tabla carga con normalidad pese al fallo de los conteos.
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.getByTestId('incident-counter')).toHaveTextContent('1 eventos');

    const countsError = await screen.findByTestId('counts-error');
    expect(countsError).toHaveTextContent('INTERNAL_ERROR');

    // El callout global de la página (status.list/detail) no se activa por el fallo de conteos.
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toBe(countsError);
    expect(screen.queryByTestId('incident-counts')).not.toBeInTheDocument();
  });
});
