import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

// Spec 006 — HU-06, tarea 11. E2E del filtro de incidentes por severidad con el backend real.
// Base `:memory:` compartida (workers=1): la prueba provoca sus propios incidentes por API (no
// depende del seed ni del orden) y deja el robot A1 en IDLE. Los incidentes son append-only, así
// que los que crea quedan en el registro; las demás pruebas no cuentan incidentes exactos.

const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
type Sev = (typeof SEVERITIES)[number];

interface IncidentDto {
  id: number;
  severity: Sev;
}

async function listIncidents(request: APIRequestContext, severity?: Sev): Promise<IncidentDto[]> {
  const res = await request.get('/api/incidents', severity ? { params: { severity } } : {});
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as IncidentDto[];
}

/** HIGH: destino dentro de «Escaleras». LOW: pérdida de señal de posición. Deja A1 en IDLE. */
async function provokeIncidents(request: APIRequestContext) {
  const session = await request.post('/api/robots/1/sessions');
  const { sessionId } = (await session.json()) as { sessionId: string };
  const denied = await request.post('/api/robots/1/move', {
    data: { destination: { x: 109, y: 315 }, sessionId, sequence: 1 },
  });
  expect(denied.status()).toBe(200);
  expect(((await denied.json()) as { decision: string }).decision).toBe('DENIED');
  await request.post('/api/robots/1/recover');

  const lost = await request.post('/api/robots/1/position', {
    data: { position: { x: 120, y: 90 }, quality: 'MISSING' },
  });
  expect(lost.ok()).toBeTruthy();
  await request.post('/api/robots/1/position', {
    data: { position: { x: 120, y: 90 }, quality: 'RELIABLE' },
  });
  await request.post('/api/robots/1/recover');
}

const rows = (page: Page) => page.getByRole('table').getByRole('row').filter({ hasText: /R-/ });
const filter = (page: Page) => page.getByRole('combobox', { name: 'Filtrar por severidad' });

test('CA-06.1 / CA-06.2 / CA-06.3 / CA-06.4: filtrar, estado vacío y restablecer sin tocar los incidentes', async ({
  page,
  request,
}) => {
  await provokeIncidents(request);
  const all = await listIncidents(request);
  const bySeverity = Object.fromEntries(
    await Promise.all(SEVERITIES.map(async (s) => [s, await listIncidents(request, s)] as const)),
  ) as Record<Sev, IncidentDto[]>;
  expect(bySeverity.HIGH.length).toBeGreaterThan(0);
  expect(bySeverity.LOW.length).toBeGreaterThan(0);

  await page.goto('/#/supervision');
  await page.getByRole('link', { name: /Incidentes/ }).click();
  await expect(rows(page)).toHaveCount(all.length);
  const initial = await rows(page).allInnerTexts();

  // CA-06.1: solo las filas del nivel elegido, con su insignia.
  await filter(page).selectOption('HIGH');
  await expect(rows(page)).toHaveCount(bySeverity.HIGH.length);
  for (const text of await rows(page).allInnerTexts()) expect(text).toContain('HIGH');
  await expect(page.getByTestId('incident-counter')).toHaveText(
    `${bySeverity.HIGH.length} eventos`,
  );

  await filter(page).selectOption('LOW');
  await expect(rows(page)).toHaveCount(bySeverity.LOW.length);
  for (const text of await rows(page).allInnerTexts()) expect(text).toContain('LOW');

  // CA-06.4: una severidad sin incidentes muestra el estado vacío con mensaje claro.
  const empty = SEVERITIES.find((s) => bySeverity[s].length === 0);
  expect(empty, 'alguna severidad debe quedar sin incidentes').toBeDefined();
  await filter(page).selectOption(empty!);
  await expect(page.getByRole('status')).toHaveText(`No hay incidentes de severidad ${empty}.`);
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByTestId('incident-counter')).toHaveText('0 eventos');

  // CA-06.2: restablecer devuelve el listado completo, idéntico al inicial.
  await page.getByRole('button', { name: 'Restablecer filtro' }).click();
  await expect(rows(page)).toHaveCount(all.length);
  expect(await rows(page).allInnerTexts()).toEqual(initial);
  await expect(page.getByRole('button', { name: 'Restablecer filtro' })).toBeDisabled();

  // CA-06.3: filtrar no creó, cambió ni borró incidentes.
  expect(await listIncidents(request)).toEqual(all);
});
