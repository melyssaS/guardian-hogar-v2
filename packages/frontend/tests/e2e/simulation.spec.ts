import { expect, test, type Page } from '@playwright/test';

// Spec 003 — tarea 23 (HU-03), adaptada al vocabulario del vigilante en RC-15 (robot-<id>:
// A1 es el robot seleccionado por defecto). Backend real con base `:memory:` sembrada: robot en (120, 90),
// Sala; Escaleras y Cuarto del bebé restringidas. Cada prueba deja el robot como lo encontró.

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
  await expect(page.getByTestId('robot-state')).toHaveText('IDLE');
  await expect(page.getByTestId('robot-1')).toHaveAttribute('data-state', 'IDLE');
});
