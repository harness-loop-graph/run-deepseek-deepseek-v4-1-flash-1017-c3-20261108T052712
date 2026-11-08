import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { BookingRateLimitGuard, CurrentUser, Roles } from '../common/guards';
import { AuthUser } from '../auth/auth-user';
import { bookAppointmentSchema, encounterSchema, idParamSchema } from './appointment.dto';
import { AppointmentDetail, AppointmentsService, EncounterRecord } from './appointments.service';

/**
 * EP-05, EP-07, EP-08, EP-10, EP-11.
 *
 * Role checks are declared here; the per-resource ownership/assignment checks
 * run inside the service queries (RF-10), so a wrong id never widens a scope.
 * `POST` answers 201 (Nest's default) and `DELETE` answers 204.
 */
@Controller()
export class AppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  /** EP-05: the caller patient's own appointments. */
  @Roles('patient')
  @Get('me/appointments')
  listOwn(@CurrentUser() user: AuthUser) {
    return this.appointments.listOwnAppointments(user);
  }

  /** EP-07: transactional booking (RF-13), 10 req/min per user (RF-14). */
  @Roles('patient')
  @UseGuards(BookingRateLimitGuard)
  @Post('appointments')
  book(@Body() rawBody: unknown, @CurrentUser() user: AuthUser): Promise<{ id: number }> {
    const body = bookAppointmentSchema.parse(rawBody, 'body');
    return this.appointments.book(user, body.professionalId, body.slotStart);
  }

  /** EP-08: a patient cancels one of their own appointments (204). */
  @Roles('patient')
  @Delete('appointments/:id')
  @HttpCode(204)
  async cancel(
    @Param() rawParams: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    const params = idParamSchema.parse(rawParams, 'params');
    await this.appointments.cancel(user, params.id);
  }

  /** EP-10: appointment detail (patient own / assigned professional). */
  @Roles('patient', 'professional')
  @Get('appointments/:id')
  detail(
    @Param() rawParams: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ): Promise<AppointmentDetail> {
    const params = idParamSchema.parse(rawParams, 'params');
    return this.appointments.detail(user, params.id);
  }

  /** EP-11: the assigned professional records an encounter (201). */
  @Roles('professional')
  @Post('appointments/:id/encounter')
  recordEncounter(
    @Param() rawParams: Record<string, unknown>,
    @Body() rawBody: unknown,
    @CurrentUser() user: AuthUser,
  ): Promise<EncounterRecord> {
    const params = idParamSchema.parse(rawParams, 'params');
    const body = encounterSchema.parse(rawBody, 'body');
    return this.appointments.recordEncounter(user, params.id, body.notes, body.diagnosis);
  }
}
