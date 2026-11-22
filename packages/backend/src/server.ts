import { createApp } from './app.js';
import { getDb } from './db/connection.js';
import { initDatabase } from './db/seed.js';

const db = getDb();
initDatabase(db);

const port = Number(process.env.PORT ?? 3000);
createApp(db).listen(port, () => {
  console.log(`Guardián Hogar API escuchando en http://localhost:${port}`);
});
