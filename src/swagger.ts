import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * OpenAPI docs at /api/docs (JSON at /api/docs-json).
 * Schemas come from the @nestjs/swagger CLI plugin (nest-cli.json): it reads
 * *.dto.ts / *.entity.ts classes, class-validator rules and JSDoc comments at build time.
 */
export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('backtrail API')
    .setDescription('Market data, technical analysis and signals')
    .setVersion('0.2.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, { jsonDocumentUrl: 'api/docs-json' });
}
