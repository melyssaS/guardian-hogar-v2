import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import type { Db } from '../../src/db/connection.js';
import { seedDefaultRooms } from '../../src/db/seed.js';
import { createTestDb } from '../helpers.js';

// Spec 002 RC-18 (R10.1–R10.3, R10.5, R10.7; Property 12) + spec 003 RC-20 (parte de la UI):
// una sola prueba de arquitectura del vigilante único. Es el "rojo esperado" de RC-20, paso (0).

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = resolve(HERE, '../..');
const BACKEND_SRC = join(BACKEND, 'src');
const BACKEND_TESTS = join(BACKEND, 'tests');
const DOMAIN_SRC = resolve(BACKEND, '../domain/src');
const FRONTEND_SRC = resolve(BACKEND, '../frontend/src');
const FRONTEND_TESTS = resolve(BACKEND, '../frontend/tests');
const SELF = fileURLToPath(import.meta.url);

/** Archivos `.ts`/`.tsx` de un directorio, recursivo, con rutas absolutas. */
function listSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return listSources(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

/** Quita comentarios de bloque y de línea (no toca cadenas con `//` dentro de una URL). */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

const IMPORT_RE =
  /(?:import|export)\s+(?:type\s+)?[^'";]*?from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;

/** Especificadores de todos los imports/re-exports de un archivo, incluidos `import type`. */
function importSpecifiers(source: string): string[] {
  return [...stripComments(source).matchAll(IMPORT_RE)].map((m) => m[1] ?? m[2] ?? m[3] ?? '');
}

/** Sentencias de importación completas (para buscar identificadores importados). */
function importStatements(source: string): string[] {
  return [...stripComments(source).matchAll(IMPORT_RE)].map((m) => m[0]);
}

const rel = (base: string, file: string) => relative(base, file).replaceAll('\\', '/');

describe('Property 12 — vigilante único (spec 002 RC-18)', () => {
  const srcFiles = listSources(BACKEND_SRC);

  it('el literal robot_state en sentencias SQL solo aparece en repositories/robotRepository.ts', () => {
    const offenders = srcFiles
      .filter((file) => {
        const code = stripComments(readFileSync(file, 'utf8'));
        const sqlLiterals = [...code.matchAll(/(`[^`]*`|'[^'\n]*'|"[^"\n]*")/g)].map((m) => m[0]);
        return sqlLiterals.some(
          (lit) =>
            /robot_state/.test(lit) && /\b(SELECT|INSERT|UPDATE|DELETE|FROM|JOIN)\b/i.test(lit),
        );
      })
      .map((file) => rel(BACKEND_SRC, file));
    expect(offenders).toEqual(['repositories/robotRepository.ts']);
  });

  it('solo guardianService, transition (helper del vigilante) y el repositorio escriben el estado', () => {
    const writers = srcFiles
      .filter((file) =>
        /\.(saveState|saveQuality|insertInitial)\(/.test(stripComments(readFileSync(file, 'utf8'))),
      )
      .map((file) => rel(BACKEND_SRC, file))
      .sort();
    expect(writers).toEqual(['services/guardianService.ts', 'services/transition.ts']);
  });

  it('los imports de src (incluidos import type) de robotRepository son solo los autorizados', () => {
    const importers = srcFiles
      .filter((file) =>
        importSpecifiers(readFileSync(file, 'utf8')).some((s) => s.endsWith('/robotRepository.js')),
      )
      .map((file) => rel(BACKEND_SRC, file))
      .sort();
    expect(importers).toEqual([
      'app.ts',
      'db/bootstrap.ts',
      'services/guardianService.ts',
      'services/robotCatalogService.ts',
      'services/sessionService.ts',
      'services/transition.ts',
    ]);
  });

  it('src no importa ningún módulo del vigilante provisional retirado', () => {
    const retired =
      /(simulationRoutes|simulationController|movementService|watchmanRule|movementLogRepository|robotRoutes|simulation\.schema)(\.js)?$/;
    const offenders = srcFiles.flatMap((file) =>
      importSpecifiers(readFileSync(file, 'utf8'))
        .filter((s) => retired.test(s))
        .map((s) => `${rel(BACKEND_SRC, file)} -> ${s}`),
    );
    expect(offenders).toEqual([]);
  });

  it('los archivos del vigilante provisional ya no existen', () => {
    const gone = [
      'routes/simulationRoutes.ts',
      'controllers/simulationController.ts',
      'services/movementService.ts',
      'rules/watchmanRule.ts',
      'routes/robotRoutes.ts',
    ].filter((f) => existsSync(join(BACKEND_SRC, f)));
    expect(gone).toEqual([]);
    expect(existsSync(join(DOMAIN_SRC, 'schemas/simulation.schema.ts'))).toBe(false);
    expect(existsSync(join(DOMAIN_SRC, 'schemas/point.schema.ts'))).toBe(true);
  });

  it('el dominio ya no define los tipos Decision, MoveResult ni RobotSnapshot', () => {
    const offenders = listSources(DOMAIN_SRC).filter((file) =>
      /\b(?:interface|type)\s+(Decision|MoveResult|RobotSnapshot)\b/.test(
        stripComments(readFileSync(file, 'utf8')),
      ),
    );
    expect(offenders.map((f) => rel(DOMAIN_SRC, f))).toEqual([]);
  });

  it('robotRepository ya no expone los métodos antiguos de la fila única', () => {
    const code = stripComments(
      readFileSync(join(BACKEND_SRC, 'repositories/robotRepository.ts'), 'utf8'),
    );
    expect(code).not.toMatch(/\b(getFull|saveFull|getPositionQuality|setPositionQuality)\b/);
    expect(code).not.toMatch(/^\s*(get|save)\(/m);
    expect(code).not.toMatch(/RobotSnapshot/);
  });
});

describe('moveLegacy retirado (spec 002 RC-18, R10.7, rev5/rev6)', () => {
  // El nombre se arma por partes para que esta prueba no se referencie a sí misma.
  const name = ['move', 'Legacy'].join('');

  it('no existe en guardianService ni en el controller de robots', () => {
    for (const file of ['services/guardianService.ts', 'controllers/robotController.ts']) {
      expect(readFileSync(join(BACKEND_SRC, file), 'utf8'), file).not.toContain(name);
    }
  });

  it('no existe en el controller ningún handler legacy de /api/robot/*', () => {
    const code = readFileSync(join(BACKEND_SRC, 'controllers/robotController.ts'), 'utf8');
    expect(code).not.toContain('LEGACY_ROBOT_ID');
  });

  // Escaneo estático de las pruebas del backend y del frontend (src y tests). Los E2E y la
  // documentación quedan fuera del escaneo.
  it('ninguna prueba ni código del frontend lo referencia (escaneo estático)', () => {
    const scanned = [BACKEND_TESTS, FRONTEND_SRC, FRONTEND_TESTS].flatMap((dir) =>
      listSources(dir).map((file) => ({ dir, file })),
    );
    const offenders = scanned
      .filter(({ file }) => file !== SELF)
      .filter(({ file }) => readFileSync(file, 'utf8').includes(name))
      .map(({ dir, file }) => rel(dir, file));
    expect(offenders).toEqual([]);
    expect(existsSync(join(BACKEND_TESTS, 'unit', `${name}.test.ts`))).toBe(false);
  });
});

describe('UI sin tipos ni esquemas retirados (spec 003 RC-20, parte de la UI)', () => {
  it('la UI no importa Decision, MoveResult, RobotSnapshot ni simulation.schema', () => {
    const offenders = listSources(FRONTEND_SRC).flatMap((file) =>
      importStatements(readFileSync(file, 'utf8'))
        .filter((s) => /\b(Decision|MoveResult|RobotSnapshot)\b|simulation\.schema/.test(s))
        .map((s) => `${rel(FRONTEND_SRC, file)}: ${s.replace(/\s+/g, ' ')}`),
    );
    expect(offenders).toEqual([]);
  });
});

describe('rutas retiradas: /api/simulation/* y /api/robot/* → 404 (R10.2)', () => {
  let db: Db;
  let app: Express;
  beforeEach(() => {
    db = createTestDb();
    seedDefaultRooms(db);
    app = createApp(db, { corsOrigins: ['http://localhost:5173'] });
  });

  const DEST = { destination: { x: 450, y: 120 } };

  it.each([
    ['get', '/api/simulation/robot'],
    ['post', '/api/simulation/move'],
    ['post', '/api/simulation/reset'],
    ['get', '/api/robot/state'],
    ['post', '/api/robot/move'],
    ['post', '/api/robot/recover'],
    ['post', '/api/robot/position'],
  ] as const)('%s %s responde 404 NOT_FOUND', async (method, path) => {
    const res = await request(app)[method](path).send(DEST);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ code: 'NOT_FOUND', message: 'Route not found' });
  });

  it('un movimiento por las rutas retiradas no cambia el estado de ningún robot', async () => {
    await request(app)
      .post('/api/simulation/move')
      .send({ destination: { x: 450, y: 120 } });
    await request(app)
      .post('/api/robot/move')
      .send({ destination: { x: 450, y: 120 } });
    const rows = db
      .prepare('SELECT robot_id, pos_x, pos_y FROM robot_state ORDER BY robot_id')
      .all();
    expect(rows).toEqual([
      { robot_id: 1, pos_x: 120, pos_y: 90 },
      { robot_id: 2, pos_x: 488, pos_y: 290 },
    ]);
  });
});
