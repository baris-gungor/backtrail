import { MigrationInterface, QueryRunner } from 'typeorm';

export class EarningsEvents1791659542807 implements MigrationInterface {
  name = 'EarningsEvents1791659542807';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "earnings_events" ("asset_id" uuid NOT NULL, "reported_at" TIMESTAMP WITH TIME ZONE NOT NULL, "source" character varying(8) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_612aed1cac78623cba57880ab10" PRIMARY KEY ("asset_id", "reported_at"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "earnings_events" ADD CONSTRAINT "FK_6e76b620b4e1106e404e9476a82" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "earnings_events" DROP CONSTRAINT "FK_6e76b620b4e1106e404e9476a82"`,
    );
    await queryRunner.query(`DROP TABLE "earnings_events"`);
  }
}
