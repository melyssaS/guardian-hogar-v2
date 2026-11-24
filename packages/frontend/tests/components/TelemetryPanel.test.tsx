import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TelemetryPanel } from '../../src/components/TelemetryPanel';

// Spec 003 — RC-23 (RF-08.7, CA-03.24, DD-114): el panel muestra el JSON de la solicitud enviada
// y de la respuesta recibida tal cual, sin transformarlo ni inventar datos (art. XV).
const request = { destination: { x: 100, y: 300 }, sessionId: 'session-1', sequence: 4 };
const response = {
  decision: 'DENIED',
  code: 'RESTRICTED_ZONE_VIOLATION',
  state: 'SAFE_STOP',
  position: { x: 120, y: 90 },
  incidentId: 5,
  rule: 'R-ZONA-01',
  extra: { campoDesconocido: [1, 2, 3] },
};

describe('TelemetryPanel', () => {
  it('CA-03.24 muestra la solicitud y la respuesta como JSON idéntico al intercambiado', () => {
    render(<TelemetryPanel request={request} response={response} />);
    const req = screen.getByTestId('telemetry-request').textContent ?? '';
    const res = screen.getByTestId('telemetry-response').textContent ?? '';
    expect(JSON.parse(req)).toEqual(request);
    expect(JSON.parse(res)).toEqual(response);
  });

  it('no añade ni quita campos: un campo desconocido de la API se conserva', () => {
    render(<TelemetryPanel request={request} response={response} />);
    expect(screen.getByTestId('telemetry-response')).toHaveTextContent('campoDesconocido');
  });

  it('sin solicitud todavía muestra un estado vacío y ningún JSON inventado', () => {
    render(<TelemetryPanel request={null} response={null} />);
    expect(screen.getByText('Esperando una solicitud…')).toBeInTheDocument();
    expect(screen.queryByTestId('telemetry-request')).not.toBeInTheDocument();
    expect(screen.queryByTestId('telemetry-response')).not.toBeInTheDocument();
  });

  it('tiene el título "Telemetría"', () => {
    render(<TelemetryPanel request={request} response={response} />);
    expect(screen.getByRole('heading', { name: 'Telemetría' })).toBeInTheDocument();
  });
});
