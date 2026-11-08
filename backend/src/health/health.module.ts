import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/** EP-20. */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
