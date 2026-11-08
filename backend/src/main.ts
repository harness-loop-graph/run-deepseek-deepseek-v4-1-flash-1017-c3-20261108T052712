import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { corsOrigins } from './common/app-config';

/**
 * HTTP entry point (EP-20 and the whole endpoint catalog).
 *
 * The data layer (migrations + deterministic seed) is initialised by
 * `DatabaseModule.onModuleInit`, which Nest awaits before the listener opens:
 * a 200 from `GET /health` therefore implies a migrated and seeded schema
 * (RF-02, RF-05, RF-27).
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  app.useGlobalFilters(new AllExceptionsFilter());

  // The SPA is served from another origin (:8080) and sends the bearer token.
  app.enableCors({
    origin: corsOrigins(),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Accept'],
    exposedHeaders: ['Retry-After', 'Content-Disposition', 'Content-Type'],
    maxAge: 600,
  });

  // The backend runs behind a Compose network; trusting the proxy hop lets the
  // rate limiter see the real client address (RF-14).
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.enableShutdownHooks();

  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  await app.listen(Number.isFinite(port) && port > 0 ? port : 3000, '0.0.0.0');
  logger.log(`API listening on http://0.0.0.0:${port}`);
}

bootstrap().catch((error: unknown) => {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error';
  new Logger('Bootstrap').error(`startup failed: ${detail}`);
  process.exitCode = 1;
});
