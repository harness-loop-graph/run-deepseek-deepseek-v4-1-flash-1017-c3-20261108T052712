import { Injectable } from '@nestjs/common';

/**
 * Sliding-window rate limiter (RF-14).
 *
 * In-memory by design: the deployment is a single local Compose stack, so a
 * process-local window is the exact quota the specification asks for. Keys
 * are the client IP for the auth endpoints and the caller id for bookings.
 */
interface Window {
  hits: number[];
}

export interface RateDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

@Injectable()
export class RateLimiterService {
  private readonly windows = new Map<string, Window>();

  /** Records a hit and reports whether the quota is still respected. */
  consume(bucket: string, key: string, limit: number, windowMs = 60_000): RateDecision {
    const now = Date.now();
    const composite = `${bucket}:${key}`;
    const existing = this.windows.get(composite) ?? { hits: [] };
    const recent = existing.hits.filter((timestamp) => now - timestamp < windowMs);

    if (recent.length >= limit) {
      const oldest = recent[0];
      const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));
      this.windows.set(composite, { hits: recent });
      return { allowed: false, retryAfterSeconds };
    }

    recent.push(now);
    this.windows.set(composite, { hits: recent });
    this.evict(now, windowMs);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  /**
   * Clears the window of one key.
   *
   * The auth endpoints use it to refund a successful authentication: the quota
   * of RF-14 limits authentication *attempts* (a client hammering the token
   * endpoint with bad credentials), while a legitimate login of a real user
   * never counts against the next one. This keeps the quota effective without
   * locking a whole office behind one NAT address out of its own sessions.
   */
  clear(bucket: string, key: string): void {
    this.windows.delete(`${bucket}:${key}`);
  }

  /** Clears every window (used by the tests). */
  reset(): void {
    this.windows.clear();
  }

  private evict(now: number, windowMs: number): void {
    if (this.windows.size < 1000) {
      return;
    }
    for (const [key, window] of this.windows) {
      if (window.hits.every((timestamp) => now - timestamp >= windowMs)) {
        this.windows.delete(key);
      }
    }
  }
}
