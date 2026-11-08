import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../common/guards';
import { AuthUser } from '../auth/auth-user';
import { endOfUtcDay, parseDateOnly } from '../common/dates';
import { AdminService, AdminUser, PaginatedUsers } from './admin.service';
import { AdminUsersQuery, AuditQuery, adminUsersQuerySchema, auditQuerySchema, idParamSchema } from './admin.dto';
import { CreateUserDto, UpdateRolesDto, createUserSchema, updateRolesSchema } from '../auth/auth.dto';
import {
  AvailabilityReplacementDto,
  availabilityReplacementSchema,
} from '../availability/availability.dto';
import { Slot } from '../availability/availability.service';
import { PaginatedAudit } from '../audit/audit.service';

/**
 * Administration endpoints (EP-15 .. EP-19).
 *
 * The controller is guarded by the `admin` role; every request body and query
 * is parsed through a strict schema, so an undeclared field is a 422 (RF-12).
 * Each service call records an audit row (RF-15).
 */
@Roles('admin')
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  /** EP-15: paginated user list. */
  @Get('users')
  listUsers(
    @Query() rawQuery: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ): Promise<PaginatedUsers> {
    const parsed: AdminUsersQuery = adminUsersQuerySchema.parse(rawQuery, 'query');
    return this.admin.listUsers(user, parsed.page ?? 1);
  }

  /** EP-16: creates a user with the given roles (409 when the email exists). */
  @Post('users')
  createUser(@Body() rawBody: unknown, @CurrentUser() user: AuthUser): Promise<AdminUser> {
    const body: CreateUserDto = createUserSchema.parse(rawBody, 'body');
    return this.admin.createUser(user, body.email, body.roles);
  }

  /** EP-17: replaces the role set of a user (422 on an unknown role). */
  @Patch('users/:id/roles')
  updateRoles(
    @Param() rawParams: Record<string, unknown>,
    @Body() rawBody: unknown,
    @CurrentUser() user: AuthUser,
  ): Promise<AdminUser> {
    const params = idParamSchema.parse(rawParams, 'params');
    const body: UpdateRolesDto = updateRolesSchema.parse(rawBody, 'body');
    return this.admin.updateRoles(user, params.id, body.roles);
  }

  /** EP-18: replaces the whole availability set of a professional (422 overlap). */
  @Put('professionals/:id/availability')
  replaceAvailability(
    @Param() rawParams: Record<string, unknown>,
    @Body() rawBody: unknown,
    @CurrentUser() user: AuthUser,
  ): Promise<Slot[]> {
    const params = idParamSchema.parse(rawParams, 'params');
    const body: AvailabilityReplacementDto = availabilityReplacementSchema.parse(rawBody, 'body');
    return this.admin.replaceAvailability(user, params.id, body.slots);
  }

  /** EP-19: paginated audit query filtered by actor, action and date range. */
  @Get('audit')
  listAudit(
    @Query() rawQuery: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ): Promise<PaginatedAudit> {
    const parsed: AuditQuery = auditQuerySchema.parse(rawQuery, 'query');
    return this.admin.listAudit(user, {
      actor: parsed.actor,
      action: parsed.action,
      from: parsed.from === undefined ? undefined : parseDateOnly(parsed.from),
      to: parsed.to === undefined ? undefined : endOfUtcDay(parseDateOnly(parsed.to)),
      page: parsed.page ?? 1,
    });
  }
}
