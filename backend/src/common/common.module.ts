import { Global, Module } from '@nestjs/common';
import { RateLimiterService } from './rate-limiter.service';

/**
 * Cross-cutting providers shared by every module (RF-14).
 *
 * `RateLimiterService` is process-local by design: the deployment is a single
 * Compose stack, so one in-memory window per backend is the exact quota the
 * specification asks for.
 */
@Global()
@Module({
  providers: [RateLimiterService],
  exports: [RateLimiterService],
})
export class CommonModule {}
