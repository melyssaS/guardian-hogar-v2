// `npm run migrate`: mismo arranque que el servidor (migra y siembra si la base es nueva).
import { getDb } from './connection.js';
import { initDatabase } from './seed.js';
initDatabase(getDb());
console.log('Base de datos lista');
