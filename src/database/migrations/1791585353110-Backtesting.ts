import { MigrationInterface, QueryRunner } from 'typeorm';

export class Backtesting1791585353110 implements MigrationInterface {
  name = 'Backtesting1791585353110';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "backtest_runs" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "batch_id" uuid NOT NULL, "source" character varying(8) NOT NULL, "strategy_code" character varying(64) NOT NULL, "strategy_version" integer NOT NULL, "strategy_config_id" uuid, "config_name" character varying(64), "params" jsonb NOT NULL, "asset_id" uuid NOT NULL, "timeframe" character varying(8) NOT NULL, "period_from" TIMESTAMP WITH TIME ZONE, "period_to" TIMESTAMP WITH TIME ZONE, "segment" character varying(8) NOT NULL, "initial_capital" numeric(18,2) NOT NULL, "execution" jsonb NOT NULL, "status" character varying(16) NOT NULL, "metrics" jsonb, "equity_curve" jsonb, "benchmark_curve" jsonb, "error" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "started_at" TIMESTAMP WITH TIME ZONE, "finished_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_a8a1cef0162fdbbb0cc9920ca5c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_af7a166489aaa3aea3779ecb9b" ON "backtest_runs"  ("batch_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fdcaeb229398f81e55b8120828" ON "backtest_runs"  ("asset_id", "strategy_code") `,
    );
    await queryRunner.query(
      `CREATE TABLE "backtest_trades" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "run_id" uuid NOT NULL, "entry_time" TIMESTAMP WITH TIME ZONE NOT NULL, "entry_price" numeric(18,6) NOT NULL, "exit_time" TIMESTAMP WITH TIME ZONE NOT NULL, "exit_price" numeric(18,6) NOT NULL, "quantity" numeric(18,6) NOT NULL, "fees" numeric(18,6) NOT NULL, "pnl" numeric(18,2) NOT NULL, "return_pct" numeric(10,6) NOT NULL, "exit_reason" character varying(16) NOT NULL, "bars_held" integer NOT NULL, CONSTRAINT "PK_f167e5734703aebc8cd49b4f4b0" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e1977c1fcc2b47121f637e1af8" ON "backtest_trades"  ("run_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "backtest_runs" ADD CONSTRAINT "FK_92a974fc7debeff43e56f3af297" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "backtest_runs" ADD CONSTRAINT "FK_8b81b97b6036e749a8b1d77b241" FOREIGN KEY ("strategy_config_id") REFERENCES "strategy_configs"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "backtest_trades" ADD CONSTRAINT "FK_e1977c1fcc2b47121f637e1af83" FOREIGN KEY ("run_id") REFERENCES "backtest_runs"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "backtest_trades" DROP CONSTRAINT "FK_e1977c1fcc2b47121f637e1af83"`,
    );
    await queryRunner.query(
      `ALTER TABLE "backtest_runs" DROP CONSTRAINT "FK_8b81b97b6036e749a8b1d77b241"`,
    );
    await queryRunner.query(
      `ALTER TABLE "backtest_runs" DROP CONSTRAINT "FK_92a974fc7debeff43e56f3af297"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_e1977c1fcc2b47121f637e1af8"`);
    await queryRunner.query(`DROP TABLE "backtest_trades"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_fdcaeb229398f81e55b8120828"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_af7a166489aaa3aea3779ecb9b"`);
    await queryRunner.query(`DROP TABLE "backtest_runs"`);
  }
}
