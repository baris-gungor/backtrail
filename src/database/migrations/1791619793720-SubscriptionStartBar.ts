import { MigrationInterface, QueryRunner } from 'typeorm';

export class SubscriptionStartBar1791619793720 implements MigrationInterface {
  name = 'SubscriptionStartBar1791619793720';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "portfolio_subscriptions" ADD "start_bar_time" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "portfolio_subscriptions" DROP COLUMN "start_bar_time"`);
  }
}
