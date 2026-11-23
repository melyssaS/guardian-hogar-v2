import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { errorHandler } from './middlewares/errorHandler.js';
import { createAuditLogRepository } from './repositories/auditLogRepository.js';
import { createIncidentRepository } from './repositories/incidentRepository.js';
import { createMovementLogRepository } from './repositories/movementLogRepository.js';
import { createRobotRepository } from './repositories/robotRepository.js';
import { createZoneRepository } from './repositories/zoneRepository.js';
import { createIncidentRoutes } from './routes/incidentRoutes.js';
import { createRobotRoutes } from './routes/robotRoutes.js';
import { createSimulationRoutes } from './routes/simulationRoutes.js';
import { createZoneRoutes } from './routes/zoneRoutes.js';
import { createGuardianService } from './services/guardianService.js';
import { createMovementService } from './services/movementService.js';
import { createZoneService } from './services/zoneService.js';
/** Construye la app Express con sus dependencias inyectadas (permite `:memory:` en pruebas). */
export function createApp(db, options = {}) {
    const corsOrigins = options.corsOrigins ??
        (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
            .split(',')
            .map((o) => o.trim())
            .filter(Boolean);
    const app = express();
    app.disable('x-powered-by');
    app.use(helmet());
    app.use(cors({ origin: corsOrigins }));
    app.use(express.json({ limit: '10kb' }));
    app.use('/api', rateLimit({
        windowMs: 60_000,
        limit: options.rateLimitPerMinute ?? 300,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        message: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests' },
    }));
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
    // HU-04/HU-05 — vigilante de seguridad (spec 002 §6, §8.1). Inyección manual de
    // repositorios en el servicio (SOLID-D); comparte las zonas activas con el resto de la app.
    const incidentRepository = createIncidentRepository(db);
    const guardianService = createGuardianService({
        robots: createRobotRepository(db),
        incidents: incidentRepository,
        audit: createAuditLogRepository(db),
        getActiveZones: () => zoneRepository.findAll('active'),
        runInTransaction: (fn) => db.transaction(fn)(),
    });
    app.use('/api/robot', createRobotRoutes(guardianService));
    app.use('/api/incidents', createIncidentRoutes(incidentRepository));
    app.use('/api', (_req, res) => {
        res.status(404).json({ code: 'NOT_FOUND', message: 'Route not found' });
    });
    app.use(errorHandler);
    return app;
}
