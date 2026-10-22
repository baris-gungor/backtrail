import { MigrationInterface, QueryRunner } from 'typeorm';

/** Walk-forward runs: longer `source` values and the `walk_forward` column. */
export class WalkForward1791653758186 implements MigrationInterface {
  name = 'WalkForward1791653758186';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "backtest_runs" ADD "walk_forward" jsonb`);
    // Generated as DROP + ADD, which loses data; widening the type keeps the values.
    await queryRunner.query(
      `ALTER TABLE "backtest_runs" ALTER COLUMN "source" TYPE character varying(16)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "backtest_runs" WHERE "source" = 'walk_forward'`);
    await queryRunner.query(
      `ALTER TABLE "backtest_runs" ALTER COLUMN "source" TYPE character varying(8)`,
    );
    await queryRunner.query(`ALTER TABLE "backtest_runs" DROP COLUMN "walk_forward"`);
  }
}
