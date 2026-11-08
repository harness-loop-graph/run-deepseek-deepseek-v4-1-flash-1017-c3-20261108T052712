import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../database/database.tokens';
import { AuthUser } from '../auth/auth-user';

/**
 * Audit log writer and reader (RF-15, RF-06).
 *
 * `auditoria` is append-only (trigger `fn_append_only`): this service only
 * inserts. Metadata is deliberately non-clinical: no notes, no diagnosis, no
 * file bytes, no tokens.
 */

export interface AuditEntry {
  actorId: number;
  action: string;
  resourceType: string;
  resourceId?: number | null;
  metadata?: Record<string, unknown>;
}

export interface AuditFilters {
  actor?: number;
  action?: string;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}

export interface AuditRecord {
  id: number;
  actor: { id: number; email: string };
  action: string;
  resourceType: string;
  resourceId: number | null;
  occurredAt: string;
  metadata: Record<string, unknown>;
}

export interface PaginatedAudit {
  items: AuditRecord[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface AuditRow {
  id: number;
  usuario_id: number;
  email: string;
  accion: string;
  recurso_tipo: string;
  recurso_id: number | null;
  ocurrido_en: Date;
  metadatos: Record<string, unknown>;
}

export const AUDIT_ACTIONS = {
  loginSucceeded: 'auth.login',
  loginFailed: 'auth.login_failed',
  tokenRefreshed: 'auth.token_refresh',
  tokenRevoked: 'auth.token_revoke',
  appointmentsRead: 'appointment.list',
  appointmentRead: 'appointment.read',
  appointmentCreated: 'appointment.create',
  appointmentCancelled: 'appointment.cancel',
  availabilityRead: 'availability.read',
  availabilityReplaced: 'availability.replace',
  agendaRead: 'agenda.read',
  encounterCreated: 'encounter.create',
  encounterRead: 'encounter.read',
  clinicalHistoryRead: 'clinical_history.read',
  attachmentCreated: 'attachment.create',
  attachmentRead: 'attachment.read',
  usersRead: 'user.list',
  userCreated: 'user.create',
  userRolesUpdated: 'user.roles_update',
  auditRead: 'audit.read',
} as const;

@Injectable()
export class AuditService {
  private readonly logger = new Logger('AuditService');

  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  /**
   * Writes one audit row. A failure is logged but never turns a successful
   * operation into a 500: the audit trail must not make the API unavailable.
   */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO auditoria (usuario_id, accion, recurso_tipo, recurso_id, metadatos)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [
          entry.actorId,
          entry.action,
          entry.resourceType,
          entry.resourceId ?? null,
          JSON.stringify(entry.metadata ?? {}),
        ],
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown error';
      this.logger.error(`audit write failed for ${entry.action}: ${detail}`);
    }
  }

  async recordFor(user: AuthUser, entry: Omit<AuditEntry, 'actorId'>): Promise<void> {
    await this.record({ ...entry, actorId: user.userId });
  }

  async list(filters: AuditFilters): Promise<PaginatedAudit> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filters.actor !== undefined) {
      values.push(filters.actor);
      conditions.push(`a.usuario_id = $${values.length}`);
    }
    if (filters.action !== undefined) {
      values.push(filters.action);
      conditions.push(`a.accion = $${values.length}`);
    }
    if (filters.from !== undefined) {
      values.push(filters.from.toISOString());
      conditions.push(`a.ocurrido_en >= $${values.length}::timestamptz`);
    }
    if (filters.to !== undefined) {
      values.push(filters.to.toISOString());
      conditions.push(`a.ocurrido_en <= $${values.length}::timestamptz`);
    }

    const where = conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`;

    const countResult = await this.pool.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM auditoria a ${where}`,
      values,
    );
    const total = Number.parseInt(countResult.rows[0]?.total ?? '0', 10);

    values.push(filters.pageSize);
    const limitIndex = values.length;
    values.push((filters.page - 1) * filters.pageSize);
    const offsetIndex = values.length;

    const rows = await this.pool.query<AuditRow>(
      `SELECT a.id, a.usuario_id, u.email, a.accion, a.recurso_tipo, a.recurso_id,
              a.ocurrido_en, a.metadatos
         FROM auditoria a
         JOIN usuario u ON u.id = a.usuario_id
         ${where}
        ORDER BY a.ocurrido_en DESC, a.id DESC
        LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
      values,
    );

    return {
      items: rows.rows.map((row) => ({
        id: row.id,
        actor: { id: row.usuario_id, email: row.email },
        action: row.accion,
        resourceType: row.recurso_tipo,
        resourceId: row.recurso_id,
        occurredAt: row.ocurrido_en.toISOString(),
        metadata: row.metadatos,
      })),
      page: filters.page,
      pageSize: filters.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / filters.pageSize)),
    };
  }
}
