import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../common/guards';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../common/guards';
import { resolveRange } from '../common/dates';
import { validationError } from '../common/errors';
import {
  AgendaQuery,
  AvailabilityQuery,
  agendaQuerySchema,
  availabilityQuerySchema,
} from './availability.dto';
import { AgendaDay, AvailabilityService, ProfessionalSummary, Slot } from './availability.service';
import { AuditService, AUDIT_ACTIONS } from '../audit/audit.service';

/**
 * Availability and agenda reads (EP-06, EP-09) plus the professional directory
 * the SPA needs to build the SCR-03 `<select>`.
 *
 * Scheduling data is non-clinical, so staff and admin may read it; clinical
 * content is never reachable from this controller (RF-10).
 */
@Controller()
export class AvailabilityController {
  constructor(
    private readonly availability: AvailabilityService,
    private readonly audit: AuditService,
  ) {}

  /** EP-06: free slots of one professional in a `YYYY-MM-DD` range. */
  @Roles('patient', 'professional', 'staff', 'admin')
  @Get('availability')
  async slots(
    @Query() rawQuery: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ): Promise<Slot[]> {
    const parsed: AvailabilityQuery = availabilityQuerySchema.parse(rawQuery, 'query');
    const { start, end } = resolveRange(parsed.from, parsed.to);

    const slots = await this.availability.freeSlots(parsed.professionalId, start, end);

    await this.audit.recordFor(user, {
      action: AUDIT_ACTIONS.availabilityRead,
      resourceType: 'disponibilidad',
      resourceId: parsed.professionalId,
      metadata: { from: parsed.from ?? null, to: parsed.to ?? null, count: slots.length },
    });

    return slots;
  }

  /** EP-09: the caller professional's agenda grouped by day (today..+7 default). */
  @Roles('professional', 'staff')
  @Get('agenda')
  async agenda(
    @Query() rawQuery: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ): Promise<AgendaDay[]> {
    const parsed: AgendaQuery = agendaQuerySchema.parse(rawQuery, 'query');
    const professionalId = await this.resolveProfessionalId(user, parsed.professionalId);
    const { start, end } = resolveRange(parsed.from, parsed.to);

    const days = await this.availability.agenda(professionalId, start, end);

    await this.audit.recordFor(user, {
      action: AUDIT_ACTIONS.agendaRead,
      resourceType: 'profesional',
      resourceId: professionalId,
      metadata: { from: parsed.from ?? null, to: parsed.to ?? null, days: days.length },
    });

    return days;
  }

  /** Directory used by SCR-03; no clinical content, no personal data beyond the name. */
  @Roles('patient', 'professional', 'staff', 'admin')
  @Get('professionals')
  professionals(): Promise<ProfessionalSummary[]> {
    return this.availability.listProfessionals();
  }

  /**
   * A professional always reads their own agenda; staff may read any
   * professional's agenda, which requires the `professionalId` query.
   */
  private async resolveProfessionalId(user: AuthUser, requested?: number): Promise<number> {
    if (user.professionalId !== undefined) {
      return user.professionalId;
    }
    if (requested === undefined) {
      throw validationError('query.professionalId: is required for this caller');
    }
    return requested;
  }
}
