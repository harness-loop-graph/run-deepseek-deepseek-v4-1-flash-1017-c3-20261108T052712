import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AvailabilityModule } from '../availability/availability.module';

/** EP-15 .. EP-19 (administration, roles, availability, audit query). */
@Module({
  imports: [AvailabilityModule],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
