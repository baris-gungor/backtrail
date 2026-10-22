import { Module } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseConfig } from '../config';
import { SnakeNamingStrategy } from './snake-naming.strategy';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [databaseConfig.KEY],
      useFactory: (db: ConfigType<typeof databaseConfig>) => ({
        type: 'postgres',
        host: db.host,
        port: db.port,
        username: db.username,
        password: db.password,
        database: db.database,
        logging: db.logging,
        autoLoadEntities: true,
        synchronize: false,
        migrationsRun: false,
        uuidExtension: 'pgcrypto',
        namingStrategy: new SnakeNamingStrategy(),
      }),
    }),
  ],
})
export class DatabaseModule {}
