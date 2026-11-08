import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AdminModule } from './admin/admin.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AvailabilityModule } from './availability/availability.module';
import { CommonModule } from './common/common.module';
import { AuthGuard, RolesGuard } from './common/guards';
import { DatabaseModule } from './database/database.module';
import { EncountersModule } from './encounters/encounters.module';
import { HealthModule } from './health/health.module';

/**
 * Root module of the REST API (RF-11).
 *
 * `DatabaseModule` runs the migrations and the deterministic seed before the
 * HTTP listener opens; `AuthGuard` resolves the bearer token of every request
 * and `RolesGuard` applies the role check declared by each route (RF-09). The
 * guards are registered globally in this order so authentication always runs
 * before authorization.
 */
@Module({
  imports: [
    CommonModule,
    DatabaseModule,
    AuditModule,
    AuthModule,
    HealthModule,
    AppointmentsModule,
    AvailabilityModule,
    EncountersModule,
    AdminModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
