import fs from 'node:fs';
import path from 'node:path';

const EMPTY = { families: {}, users: {}, wishes: {}, sessions: {} };

export function createStore(file) {
  let data = structuredClone(EMPTY);
  if (fs.existsSync(file)) {
    const loaded = JSON.parse(fs.readFileSync(file, 'utf8'));
    data = { ...structuredClone(EMPTY), ...loaded };
  }

  function save() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  }

  return { file, data, save };
}
