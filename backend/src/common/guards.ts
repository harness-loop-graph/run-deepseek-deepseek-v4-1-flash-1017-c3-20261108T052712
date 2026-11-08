import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppException, forbidden, rateLimited, unauthorized } from './errors';
import { AuthUser, RoleName } from '../auth/auth-user';
import { TokensService } from '../auth/tokens.service';
import { HttpRequest, clientIp } from './http.types';
import { RateLimiterService } from './rate-limiter.service';
import { rateLimits } from './app-config';

export const PUBLIC_ROUTE = 'medapp:public';
export const ROLES_KEY = 'medapp:roles';
export const AUTH_RATE_LIMIT_KEY = 'medapp:auth-rate-limit';

/** Marks a route as reachable without an access token (EP-01..EP-04, EP-20). */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(PUBLIC_ROUTE, true);

/** Declares the roles allowed to call a route (RF-09). */
export const Roles = (...roles: RoleName[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);

/** Applies the 5 req/min per IP auth quota (RF-14). */
export const AuthRateLimited = (): MethodDecorator & ClassDecorator =>
  SetMetadata(AUTH_RATE_LIMIT_KEY, true);

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser | undefined => {
    const request = context.switchToHttp().getRequest<HttpRequest>();
    return request.user;
  },
);

function bearerToken(request: HttpRequest): string | undefined {
  const header = request.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string') {
    return undefined;
  }
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match?.[1]?.trim();
}

/**
 * Authentication guard (RF-08, RF-09).
 *
 * Resolves the bearer token against the session table on every request, so an
 * expired or revoked token is rejected immediately. Public routes skip the
 * token check but still pass through the auth rate limiter.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
    private readonly limiter: RateLimiterService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const controller = context.getClass();
    const isPublic =
      this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [handler, controller]) === true;
    const authLimited =
      this.reflector.getAllAndOverride<boolean>(AUTH_RATE_LIMIT_KEY, [handler, controller]) === true;

    const request = context.switchToHttp().getRequest<HttpRequest>();

    if (authLimited) {
      const decision = this.limiter.consume(
        'auth',
        clientIp(request),
        rateLimits().authPerMinute,
      );
      if (!decision.allowed) {
        throw rateLimited('Too many authentication requests. Retry later.', decision.retryAfterSeconds);
      }
    }

    if (isPublic) {
      return true;
    }

    const token = bearerToken(request);
    if (token === undefined) {
      throw unauthorized('A bearer access token is required.');
    }

    request.user = await this.tokens.resolveAccessToken(token);
    return true;
  }
}

/**
 * Role guard (RF-09). Runs after `AuthGuard`, which is why the caller is
 * always resolved by the time this guard decides.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<RoleName[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required === undefined || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<HttpRequest>();
    const user = request.user;
    if (user === undefined) {
      throw unauthorized('A bearer access token is required.');
    }
    if (!required.some((role) => user.roles.includes(role))) {
      throw forbidden();
    }
    return true;
  }
}

/**
 * Booking quota (RF-14): 10 bookings per minute per authenticated user.
 * Implemented as a guard so it runs before the transaction opens.
 */
@Injectable()
export class BookingRateLimitGuard implements CanActivate {
  constructor(private readonly limiter: RateLimiterService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<HttpRequest>();
    const user = request.user;
    const key = user === undefined ? clientIp(request) : `user:${user.userId}`;
    const decision = this.limiter.consume('booking', key, rateLimits().bookingPerMinute);
    if (!decision.allowed) {
      throw rateLimited('Too many booking attempts. Retry later.', decision.retryAfterSeconds);
    }
    return true;
  }
}

export function assertNotForbidden(condition: boolean): void {
  if (!condition) {
    throw forbidden();
  }
}

export function assertFound<T>(value: T | undefined): T {
  if (value === undefined || value === null) {
    throw new AppException(404, 'not_found', 'Resource not found.');
  }
  return value;
}
