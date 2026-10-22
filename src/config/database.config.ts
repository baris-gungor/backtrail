import { registerAs } from '@nestjs/config';

export interface DatabaseConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  logging: boolean;
}

export const databaseConfig = registerAs('database', (): DatabaseConfig => ({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USER ?? '',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME ?? '',
  logging: process.env.DB_LOGGING === 'true',
}));
