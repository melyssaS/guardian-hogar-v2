import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

// Spec 003 — tarea 23 (HU-03). E2E del flujo de movimiento con el backend real.
// Base `:memory:` sembrada: A1 en (120, 90) y V2 en (488, 290); Escaleras y Cuarto del bebé
// restringidas, Sala permitida. Cada prueba deja los robots y las zonas como los encontró.
// A1 (robot-1) es el robot por defecto; Supervisión vive en `#/supervision` (RC-15, RC-19).

const requestMove = (page: Page) =>
  page.getByRole('button', { name: /Solicitar movimiento/ }).click();

async function typeDestination(page: Page, x: number, y: number) {
  await page.getByLabel('Destino X').fill(String(x));
  await page.getByLabel('Destino Y').fill(String(y));
}

test('CA-03.1 destino libre por coordenadas → AUTHORIZED y el robot cambia de posición', async ({
  page,
}) => {
  await page.goto('/#/supervision');
  const robot = page.getByTestId('robot-1');
  await expect(robot).toHaveAttribute('data-x', '120');

  await typeDestination(page, 450, 120);
  await requestMove(page);
  await expect(page.getByTestId('decision')).toContainText('AUTHORIZED');
  await expect(robot).toHaveAttribute('data-x', '450');
  await expect(page.getByTestId('robot-state')).toHaveText('IDLE');

  // El estado vive en el servidor: se conserva al recargar.
  await page.reload();
  await expect(page.getByTestId('robot-1')).toHaveAttribute('data-x', '450');

  // Vuelta al punto de partida.
  await typeDestination(page, 120, 90);
  await requestMove(page);
  await expect(page.getByTestId('robot-1')).toHaveAttribute('data-x', '120');
});

test('CA-03.2 / CA-03.4 clic en zona → parada preventiva; denegación; liberar parada → IDLE', async ({
  page,
}) => {
  await page.goto('/#/supervision');
  await expect(page.getByTestId('robot-1')).toHaveAttribute('data-state', 'IDLE');

  // Clic en el plano sobre las Escaleras: fija el destino (RF-01.1).
  await page.getByTestId('floor-plan').locator('g[data-state]', { hasText: 'Escaleras' }).click();
  await expect(page.getByLabel('Destino X')).not.toHaveValue('');
  await requestMove(page);

  const stop = page.getByTestId('preventive-stop');
  await expect(stop).toBeVisible();
  await expect(stop).toContainText('Escaleras');
  await expect(page.getByTestId('robot-state')).toHaveText('SAFE_STOP');
  await expect(page.getByTestId('robot-1')).toHaveAttribute('data-x', '120');

  // En SAFE_STOP cualquier movimiento se deniega (409 REJECTED SAFE_STOP_ACTIVE).
  await typeDestination(page, 450, 120);
  await requestMove(page);
  await expect(page.getByTestId('rejected')).toContainText('SAFE_STOP_ACTIVE');

  await page.getByRole('button', { name: /Liberar parada/ }).click();
  await expect(page.getByRole('status')).toHaveText('Parada liberada: robot en IDLE');
  await expect(page.getByTestId('robot-state')).toHaveText('IDLE');
  await expect(page.getByTestId('robot-1')).toHaveAttribute('data-state', 'IDLE');

  // RC-22 (CA-03.9): la denegación dejó un incidente visible en «Incidentes».
  await page.getByRole('link', { name: /Incidentes/ }).click();
  const row = page.getByRole('row', { name: /Aspiradora A1.*R-ZONA-01.*Escaleras/ });
  await expect(row.first()).toBeVisible();
});

// ---------------------------------------------------------------------------------------------
// RC-22 / RC-25 — casos nuevos. Estado compartido (workers=1, una sola base `:memory:`): cada
// prueba deja los robots semilla en IDLE y la zona «Sala» permitida, como la encontró. El único
// residuo permitido es el robot registrado en RC-22 (el catálogo no tiene baja); no afecta a
// rooms.spec.ts ni a las demás pruebas, que no cuentan robots.
// ---------------------------------------------------------------------------------------------

interface ZoneDto {
  id: number;
  name: string;
  active: boolean;
}

async function setZoneActive(request: APIRequestContext, name: string, active: boolean) {
  const list = await request.get('/api/zones?active=all');
  const zone = ((await list.json()) as ZoneDto[]).find((z) => z.name === name);
  if (!zone) throw new Error(`Zona ${name} no encontrada`);
  const res = await request.put(`/api/zones/${zone.id}`, { data: { active } });
  expect(res.ok()).toBeTruthy();
}

async function incidentCount(request: APIRequestContext): Promise<number> {
  const res = await request.get('/api/incidents');
  return ((await res.json()) as unknown[]).length;
}

const kpi = async (page: Page, id: string) => Number(await page.getByTestId(id).innerText());

test('CA-03.13 / CA-03.14: recover con el robot en zona activa → UNSAFE_POSITION; al desactivarla → OK', async ({
  page,
  request,
}) => {
  try {
    await page.goto('/#/supervision');
    await page.getByRole('button', { name: /Enviar a escaleras/ }).click();
    await expect(page.getByTestId('robot-state')).toHaveText('SAFE_STOP');

    // El robot (120, 90) queda dentro de «Sala» al restringirla: no es seguro liberarlo.
    await setZoneActive(request, 'Sala', true);
    await page.getByRole('button', { name: /Liberar parada/ }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'UNSAFE_POSITION' })).toBeVisible();
    await expect(page.getByTestId('robot-state')).toHaveText('SAFE_STOP');

    await setZoneActive(request, 'Sala', false);
    await page.getByRole('button', { name: /Liberar parada/ }).click();
    await expect(page.getByRole('status')).toHaveText('Parada liberada: robot en IDLE');
    await expect(page.getByTestId('robot-state')).toHaveText('IDLE');
  } finally {
    // Limpieza robusta aunque falle antes: «Sala» permitida y A1 fuera de SAFE_STOP (vía API).
    await setZoneActive(request, 'Sala', false);
    await request.post('/api/robots/1/recover');
  }
});

test('CA-03.15: perder conexión → DEGRADED + R-SIGNAL-01; recuperar señal y liberar → IDLE', async ({
  page,
  request,
}) => {
  const before = await incidentCount(request);
  await page.goto('/#/supervision');
  await page.getByRole('button', { name: /Perder conexión/ }).click();
  await expect(page.getByTestId('robot-state')).toHaveText('DEGRADED');
  await expect.poll(() => incidentCount(request)).toBe(before + 1);

  await page.getByRole('link', { name: /Incidentes/ }).click();
  await expect(page.getByRole('row', { name: /Aspiradora A1.*R-SIGNAL-01/ }).first()).toBeVisible();

  await page.getByRole('link', { name: /Supervisión/ }).click();
  await page.getByRole('button', { name: /Recuperar señal/ }).click();
  await page.getByRole('button', { name: /Liberar parada/ }).click();
  await expect(page.getByTestId('robot-state')).toHaveText('IDLE');
});

test('CA-03.18 / CA-03.31: registrar robot → aparece en (120, 90) en IDLE y sigue tras recargar', async ({
  page,
}) => {
  await page.goto('/#/robots');
  await page.getByRole('button', { name: /Registrar robot/ }).click();
  await page.getByLabel('Nombre del robot').fill('Aspiradora E2E');
  await page.getByRole('button', { name: 'Registrar en simulación' }).click();

  const card = page.locator('[data-testid^="robot-card-"]', { hasText: 'Aspiradora E2E' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('IDLE');
  await expect(card).toContainText('(120, 90)');

  await page.reload();
  await expect(card).toBeVisible();
  await expect(card).toContainText('(120, 90)');
});

test('CA-03.22 / CA-03.32: con «Sala» restringida el alta se rechaza con ROBOT_START_IN_RESTRICTED_ZONE', async ({
  page,
  request,
}) => {
  await setZoneActive(request, 'Sala', true);
  try {
    await page.goto('/#/robots');
    await page.getByRole('button', { name: /Registrar robot/ }).click();
    await page.getByLabel('Nombre del robot').fill('Robot en zona');
    await page.getByRole('button', { name: 'Registrar en simulación' }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
      'ROBOT_START_IN_RESTRICTED_ZONE',
    );
    await expect(
      page.locator('[data-testid^="robot-card-"]', { hasText: 'Robot en zona' }),
    ).toHaveCount(0);
  } finally {
    await setZoneActive(request, 'Sala', false);
  }
});

test('CA-03.11: reenviar la misma sequence → DUPLICATE_EVENT sin incidente nuevo', async ({
  request,
}) => {
  const session = await request.post('/api/robots/1/sessions');
  const { sessionId } = (await session.json()) as { sessionId: string };
  const command = { destination: { x: 130, y: 95 }, sessionId, sequence: 1 };

  const first = await request.post('/api/robots/1/move', { data: command });
  expect(first.status()).toBe(200);
  const before = await incidentCount(request);

  const again = await request.post('/api/robots/1/move', { data: command });
  expect(again.status()).toBe(409);
  expect(((await again.json()) as { code: string }).code).toBe('DUPLICATE_EVENT');
  expect(await incidentCount(request)).toBe(before);

  // Vuelta al punto de partida (sequence nueva) para dejar el estado como se encontró.
  const back = await request.post('/api/robots/1/move', {
    data: { destination: { x: 120, y: 90 }, sessionId, sequence: 2 },
  });
  expect(back.status()).toBe(200);
});

test('CA-03.16 / CA-03.2 / CA-03.29: Vigilante V2 a escaleras → DENIED solo para él; «Solicitudes procesadas» sube', async ({
  page,
}) => {
  await page.goto('/#/supervision');
  // Los dos robots de la semilla están en el plano.
  await expect(page.getByTestId('robot-1')).toHaveAttribute('data-state', 'IDLE');
  await expect(page.getByTestId('robot-2')).toHaveAttribute('data-state', 'IDLE');

  await page.getByLabel('Elegir robot').selectOption({ label: 'Vigilante V2' });
  // Solo con la posición semilla de V2 en pantalla el indicador ya es el de V2 (no el de A1).
  await expect(page.getByTestId('robot-position')).toHaveText('(488, 290)');
  const start = await kpi(page, 'kpi-requests');

  await page.getByRole('button', { name: /Enviar a escaleras/ }).click();
  await expect(page.getByTestId('decision')).toContainText('DENIED');
  await expect(page.getByTestId('robot-state')).toHaveText('SAFE_STOP');
  await expect(page.getByTestId('robot-2')).toHaveAttribute('data-state', 'SAFE_STOP');
  await expect(page.getByTestId('robot-1')).toHaveAttribute('data-state', 'IDLE');
  await expect(page.getByTestId('kpi-requests')).toHaveText(String(start + 1));

  // Un segundo envío (tras liberar) vuelve a subir el indicador.
  await page.getByRole('button', { name: /Liberar parada/ }).click();
  await expect(page.getByTestId('robot-state')).toHaveText('IDLE');
  await typeDestination(page, 450, 120);
  await requestMove(page);
  await expect(page.getByTestId('decision')).toContainText('AUTHORIZED');
  await expect(page.getByTestId('kpi-requests')).toHaveText(String(start + 2));

  // Vuelta al punto de partida de V2 (488, 290), dejándolo como se encontró.
  await typeDestination(page, 488, 290);
  await requestMove(page);
  await expect(page.getByTestId('kpi-requests')).toHaveText(String(start + 3));
  await expect(page.getByTestId('decision')).toContainText('AUTHORIZED');
  const v2 = page.getByTestId('robot-2');
  await expect(v2).toHaveAttribute('data-x', '488');
  await expect(v2).toHaveAttribute('data-y', '290');
  await expect(v2).toHaveAttribute('data-state', 'IDLE');
});
