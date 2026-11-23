import { expect, test, type Page } from '@playwright/test';

// Cada ejecución arranca un backend con base `:memory:` sembrada con las 5 habitaciones.
// Las pruebas comparten ese backend, así que cada una deja el estado como lo encontró.

const zoneShape = (page: Page, name: string) =>
  page.getByTestId('floor-plan').locator('g[data-state]', { hasText: name });

test('HU-01: plano con cuadrícula y las 5 habitaciones del prototipo', async ({ page }) => {
  await page.goto('/#/zonas');
  const plan = page.getByTestId('floor-plan');
  await expect(plan).toHaveAttribute('viewBox', '0 0 1000 800');
  await expect(page.getByTestId('grid').locator('line')).toHaveCount(20);

  await expect(plan.locator('g[data-state]')).toHaveCount(5);
  for (const name of ['Sala', 'Cocina', 'Pasillo']) {
    await expect(zoneShape(page, name)).toHaveAttribute('data-state', 'allowed');
  }
  for (const name of ['Escaleras', 'Cuarto del bebé']) {
    const shape = zoneShape(page, name);
    await expect(shape).toHaveAttribute('data-state', 'restricted');
    await expect(shape.locator('rect').first()).toHaveAttribute('stroke-dasharray', '7 5');
  }
  await expect(page.getByTestId('restricted-count')).toHaveText('2 restringidas');
});

test('HU-02: el switch restringe y permite una habitación como en el prototipo', async ({
  page,
}) => {
  await page.goto('/#/zonas');
  await page.getByRole('button', { name: 'Restringir Pasillo' }).click();
  await expect(zoneShape(page, 'Pasillo')).toHaveAttribute('data-state', 'restricted');
  await expect(page.getByTestId('restricted-count')).toHaveText('3 restringidas');
  await expect(page.getByRole('status')).toHaveText('Pasillo restringida');

  // El cambio persiste al recargar (RF-04.1)
  await page.reload();
  await expect(zoneShape(page, 'Pasillo')).toHaveAttribute('data-state', 'restricted');

  await page.getByRole('button', { name: 'Permitir Pasillo' }).click();
  await expect(zoneShape(page, 'Pasillo')).toHaveAttribute('data-state', 'allowed');
  await expect(page.getByTestId('restricted-count')).toHaveText('2 restringidas');
});

test('HU-02: crear una zona, verla destacada y eliminarla', async ({ page }) => {
  await page.goto('/#/zonas');
  const form = page.getByRole('form', { name: 'Nueva zona' });
  await form.getByLabel('Nombre').fill('Estudio');
  await form.getByLabel('X').fill('600');
  await form.getByLabel('Y').fill('30');
  await form.getByLabel('Ancho').fill('200');
  await form.getByLabel('Alto').fill('178');
  await form.getByRole('button', { name: 'Crear zona' }).click();

  const shape = zoneShape(page, 'Estudio');
  await expect(shape).toHaveAttribute('data-state', 'restricted');
  await expect(shape.locator('rect').first()).toHaveAttribute('x', '600');
  await expect(page.getByTestId('restricted-count')).toHaveText('3 restringidas');

  await page.getByRole('button', { name: 'Eliminar Estudio' }).click();
  await expect(shape).toHaveCount(0);
  await expect(page.getByTestId('restricted-count')).toHaveText('2 restringidas');
});

test('RC-14: catálogo de reglas visible y el historial registra los cambios de Pasillo', async ({
  page,
  request,
}) => {
  await page.goto('/#/zonas');

  // La tarjeta «Catálogo de reglas» muestra R-ZONA-01 (RF-06.3, CA-02.12).
  const catalog = page.getByTestId('rule-R-ZONA-01');
  await expect(catalog).toContainText('R-ZONA-01');

  // Restringir y luego permitir «Pasillo» deja el estado como se encontró (inicialmente permitida).
  await page.getByRole('button', { name: 'Restringir Pasillo' }).click(); // ACTIVATE
  await expect(zoneShape(page, 'Pasillo')).toHaveAttribute('data-state', 'restricted');
  await page.getByRole('button', { name: 'Permitir Pasillo' }).click(); // DEACTIVATE
  await expect(zoneShape(page, 'Pasillo')).toHaveAttribute('data-state', 'allowed');

  // El historial (API) contiene ACTIVATE y DEACTIVATE de esa zona (CA-02.9).
  const res = await request.get('/api/zones/changes');
  expect(res.ok()).toBeTruthy();
  const changes = (await res.json()) as Array<{ action: string; before: { name: string } | null }>;
  const actions = changes.filter((c) => c.before?.name === 'Pasillo').map((c) => c.action);
  expect(actions).toContain('ACTIVATE');
  expect(actions).toContain('DEACTIVATE');
});

test('CA-02.2: el servidor rechaza un nombre duplicado y se muestra el error', async ({ page }) => {
  await page.goto('/#/zonas');
  const form = page.getByRole('form', { name: 'Nueva zona' });
  await form.getByLabel('Nombre').fill('Sala');
  await form.getByRole('button', { name: 'Crear zona' }).click();
  await expect(page.getByRole('alert')).toContainText('ZONE_NAME_DUPLICATE');
});
