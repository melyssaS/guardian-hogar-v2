import cors from 'cors';
import express, { type Express } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import type { Db } from './db/connection.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { createMovementLogRepository } from './repositories/movementLogRepository.js';
import { createRobotRepository } from './repositories/robotRepository.js';
import { createZoneRepository } from './repositories/zoneRepository.js';
import { createSimulationRoutes } from './routes/simulationRoutes.js';
import { createZoneRoutes } from './routes/zoneRoutes.js';
import { createMovementService } from './services/movementService.js';
import { createZoneService } from './services/zoneService.js';

export interface AppOptions {
  /** Orígenes CORS permitidos. Por defecto, `CORS_ORIGINS` separado por comas. */
  corsOrigins?: string[];
  /** Peticiones por minuto por IP en /api. */
  rateLimitPerMinute?: number;
}

/** Construye la app Express con sus dependencias inyectadas (permite `:memory:` en pruebas). */
export function createApp(db: Db, options: AppOptions = {}): Express {
  const corsOrigins =
    options.corsOrigins ??
    (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);

  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: corsOrigins }));
  app.use(express.json({ limit: '10kb' }));
  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: options.rateLimitPerMinute ?? 300,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests' },
    }),
  );

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  const zoneRepository = createZoneRepository(db);
  app.use('/api/zones', createZoneRoutes(createZoneService(zoneRepository)));

  const movementService = createMovementService({
    robots: createRobotRepository(db),
    movementLog: createMovementLogRepository(db),
    getActiveZones: () => zoneRepository.findAll('active'),
    runInTransaction: (fn) => db.transaction(fn)(),
  });
  app.use('/api/simulation', createSimulationRoutes(movementService));

  app.use('/api', (_req, res) => {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Route not found' });
  });
  app.use(errorHandler);
  return app;
}
