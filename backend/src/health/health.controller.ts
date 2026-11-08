import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/guards';

/**
 * EP-20: liveness probe.
 *
 * The response is deliberately independent of the database: `DatabaseModule`
 * awaits migrations and seed before the listener opens, so a 200 already
 * implies a usable schema. Compose uses this endpoint as its healthcheck.
 */
@Controller()
export class HealthController {
  @Public()
  @Get('health')
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
