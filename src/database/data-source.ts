import 'dotenv/config';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from './snake-naming.strategy';

/**
 * Standalone DataSource used only by the TypeORM CLI (migrations).
 * The application itself configures TypeORM through DatabaseModule.
 */
export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  logging: process.env.DB_LOGGING === 'true',
  synchronize: false,
  uuidExtension: 'pgcrypto',
  namingStrategy: new SnakeNamingStrategy(),
  entities: [__dirname + '/../**/*.entity.{ts,js}'],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
});
