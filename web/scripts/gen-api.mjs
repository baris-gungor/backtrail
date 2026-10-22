// Regenerates src/api/schema.d.ts from the running backend's OpenAPI document.
// Node instead of shell expansion, because npm runs scripts through cmd.exe on Windows.
// openapi-typescript runs through npx: it wants TypeScript 5 as a peer, the project uses 6.
import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The backend is behind Basic Auth when AUTH_USERNAME / AUTH_PASSWORD are set in the root .env.
const rootEnv = new URL('../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
const { AUTH_USERNAME: user, AUTH_PASSWORD: pass } = process.env;
const headers =
  user && pass
    ? { authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` }
    : {};

const base = process.env.API_URL ?? 'http://localhost:3000';
const res = await fetch(`${base}/api/docs-json`, { headers });
if (!res.ok) throw new Error(`GET ${base}/api/docs-json: ${res.status}`);

const dir = mkdtempSync(join(tmpdir(), 'backtrail-openapi-'));
const spec = join(dir, 'openapi.json');
try {
  writeFileSync(spec, await res.text());
  execSync(
    `npx -y openapi-typescript@7.13.0 "${spec}" -o src/api/schema.d.ts && npx prettier --write src/api/schema.d.ts`,
    { stdio: 'inherit' },
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
