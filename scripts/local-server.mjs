import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, pbkdf2Sync } from 'node:crypto';
import worker from '../dist/server/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = resolve(root, process.env.LOCAL_DATA_DIR || '.local');
await mkdir(dataDir, { recursive: true });
const configPath = resolve(dataDir, 'admin.json');
let config;
if (existsSync(configPath)) config = JSON.parse(await readFile(configPath, 'utf8'));
else {
  const password = randomBytes(9).toString('base64url');
  const salt = randomBytes(16);
  config = {
    password,
    hash: salt.toString('hex') + ':' + pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex'),
    sessionKey: randomBytes(32).toString('hex')
  };
  await writeFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
}
const sqlite = new DatabaseSync(resolve(dataDir, 'site.sqlite'));
sqlite.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY)');
for (const file of ['0000_site_state.sql', '0001_admin_attempts.sql']) {
  if (!sqlite.prepare('SELECT name FROM local_migrations WHERE name=?').get(file)) {
    sqlite.exec('BEGIN');
    try {
      sqlite.exec(readFileSync(resolve(root, 'drizzle', file), 'utf8'));
      sqlite.prepare('INSERT INTO local_migrations (name) VALUES (?)').run(file);
      sqlite.exec('COMMIT');
    } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  }
}
const DB = {
  prepare(sql) {
    const statement = sqlite.prepare(sql);
    const make = args => ({
      bind: (...values) => make(values),
      first: async () => statement.get(...args) || null,
      run: async () => { const result = statement.run(...args); return { meta: { changes: Number(result.changes) } }; }
    });
    return make([]);
  }
};
function photoPath(key) {
  if (!/^players\/[a-zA-Z0-9_-]{1,64}\/[a-f0-9-]{36}$/.test(key)) throw new Error('Chave de foto inválida');
  return resolve(dataDir, 'photos', key);
}
const BUCKET = {
  async put(key, stream, metadata) {
    const path = photoPath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, Buffer.from(await new Response(stream).arrayBuffer()));
    await writeFile(path + '.json', JSON.stringify(metadata.httpMetadata || {}));
  },
  async get(key) {
    const path = photoPath(key);
    try { return { body: await readFile(path), httpMetadata: JSON.parse(await readFile(path + '.json', 'utf8')) }; }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  },
  async delete(key) {
    const path = photoPath(key);
    for (const file of [path, path + '.json']) { try { await unlink(file); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  }
};
const env = { DB, BUCKET, ADMIN_PASSWORD_HASH: config.hash, ADMIN_SESSION_KEY: config.sessionKey };
const port = Number(process.env.PORT || 8787);
const server = createServer(async (incoming, outgoing) => {
  try {
    const chunks = []; let size = 0;
    for await (const chunk of incoming) {
      size += chunk.length;
      if (size > 3 * 1024 * 1024) { outgoing.writeHead(413); outgoing.end('Arquivo muito grande'); return; }
      chunks.push(chunk);
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
    const method = incoming.method || 'GET';
    const request = new Request(new URL(incoming.url, `http://localhost:${port}`), {
      method, headers, ...(method === 'GET' || method === 'HEAD' ? {} : { body: Buffer.concat(chunks) })
    });
    const response = await worker.fetch(request, env);
    outgoing.statusCode = response.status;
    for (const [key, value] of response.headers) {
      // This adapter listens only on loopback HTTP; the hosted Worker keeps Secure cookies.
      outgoing.setHeader(key, key === 'set-cookie' ? value.replace(/; Secure/g, '') : value);
    }
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) { console.error(error); outgoing.writeHead(500); outgoing.end('Erro no servidor local'); }
});
server.on('error', error => { console.error('Não foi possível iniciar:', error.message); process.exitCode = 1; sqlite.close(); });
server.listen(port, '127.0.0.1', () => {
  console.log(`\nFC BAGRES: http://localhost:${port}`);
  console.log(`Senha do admin LOCAL: ${config.password}`);
  console.log('Dados e fotos: ' + dataDir);
  console.log('Para encerrar: Ctrl+C\n');
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { sqlite.close(); process.exit(0); }));
