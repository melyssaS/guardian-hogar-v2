import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { errorHandler } from './middlewares/errorHandler.js';
import { createZoneRepository } from './repositories/zoneRepository.js';
import { createZoneRoutes } from './routes/zoneRoutes.js';
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
    const zoneService = createZoneService(createZoneRepository(db));
    app.use('/api/zones', createZoneRoutes(zoneService));
    app.use('/api', (_req, res) => {
        res.status(404).json({ code: 'NOT_FOUND', message: 'Route not found' });
    });
    app.use(errorHandler);
    return app;
}
