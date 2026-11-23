import { AppError } from '../errors/AppError.js';
/** Traduce errores a `{ code, message }` (RNF-05). Nunca expone stack traces (RNF-04). */
export function errorHandler(err, _req, res, _next) {
    if (err instanceof AppError) {
        res
            .status(err.status)
            .json(err.cause === undefined
            ? { code: err.code, message: err.message }
            : { code: err.code, message: err.message, cause: err.cause });
        return;
    }
    // JSON mal formado en el body (express.json)
    if (typeof err === 'object' &&
        err !== null &&
        'type' in err &&
        err.type === 'entity.parse.failed') {
        res.status(400).json({ code: 'INVALID_JSON', message: 'Malformed JSON body' });
        return;
    }
    console.error(err);
    res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
}
