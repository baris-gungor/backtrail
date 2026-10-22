import { MigrationInterface, QueryRunner } from 'typeorm';

export class AssetProxy1791654742157 implements MigrationInterface {
  name = 'AssetProxy1791654742157';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "assets" ADD "proxy_for_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "assets" ADD CONSTRAINT "FK_e8cd49e1ad68396352d01925fc8" FOREIGN KEY ("proxy_for_id") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "assets" DROP CONSTRAINT "FK_e8cd49e1ad68396352d01925fc8"`,
    );
    await queryRunner.query(`ALTER TABLE "assets" DROP COLUMN "proxy_for_id"`);
  }
}
