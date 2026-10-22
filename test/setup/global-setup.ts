import { execSync } from 'node:child_process';
import { config } from 'dotenv';
import { Client } from 'pg';
import type { TestProject } from 'vitest/node';

/** Creates the e2e database if needed and applies all migrations to it. */
export default async function globalSetup(project: TestProject): Promise<void> {
  config();
  Object.assign(process.env, project.config.env);
  const database = process.env.DB_NAME;

  const admin = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: 'postgres',
  });
  await admin.connect();
  const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
    database,
  ]);
  if (!rowCount) await admin.query(`CREATE DATABASE "${database}"`);
  await admin.end();

  execSync('npm run migration:run', { stdio: 'ignore', env: process.env });
}
