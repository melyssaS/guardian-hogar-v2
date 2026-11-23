// `npm run migrate`: mismo arranque que el servidor (migra y siembra si la base es nueva).
import { bootstrap } from './bootstrap.js';
import { getDb } from './connection.js';
import { initDatabase } from './seed.js';

const db = getDb();
initDatabase(db);
// ADR-10 (spec 002 §6, R6.5): mismo reinicio seguro que el servidor.
bootstrap(db);
console.log('Base de datos lista');
