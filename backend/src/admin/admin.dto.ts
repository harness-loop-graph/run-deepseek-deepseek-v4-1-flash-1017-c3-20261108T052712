import { Schema, arrayOf, integer, object, optional, query, required, string } from '../common/validation';

/**
 * Strict schemas of the administration endpoints (RF-12).
 *
 * `roles` is validated against the four declared role names; an unknown role
 * is a 422, never an ignored value (EP-16, EP-17).
 */

export interface IdParam {
  id: number;
}

export const idParamSchema: Schema<IdParam> = object<IdParam>({
  id: required(integer({ min: 1 })),
});

export interface AdminUsersQuery {
  page?: number;
}

export const adminUsersQuerySchema: Schema<AdminUsersQuery> = query<AdminUsersQuery>({
  page: optional(integer({ min: 1, max: 100_000 })),
});

export interface AuditQuery {
  /** User id or email of the actor (EP-19). */
  actor?: string;
  action?: string;
  from?: string;
  to?: string;
  page?: number;
}

export const auditQuerySchema: Schema<AuditQuery> = query<AuditQuery>({
  actor: optional(string({ maxLength: 254 })),
  action: optional(string({ maxLength: 128 })),
  from: optional(string({ format: 'date' })),
  to: optional(string({ format: 'date' })),
  page: optional(integer({ min: 1, max: 100_000 })),
});

export interface RoleListDto {
  roles: string[];
}

/** Kept for callers that send a bare array of roles. */
export const roleListSchema: Schema<RoleListDto> = object<RoleListDto>({
  roles: required(arrayOf(string({ maxLength: 32 }), { minLength: 1, maxLength: 4 })),
});
