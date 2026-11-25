import type { Incident } from '@home-guardian/domain';
import { describe, expect, it } from 'vitest';
import { INCIDENT_CSV_HEADERS, incidentsToCsv } from '../../src/rules/incidentCsv.js';

// Spec 007 — T1/T2: codificador CSV puro de incidentes (CA-07.1, 07.3, 07.4, 07.6, 07.9).

const BOM = '\uFEFF';
const HEADER_LINE =
  'id,robotId,robotName,rule,zoneName,decisionCode,collisionType,stateAfter,originX,originY,destX,destY,reason,createdAt';

function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: 1,
    robotId: 1,
    robotName: 'Aspiradora A1',
    rule: 'R-ZONA-01',
    zoneName: 'Escaleras',
    decisionCode: 'TRAJECTORY_CROSSES_ZONE',
    severity: 'HIGH',
    collisionType: 'TRAJECTORY_CROSSES_ZONE',
    stateAfter: 'SAFE_STOP',
    origin: { x: 120, y: 90 },
    destination: { x: 110.5, y: 400 },
    reason: 'Trajectory crosses restricted zone',
    createdAt: '2026-11-23T10:00:00.000Z',
    ...overrides,
  };
}

/** Parser RFC 4180 mínimo para comprobar el round-trip (filas separadas por \r\n). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' && text[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

/** Primera fila de datos ya parseada (falla si no existe). */
function dataRow(text: string): string[] {
  const row = parseCsv(text)[1];
  if (!row) throw new Error('CSV sin fila de datos');
  return row;
}

const body = (csv: string) => {
  expect(csv.startsWith(BOM)).toBe(true);
  return csv.slice(BOM.length);
};

describe('incidentsToCsv — encabezados, filas y codificación (T1)', () => {
  it('CA-07.1 encabezados exactos y en orden fijo', () => {
    expect(INCIDENT_CSV_HEADERS.join(',')).toBe(HEADER_LINE);
    expect(body(incidentsToCsv([incident()])).split('\r\n')[0]).toBe(HEADER_LINE);
  });

  it('CA-07.1 una fila por incidente, en el orden recibido, con String(n), null vacío y createdAt intacto', () => {
    const csv = incidentsToCsv([
      incident({ id: 2, reason: 'segundo' }),
      incident({
        id: 1,
        robotId: null,
        robotName: null,
        zoneName: null,
        collisionType: null,
        rule: 'R-SIGNAL-01',
        decisionCode: 'POSITION_QUALITY_LOST',
        stateAfter: 'DEGRADED',
        reason: 'primero',
      }),
    ]);
    const lines = body(csv).split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe(
      '2,1,Aspiradora A1,R-ZONA-01,Escaleras,TRAJECTORY_CROSSES_ZONE,TRAJECTORY_CROSSES_ZONE,SAFE_STOP,120,90,110.5,400,segundo,2026-11-23T10:00:00.000Z',
    );
    expect(lines[2]).toBe(
      '1,,,R-SIGNAL-01,,POSITION_QUALITY_LOST,,DEGRADED,120,90,110.5,400,primero,2026-11-23T10:00:00.000Z',
    );
  });

  it('CA-07.6 lista vacía → BOM + solo encabezados', () => {
    expect(incidentsToCsv([])).toBe(`${BOM}${HEADER_LINE}`);
  });

  it('CA-07.4 BOM inicial y UTF-8 válido que conserva "Cuarto del bebé"', () => {
    const bytes = new TextEncoder().encode(
      incidentsToCsv([incident({ zoneName: 'Cuarto del bebé' })]),
    );
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    expect(decoded).toContain('Cuarto del bebé');
  });
});

describe('incidentsToCsv — escape RFC 4180 y fórmulas (T2)', () => {
  it.each([
    ['coma', 'Escaleras, planta 1'],
    ['comillas', 'Zona "segura" no'],
    ['salto de línea', 'línea 1\nlínea 2'],
    ['retorno de carro', 'línea 1\r\nlínea 2'],
    ['todo junto', 'a, "b"\nc'],
  ])(
    'CA-07.3 %s: se entrecomilla, duplica comillas y el round-trip recupera el valor',
    (_, value) => {
      const csv = incidentsToCsv([incident({ reason: value, zoneName: value })]);
      expect(parseCsv(body(csv))).toHaveLength(2);
      const row = dataRow(body(csv));
      expect(row).toHaveLength(14);
      expect(row[4]).toBe(value);
      expect(row[12]).toBe(value);
    },
  );

  it('CA-07.3 duplica cada comilla interna', () => {
    const line = body(incidentsToCsv([incident({ reason: 'dijo "alto"' })])).split('\r\n')[1];
    expect(line).toContain(',"dijo ""alto""",');
  });

  it('CA-07.3 un campo sin caracteres especiales no se entrecomilla', () => {
    const line = body(incidentsToCsv([incident()])).split('\r\n')[1];
    expect(line).not.toContain('"');
  });

  it.each(['=', '+', '-', '@', '\t', '\r'])(
    'CA-07.9 texto libre que empieza por %j se prefija con apóstrofo',
    (prefix) => {
      const value = `${prefix}HYPERLINK("http://x")`;
      const csv = incidentsToCsv([incident({ robotName: value, zoneName: value, reason: value })]);
      const cells = dataRow(body(csv));
      expect(cells[2]).toBe(`'${value}`);
      expect(cells[4]).toBe(`'${value}`);
      expect(cells[12]).toBe(`'${value}`);
    },
  );

  it('CA-07.9 un valor mitigado con coma se entrecomilla después del prefijo', () => {
    const line = body(incidentsToCsv([incident({ reason: '=SUM(A1,A2)' })])).split('\r\n')[1];
    expect(line).toContain(`,"'=SUM(A1,A2)",`);
  });

  it('CA-07.9 no altera columnas numéricas ni de vocabulario cerrado', () => {
    const cells = dataRow(
      body(incidentsToCsv([incident({ origin: { x: 0, y: 0 }, destination: { x: 5, y: 6 } })])),
    );
    expect(cells.slice(0, 2)).toEqual(['1', '1']);
    expect(cells[3]).toBe('R-ZONA-01');
    expect(cells.slice(5, 12)).toEqual([
      'TRAJECTORY_CROSSES_ZONE',
      'TRAJECTORY_CROSSES_ZONE',
      'SAFE_STOP',
      '0',
      '0',
      '5',
      '6',
    ]);
    expect(cells[13]).toBe('2026-11-23T10:00:00.000Z');
  });

  it('CA-07.9 un texto que solo contiene un guion en medio no se mitiga', () => {
    const cells = dataRow(body(incidentsToCsv([incident({ reason: 'zona A-1' })])));
    expect(cells[12]).toBe('zona A-1');
  });
});
