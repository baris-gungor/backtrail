import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { basicAuth } from './common/auth/basic-auth.middleware';
import { authConfig } from './config';

/** HTTP pipeline shared by main.ts and e2e tests. */
export function configureApp(app: INestApplication): void {
  // Registered before routes and Swagger, so it covers every path except the public health check.
  const auth = app.get<ConfigType<typeof authConfig>>(authConfig.KEY);
  if (auth.enabled) {
    app.use(basicAuth(auth.username, auth.password));
  } else {
    new Logger('Auth').warn(
      'AUTH_USERNAME / AUTH_PASSWORD are not set: the API is open to anyone who can reach it',
    );
  }
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();
}
