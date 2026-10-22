import { MigrationInterface, QueryRunner } from 'typeorm';

export class MarketDataInit1791577596308 implements MigrationInterface {
  name = 'MarketDataInit1791577596308';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "assets" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "symbol" character varying(32) NOT NULL, "name" character varying(255) NOT NULL, "asset_class" character varying(16) NOT NULL, "exchange" character varying(64), "currency" character varying(8) NOT NULL, "provider" character varying(32) NOT NULL, "session_type" character varying(16) NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "last_synced_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_9b4bd5b9c6fe49cd3b4342fb914" UNIQUE ("symbol"), CONSTRAINT "PK_da96729a8b113377cfb6a62439c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "price_bars" ("asset_id" uuid NOT NULL, "timeframe" character varying(8) NOT NULL, "open_time" TIMESTAMP WITH TIME ZONE NOT NULL, "open" numeric(18,6) NOT NULL, "high" numeric(18,6) NOT NULL, "low" numeric(18,6) NOT NULL, "close" numeric(18,6) NOT NULL, "volume" numeric(24,4) NOT NULL, "is_complete" boolean NOT NULL, CONSTRAINT "PK_41a3c5f1b39e11cf45d17bf400f" PRIMARY KEY ("asset_id", "timeframe", "open_time"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "ingestion_runs" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "asset_id" uuid NOT NULL, "provider" character varying(32) NOT NULL, "status" character varying(16) NOT NULL, "range_from" TIMESTAMP WITH TIME ZONE NOT NULL, "range_to" TIMESTAMP WITH TIME ZONE NOT NULL, "hourly_bars_upserted" integer NOT NULL DEFAULT '0', "four_hour_bars_upserted" integer NOT NULL DEFAULT '0', "error" text, "started_at" TIMESTAMP WITH TIME ZONE NOT NULL, "finished_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_e9476c02c52a0dac026b859858a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_56a18379ee2e99a6c5a8cd3a6d" ON "ingestion_runs"  ("asset_id", "started_at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "price_bars" ADD CONSTRAINT "FK_d9a7e10ea13fd64954d51a9da05" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ingestion_runs" ADD CONSTRAINT "FK_1a67d7c89ab63d1e065b977beb6" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ingestion_runs" DROP CONSTRAINT "FK_1a67d7c89ab63d1e065b977beb6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "price_bars" DROP CONSTRAINT "FK_d9a7e10ea13fd64954d51a9da05"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_56a18379ee2e99a6c5a8cd3a6d"`);
    await queryRunner.query(`DROP TABLE "ingestion_runs"`);
    await queryRunner.query(`DROP TABLE "price_bars"`);
    await queryRunner.query(`DROP TABLE "assets"`);
  }
}
