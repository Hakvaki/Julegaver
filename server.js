import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './src/app.js';
import { createStore } from './src/store.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const dataFile = process.env.DATA_FILE || path.join(here, 'data', 'db.json');

const store = createStore(dataFile);
const server = createApp({ store });

server.listen(port, () => {
  console.log(`🎄 Julegaver kjører på http://localhost:${port}`);
  console.log(`   Data lagres i ${dataFile}`);
});
