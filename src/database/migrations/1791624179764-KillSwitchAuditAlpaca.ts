import { MigrationInterface, QueryRunner } from 'typeorm';

export class KillSwitchAuditAlpaca1791624179764 implements MigrationInterface {
  name = 'KillSwitchAuditAlpaca1791624179764';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "audit_events" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "actor" character varying(16) NOT NULL, "action" character varying(64) NOT NULL, "entity_type" character varying(32) NOT NULL, "entity_id" character varying(64), "before" jsonb, "after" jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_910f64d901a5c3e9878f0d4a407" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_497bb4f7c4c55db9749616cd2a" ON "audit_events"  ("created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5c7623cfe8d008e1c1fd758fbc" ON "audit_events"  ("entity_type", "entity_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "broker_accounts" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "portfolio_id" uuid NOT NULL, "broker" character varying(16) NOT NULL, "environment" character varying(8) NOT NULL DEFAULT 'paper', "account_ref" character varying(64) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_53469a523fd3a7e9eb9a4629cff" UNIQUE ("account_ref"), CONSTRAINT "REL_098abc45ef10dbfc3144c1d5ac" UNIQUE ("portfolio_id"), CONSTRAINT "PK_2e5ca0caf331244f0f855ab3215" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "trading_state" ("id" integer NOT NULL, "halted" boolean NOT NULL DEFAULT false, "reason" text, "changed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_1ca5155bc6b9ae86e59180d9e44" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "reconciliation_runs" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "portfolio_id" uuid NOT NULL, "status" character varying(8) NOT NULL, "diffs" jsonb NOT NULL, "broker_cash" numeric, "broker_equity" numeric, "error" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_4edbdb165c9e754997036a4176a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_16a15794219ef5aab6021f52f6" ON "reconciliation_runs"  ("portfolio_id", "created_at") `,
    );
    await queryRunner.query(`ALTER TABLE "portfolios" ADD "halted_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "portfolios" ADD "halt_reason" text`);
    // Widened in place; the generated DROP + ADD would lose existing values.
    await queryRunner.query(
      `ALTER TABLE "portfolios" ALTER COLUMN "mode" TYPE character varying(16)`,
    );
    await queryRunner.query(
      `ALTER TABLE "broker_accounts" ADD CONSTRAINT "FK_098abc45ef10dbfc3144c1d5acd" FOREIGN KEY ("portfolio_id") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "FK_dfb254da1272a78a5090a2c7fc4" FOREIGN KEY ("portfolio_id") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "reconciliation_runs" DROP CONSTRAINT "FK_dfb254da1272a78a5090a2c7fc4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "broker_accounts" DROP CONSTRAINT "FK_098abc45ef10dbfc3144c1d5acd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "portfolios" ALTER COLUMN "mode" TYPE character varying(8)`,
    );
    await queryRunner.query(`ALTER TABLE "portfolios" DROP COLUMN "halt_reason"`);
    await queryRunner.query(`ALTER TABLE "portfolios" DROP COLUMN "halted_at"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_16a15794219ef5aab6021f52f6"`);
    await queryRunner.query(`DROP TABLE "reconciliation_runs"`);
    await queryRunner.query(`DROP TABLE "trading_state"`);
    await queryRunner.query(`DROP TABLE "broker_accounts"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_5c7623cfe8d008e1c1fd758fbc"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_497bb4f7c4c55db9749616cd2a"`);
    await queryRunner.query(`DROP TABLE "audit_events"`);
  }
}
