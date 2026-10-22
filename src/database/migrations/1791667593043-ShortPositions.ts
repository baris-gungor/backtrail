import { MigrationInterface, QueryRunner } from 'typeorm';

export class ShortPositions1791667593043 implements MigrationInterface {
  name = 'ShortPositions1791667593043';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "backtest_trades" ADD "side" character varying(5) NOT NULL DEFAULT 'long'`,
    );
    await queryRunner.query(
      `ALTER TABLE "portfolio_subscriptions" ADD "direction" character varying(5) NOT NULL DEFAULT 'long'`,
    );
    await queryRunner.query(
      `ALTER TABLE "closed_trades" ADD "side" character varying(5) NOT NULL DEFAULT 'long'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "closed_trades" DROP COLUMN "side"`);
    await queryRunner.query(`ALTER TABLE "portfolio_subscriptions" DROP COLUMN "direction"`);
    await queryRunner.query(`ALTER TABLE "backtest_trades" DROP COLUMN "side"`);
  }
}
