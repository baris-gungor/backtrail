import { MigrationInterface, QueryRunner } from 'typeorm';

export class PaperTrading1791616933521 implements MigrationInterface {
  name = 'PaperTrading1791616933521';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "portfolios" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "name" character varying(64) NOT NULL, "mode" character varying(8) NOT NULL DEFAULT 'paper', "base_currency" character varying(8) NOT NULL DEFAULT 'USD', "initial_cash" numeric NOT NULL, "cash_balance" numeric NOT NULL, "risk_rules" jsonb NOT NULL, "execution" jsonb NOT NULL, "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "UQ_29f7b2bcfa0d26fa6699015037f" UNIQUE ("name"), CONSTRAINT "PK_488aa6e9b219d1d9087126871ae" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "closed_trades" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "portfolio_id" uuid NOT NULL, "asset_id" uuid NOT NULL, "subscription_id" uuid, "strategy_config_id" uuid, "entry_time" TIMESTAMP WITH TIME ZONE NOT NULL, "entry_price" numeric(18,6) NOT NULL, "exit_time" TIMESTAMP WITH TIME ZONE NOT NULL, "exit_price" numeric(18,6) NOT NULL, "quantity" numeric NOT NULL, "fees" numeric NOT NULL, "pnl" numeric NOT NULL, "return_pct" numeric(10,6) NOT NULL, "exit_reason" character varying(16) NOT NULL, "bars_held" integer, CONSTRAINT "PK_52b1409a01063c5315b9b82e789" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5429e2612c1acd59ca6ed59aa9" ON "closed_trades"  ("portfolio_id", "exit_time") `,
    );
    await queryRunner.query(
      `CREATE TABLE "portfolio_subscriptions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "portfolio_id" uuid NOT NULL, "strategy_config_id" uuid NOT NULL, "asset_id" uuid NOT NULL, "source" character varying(8) NOT NULL DEFAULT 'strategy', "allocation_pct" numeric(5,2), "is_active" boolean NOT NULL DEFAULT true, "last_bar_time" TIMESTAMP WITH TIME ZONE, "state" jsonb NOT NULL, CONSTRAINT "UQ_66c562637c08e7ac04b39e80ddd" UNIQUE ("portfolio_id", "strategy_config_id", "asset_id"), CONSTRAINT "PK_8feadf62f119753e49c764bbb23" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "orders" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "portfolio_id" uuid NOT NULL, "asset_id" uuid NOT NULL, "side" character varying(4) NOT NULL, "type" character varying(8) NOT NULL, "quantity" numeric, "notional" numeric, "limit_price" numeric(18,6), "stop_loss" numeric(18,6), "take_profit" numeric(18,6), "status" character varying(16) NOT NULL, "source" character varying(16) NOT NULL, "bar_time" TIMESTAMP WITH TIME ZONE, "signal_id" uuid, "subscription_id" uuid, "reject_reason" text, "broker_order_id" character varying(64), "client_order_id" character varying(128) NOT NULL, "filled_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_4717fea05a52eee586e633f83f1" UNIQUE ("client_order_id"), CONSTRAINT "UQ_eae01674173a2ea08fc1910f03b" UNIQUE ("portfolio_id", "signal_id"), CONSTRAINT "PK_710e2d4957aa5878dfe94e4ac2f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_86a4dcd81f3cfa624aca35d802" ON "orders"  ("portfolio_id", "status") `,
    );
    await queryRunner.query(
      `CREATE TABLE "fills" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "order_id" uuid NOT NULL, "portfolio_id" uuid NOT NULL, "asset_id" uuid NOT NULL, "side" character varying(4) NOT NULL, "quantity" numeric NOT NULL, "price" numeric(18,6) NOT NULL, "fee" numeric NOT NULL, "executed_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_4cc862cbabbb5c3e5c3a381f70f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_404c04281ae87ff6597a0d2a3f" ON "fills"  ("portfolio_id", "executed_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "performance_snapshots" ("portfolio_id" uuid NOT NULL, "at" TIMESTAMP WITH TIME ZONE NOT NULL, "equity" numeric NOT NULL, "cash" numeric NOT NULL, "positions_value" numeric NOT NULL, "drawdown" numeric(8,6) NOT NULL, CONSTRAINT "PK_4afcc7d89a8e4b3e3052241b7e1" PRIMARY KEY ("portfolio_id", "at"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "positions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "portfolio_id" uuid NOT NULL, "asset_id" uuid NOT NULL, "subscription_id" uuid, "quantity" numeric NOT NULL, "avg_price" numeric NOT NULL, "entry_fee" numeric NOT NULL, "stop_loss" numeric(18,6), "take_profit" numeric(18,6), "opened_at" TIMESTAMP WITH TIME ZONE NOT NULL, "last_bar_time" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_f9746f2c62850ca93194011d1c3" UNIQUE ("portfolio_id", "asset_id"), CONSTRAINT "PK_17e4e62ccd5749b289ae3fae6f3" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "closed_trades" ADD CONSTRAINT "FK_93f390ed5ad1d75b2b1693343fd" FOREIGN KEY ("portfolio_id") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "closed_trades" ADD CONSTRAINT "FK_9851e3bdd659715181ca521ecbd" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "portfolio_subscriptions" ADD CONSTRAINT "FK_4f5cd6ba8a92c77d3c30948e920" FOREIGN KEY ("portfolio_id") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "portfolio_subscriptions" ADD CONSTRAINT "FK_bca11750488e6e92f8666e0b2ab" FOREIGN KEY ("strategy_config_id") REFERENCES "strategy_configs"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "portfolio_subscriptions" ADD CONSTRAINT "FK_47740f7bd3f5a43d2f1e089fbc3" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ADD CONSTRAINT "FK_3914c2025c99f6d7b1fec8f9fe9" FOREIGN KEY ("portfolio_id") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ADD CONSTRAINT "FK_055606f75e7ed988a209b0cc22c" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ADD CONSTRAINT "FK_90033964cd684ad3da9e02c2256" FOREIGN KEY ("signal_id") REFERENCES "signals"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ADD CONSTRAINT "FK_a99c67e713ffa08f499b2c79d57" FOREIGN KEY ("subscription_id") REFERENCES "portfolio_subscriptions"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "fills" ADD CONSTRAINT "FK_ddd61518887654876e925de2df5" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "performance_snapshots" ADD CONSTRAINT "FK_f084b31d91af92b457009627142" FOREIGN KEY ("portfolio_id") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "positions" ADD CONSTRAINT "FK_b33a787a18160c7f098da6e7737" FOREIGN KEY ("portfolio_id") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "positions" ADD CONSTRAINT "FK_b524d83318e95aade6a4490c965" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "positions" ADD CONSTRAINT "FK_64e9b99077c76c6b690139b0c33" FOREIGN KEY ("subscription_id") REFERENCES "portfolio_subscriptions"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "positions" DROP CONSTRAINT "FK_64e9b99077c76c6b690139b0c33"`,
    );
    await queryRunner.query(
      `ALTER TABLE "positions" DROP CONSTRAINT "FK_b524d83318e95aade6a4490c965"`,
    );
    await queryRunner.query(
      `ALTER TABLE "positions" DROP CONSTRAINT "FK_b33a787a18160c7f098da6e7737"`,
    );
    await queryRunner.query(
      `ALTER TABLE "performance_snapshots" DROP CONSTRAINT "FK_f084b31d91af92b457009627142"`,
    );
    await queryRunner.query(`ALTER TABLE "fills" DROP CONSTRAINT "FK_ddd61518887654876e925de2df5"`);
    await queryRunner.query(
      `ALTER TABLE "orders" DROP CONSTRAINT "FK_a99c67e713ffa08f499b2c79d57"`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" DROP CONSTRAINT "FK_90033964cd684ad3da9e02c2256"`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" DROP CONSTRAINT "FK_055606f75e7ed988a209b0cc22c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" DROP CONSTRAINT "FK_3914c2025c99f6d7b1fec8f9fe9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "portfolio_subscriptions" DROP CONSTRAINT "FK_47740f7bd3f5a43d2f1e089fbc3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "portfolio_subscriptions" DROP CONSTRAINT "FK_bca11750488e6e92f8666e0b2ab"`,
    );
    await queryRunner.query(
      `ALTER TABLE "portfolio_subscriptions" DROP CONSTRAINT "FK_4f5cd6ba8a92c77d3c30948e920"`,
    );
    await queryRunner.query(
      `ALTER TABLE "closed_trades" DROP CONSTRAINT "FK_9851e3bdd659715181ca521ecbd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "closed_trades" DROP CONSTRAINT "FK_93f390ed5ad1d75b2b1693343fd"`,
    );
    await queryRunner.query(`DROP TABLE "positions"`);
    await queryRunner.query(`DROP TABLE "performance_snapshots"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_404c04281ae87ff6597a0d2a3f"`);
    await queryRunner.query(`DROP TABLE "fills"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_86a4dcd81f3cfa624aca35d802"`);
    await queryRunner.query(`DROP TABLE "orders"`);
    await queryRunner.query(`DROP TABLE "portfolio_subscriptions"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_5429e2612c1acd59ca6ed59aa9"`);
    await queryRunner.query(`DROP TABLE "closed_trades"`);
    await queryRunner.query(`DROP TABLE "portfolios"`);
  }
}
