import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

// Spec 007 — T12 (CA-07.10): humo E2E de la exportación CSV contra el backend real (`:memory:`).

test('HU-07: "Exportar CSV" descarga incidentes-YYYY-MM-DD.csv generado por el backend', async ({
  page,
}) => {
  await page.goto('/#/incidentes');
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Filtrar por severidad' })).toBeEnabled();

  const button = page.getByRole('button', { name: 'Exportar CSV · HU-07' });
  await expect(button).toBeEnabled();
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);

  expect(download.suggestedFilename()).toMatch(/^incidentes-\d{4}-\d{2}-\d{2}\.csv$/);
  const path = await download.path();
  const bytes = await readFile(path);
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  expect(bytes.subarray(3).toString('utf8').split('\r\n')[0]).toBe(
    'id,robotId,robotName,rule,zoneName,decisionCode,collisionType,stateAfter,originX,originY,destX,destY,reason,createdAt',
  );
});
