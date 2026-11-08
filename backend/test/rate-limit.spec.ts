import { describe, expect, it } from 'vitest';
import { Reflector } from '@nestjs/core';
import { AppException } from '../src/common/errors';
import { AuthGuard, AuthRateLimited, BookingRateLimitGuard, Public } from '../src/common/guards';
import { RateLimiterService } from '../src/common/rate-limiter.service';
import { TokensService } from '../src/auth/tokens.service';
import { FakePool, asPool, rows } from './support/fake-pool';
import { createContext, createRequest, patientUser } from './support/http';

/**
 * RF-14: rate limiting.
 *
 * Auth endpoints: 5 requests per minute per IP; booking: 10 per minute per
 * user. Exceeding a quota is a 429 carrying `Retry-After` (the filter turns
 * `retryAfterSeconds` into the header).
 */

function statusOf(error: unknown): number | undefined {
  return error instanceof AppException ? error.getStatus() : undefined;
}

class PublicController {
  @Public()
  @AuthRateLimited()
  login(): void {
    return undefined;
  }
}

class ProtectedController {
  agenda(): void {
    return undefined;
  }
}

function guardFor(limiter: RateLimiterService): AuthGuard {
  const pool = new FakePool();
  pool.answer(/FROM token_sesion/, rows([]));
  return new AuthGuard(new Reflector(), new TokensService(asPool(pool)), limiter);
}

describe('auth quota (5 req/min per IP)', () => {
  it('allows five requests and rejects the sixth with 429', async () => {
    const limiter = new RateLimiterService();
    const guard = guardFor(limiter);
    const context = (): ReturnType<typeof createContext> =>
      createContext({
        handler: PublicController.prototype.login,
        controller: PublicController,
        request: createRequest({ headers: { 'x-forwarded-for': '203.0.113.7' } }),
      });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(guard.canActivate(context())).resolves.toBe(true);
    }

    await expect(guard.canActivate(context())).rejects.toSatisfy(
      (error: unknown) => statusOf(error) === 429,
    );
  });

  it('counts each client IP separately', async () => {
    const limiter = new RateLimiterService();
    const guard = guardFor(limiter);
    const contextFor = (ip: string): ReturnType<typeof createContext> =>
      createContext({
        handler: PublicController.prototype.login,
        controller: PublicController,
        request: createRequest({ headers: { 'x-forwarded-for': ip } }),
      });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await guard.canActivate(contextFor('198.51.100.1'));
    }
    await expect(guard.canActivate(contextFor('198.51.100.2'))).resolves.toBe(true);
  });

  it('refunds a successful authentication', async () => {
    const limiter = new RateLimiterService();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      limiter.consume('auth', '10.0.0.1', 5);
    }
    limiter.clear('auth', '10.0.0.1');
    expect(limiter.consume('auth', '10.0.0.1', 5).allowed).toBe(true);
  });

  it('reports a retry hint between 1 and 60 seconds', () => {
    const limiter = new RateLimiterService();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      limiter.consume('auth', '10.0.0.2', 5);
    }
    const decision = limiter.consume('auth', '10.0.0.2', 5);
    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(decision.retryAfterSeconds).toBeLessThanOrEqual(60);
  });
});

describe('booking quota (10 req/min per user)', () => {
  it('allows ten bookings and rejects the eleventh with 429', () => {
    const limiter = new RateLimiterService();
    const guard = new BookingRateLimitGuard(limiter);
    const context = (): ReturnType<typeof createContext> =>
      createContext({
        handler: ProtectedController.prototype.agenda,
        controller: ProtectedController,
        request: createRequest({ user: patientUser(3, 1) }),
      });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(guard.canActivate(context())).toBe(true);
    }
    expect(() => guard.canActivate(context())).toThrowError(
      expect.objectContaining({ code: 'rate_limited' }),
    );
  });

  it('keys the quota by user, not by IP', () => {
    const limiter = new RateLimiterService();
    const guard = new BookingRateLimitGuard(limiter);
    const contextFor = (userId: number): ReturnType<typeof createContext> =>
      createContext({
        handler: ProtectedController.prototype.agenda,
        controller: ProtectedController,
        request: createRequest({ user: patientUser(userId, userId) }),
      });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      guard.canActivate(contextFor(3));
    }
    expect(guard.canActivate(contextFor(4))).toBe(true);
  });
});
