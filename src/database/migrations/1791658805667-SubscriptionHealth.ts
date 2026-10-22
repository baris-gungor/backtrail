import { MigrationInterface, QueryRunner } from 'typeorm';

export class SubscriptionHealth1791658805667 implements MigrationInterface {
  name = 'SubscriptionHealth1791658805667';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "portfolio_subscriptions" ADD "health" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "portfolio_subscriptions" DROP COLUMN "health"`);
  }
}
