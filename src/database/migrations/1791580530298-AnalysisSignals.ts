import { MigrationInterface, QueryRunner } from 'typeorm';

export class AnalysisSignals1791580530298 implements MigrationInterface {
  name = 'AnalysisSignals1791580530298';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "strategies" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "code" character varying(64) NOT NULL, "name" character varying(255) NOT NULL, "version" integer NOT NULL, "description" text NOT NULL, "is_benchmark" boolean NOT NULL DEFAULT false, "default_params" jsonb NOT NULL, CONSTRAINT "UQ_fae2c5d1aa5b57a7dd2c455f05e" UNIQUE ("code"), CONSTRAINT "PK_9a0d363ddf5b40d080147363238" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "strategy_configs" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "strategy_id" uuid NOT NULL, "name" character varying(64) NOT NULL, "params" jsonb NOT NULL, "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "UQ_42716c56cd7a6eaafb7403c7496" UNIQUE ("strategy_id", "name"), CONSTRAINT "PK_cd727910996414502a739141731" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "signals" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "asset_id" uuid NOT NULL, "strategy_config_id" uuid NOT NULL, "timeframe" character varying(8) NOT NULL, "bar_time" TIMESTAMP WITH TIME ZONE NOT NULL, "side" character varying(4) NOT NULL, "strength" numeric(5,4) NOT NULL, "price" numeric(18,6) NOT NULL, "stop_loss" numeric(18,6), "take_profit" numeric(18,6), "reason" text NOT NULL, "indicators" jsonb NOT NULL, "strategy_version" integer NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_888dd7ebd8a03be9a253694dd4f" UNIQUE ("asset_id", "strategy_config_id", "timeframe", "bar_time"), CONSTRAINT "PK_04eeac09c09b65bc55c628c101d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7cefea63435da46ba5b82050fa" ON "signals"  ("asset_id", "bar_time") `,
    );
    await queryRunner.query(
      `ALTER TABLE "strategy_configs" ADD CONSTRAINT "FK_b3803facf7376d5e2f06e2b95be" FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "signals" ADD CONSTRAINT "FK_a162c9e99783c2b324f2f5c0469" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "signals" ADD CONSTRAINT "FK_99953fa9d5ec22b6422dfb03aa9" FOREIGN KEY ("strategy_config_id") REFERENCES "strategy_configs"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "signals" DROP CONSTRAINT "FK_99953fa9d5ec22b6422dfb03aa9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "signals" DROP CONSTRAINT "FK_a162c9e99783c2b324f2f5c0469"`,
    );
    await queryRunner.query(
      `ALTER TABLE "strategy_configs" DROP CONSTRAINT "FK_b3803facf7376d5e2f06e2b95be"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_7cefea63435da46ba5b82050fa"`);
    await queryRunner.query(`DROP TABLE "signals"`);
    await queryRunner.query(`DROP TABLE "strategy_configs"`);
    await queryRunner.query(`DROP TABLE "strategies"`);
  }
}
