import { createApp } from './app.js';
import { bootstrap } from './db/bootstrap.js';
import { getDb } from './db/connection.js';
import { initDatabase } from './db/seed.js';
const db = getDb();
initDatabase(db);
// ADR-10 (spec 002 §6, R6.3): reinicio seguro del robot, una sola vez al arrancar el servicio.
bootstrap(db);
const port = Number(process.env.PORT ?? 3000);
createApp(db).listen(port, () => {
    console.log(`Guardián Hogar API escuchando en http://localhost:${port}`);
});
