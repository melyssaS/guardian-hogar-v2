import { validationError } from '../errors/AppError.js';
/**
 * Valida y sanea `req[source]` con Zod (RNF-01). Si falla, responde con el error de
 * `toError`: por defecto 422 VALIDATION_ERROR; /api/simulation usa INVALID_DESTINATION.
 */
export function validate(schema, source = 'body', toError = validationError) {
    return (req, _res, next) => {
        const result = schema.safeParse(req[source]);
        if (!result.success) {
            const message = result.error.issues
                .map((i) => `${i.path.join('.') || source}: ${i.message}`)
                .join('; ');
            next(toError(message));
            return;
        }
        // req.query es un getter en Express 5; aquí (Express 4) se puede reasignar.
        req[source] = result.data;
        next();
    };
}
