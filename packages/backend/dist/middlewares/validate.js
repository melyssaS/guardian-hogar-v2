import { validationError } from '../errors/AppError.js';
/** Valida y sanea `req[source]` con Zod; si falla, responde 422 VALIDATION_ERROR (RNF-01). */
export function validate(schema, source = 'body') {
    return (req, _res, next) => {
        const result = schema.safeParse(req[source]);
        if (!result.success) {
            const message = result.error.issues
                .map((i) => `${i.path.join('.') || source}: ${i.message}`)
                .join('; ');
            next(validationError(message));
            return;
        }
        // req.query es un getter en Express 5; aquí (Express 4) se puede reasignar.
        req[source] = result.data;
        next();
    };
}
