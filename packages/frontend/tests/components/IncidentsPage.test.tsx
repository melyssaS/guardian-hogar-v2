import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IncidentsPage } from '../../src/pages/IncidentsPage';
import type { Incident, IncidentDetail, Zone } from '../../src/types';

// Spec 003 — RC-16/RC-17 (RF-09.1..RF-09.6; CA-03.15, CA-03.26, CA-03.27).
// Spec 007 — T8 (CA-07.10..CA-07.14): exportación CSV de HU-07.
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
  severity: 'HIGH',
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
  severity: 'LOW',
  collisionType: null,
  stateAfter: 'DEGRADED',
  origin: { x: 488, y: 290 },
  destination: { x: 488, y: 290 },
  reason: 'Pérdida de señal de posición',
  createdAt: '2025-03-04T15:00:00.000Z',
};

const CSV = '\uFEFFid,robotId\r\n2,1';
const csvResponse = (body: string, filename: string | null = 'incidentes-2026-11-23.csv') =>
  new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      ...(filename === null ? {} : { 'Content-Disposition': `attachment; filename="${filename}"` }),
    },
  });
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function install(
  incidents: Incident[],
  failList = false,
  exportResponse: () => Promise<Response> = async () => csvResponse(CSV),
) {
  const detail = (i: Incident): IncidentDetail => ({ ...i, zonesSnapshot: [stairs] });
  const fetchMock = vi.fn(async (url: string) => {
    if (url.startsWith('/api/incidents/export')) return exportResponse();
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

  // Spec 006 CA-06.9: HU-06 salió de la reserva (filtro por severidad) y HU-07 (spec 007) exporta CSV.
  it('CA-03.27 / CA-07.14 ninguna historia sigue reservada: filtro HU-06 y exportar HU-07 activos', async () => {
    install([zoneIncident]);
    render(<IncidentsPage />);
    await screen.findByRole('table');

    expect(screen.queryByRole('button', { name: /HU-06/ })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Filtrar por severidad' })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Exportar CSV · HU-07/ })).toBeEnabled();
    expect(screen.queryByText(/reservada, no implementada/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Estas historias están reservadas/)).not.toBeInTheDocument();
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
    install([], true);
    render(<IncidentsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('INTERNAL_ERROR');
  });
});

describe('IncidentsPage — exportar CSV (spec 007)', () => {
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:incidentes');
  const revokeObjectURL = vi.fn((_url: string) => undefined);
  let downloads: string[];

  beforeEach(() => {
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    downloads = [];
    // Captura el clic del ancla temporal sin navegar (jsdom no implementa la descarga).
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push(this.download);
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const exportButton = () =>
    screen.getByRole('button', { name: /Exportar CSV · HU-07|Exportando…/ });

  it('CA-07.10 un único GET /api/incidents/export sin query y descarga con el filename de la cabecera', async () => {
    const fetchMock = install([zoneIncident]);
    render(<IncidentsPage />);
    await screen.findByRole('table');
    await userEvent.click(exportButton());
    await vi.waitFor(() => expect(downloads).toEqual(['incidentes-2026-11-23.csv']));
    const exportCalls = (fetchMock.mock.calls as unknown as [string, RequestInit?][]).filter(
      ([u]) => u.startsWith('/api/incidents/export'),
    );
    expect(exportCalls).toHaveLength(1);
    expect(exportCalls[0]?.[0]).toBe('/api/incidents/export');
    expect(exportCalls[0]?.[1]?.method ?? 'GET').toBe('GET');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:incidentes');
  });

  it('CA-07.10 sin Content-Disposition usa incidentes.csv', async () => {
    install([zoneIncident], false, async () => csvResponse(CSV, null));
    render(<IncidentsPage />);
    await screen.findByRole('table');
    await userEvent.click(exportButton());
    await vi.waitFor(() => expect(downloads).toEqual(['incidentes.csv']));
  });

  it('CA-07.11 el blob descargado tiene exactamente los bytes recibidos (BOM incluido)', async () => {
    install([zoneIncident]);
    render(<IncidentsPage />);
    await screen.findByRole('table');
    await userEvent.click(exportButton());
    await vi.waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    const blob = createObjectURL.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(Blob);
    // jsdom no implementa Blob.arrayBuffer: se leen los bytes con FileReader.
    const buffer = await new Promise<ArrayBuffer>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.readAsArrayBuffer(blob as Blob);
    });
    const received = new Uint8Array(buffer);
    expect([...received]).toEqual([...new TextEncoder().encode(CSV)]);
  });

  it('CA-07.12 mientras exporta, el botón está deshabilitado con "Exportando…"', async () => {
    let release: (res: Response) => void = () => undefined;
    install([zoneIncident], false, () => new Promise<Response>((resolve) => (release = resolve)));
    render(<IncidentsPage />);
    await screen.findByRole('table');
    await userEvent.click(exportButton());
    const busy = await screen.findByRole('button', { name: 'Exportando…' });
    expect(busy).toBeDisabled();
    release(csvResponse(CSV));
    const idle = await screen.findByRole('button', { name: /Exportar CSV · HU-07/ });
    expect(idle).toBeEnabled();
  });

  it('CA-07.13 si el backend responde error, muestra el message y no descarga', async () => {
    install([zoneIncident], false, async () =>
      json({ code: 'ROBOT_NOT_FOUND', message: 'No se pudo exportar' }, 404),
    );
    render(<IncidentsPage />);
    await screen.findByRole('table');
    await userEvent.click(exportButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo exportar');
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(downloads).toEqual([]);
    expect(exportButton()).toBeEnabled();
  });
});
