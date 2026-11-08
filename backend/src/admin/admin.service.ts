import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../database/database.tokens';
import { pageSize, seedPassword } from '../common/app-config';
import { conflict, notFound, validationError } from '../common/errors';
import { hashPassword } from '../database/seed/password';
import { AuthUser, RoleName } from '../auth/auth-user';
import { AuditService, AUDIT_ACTIONS, PaginatedAudit } from '../audit/audit.service';
import { AvailabilityService, Slot } from '../availability/availability.service';

/**
 * Administration: users, roles, availability and the audit query
 * (EP-15 .. EP-19). Every route is guarded by the `admin` role, and every
 * write records an audit row (RF-15).
 */

export interface AdminUser {
  id: number;
  email: string;
  active: boolean;
  roles: RoleName[];
  patientId: number | null;
  professionalId: number | null;
  createdAt: string;
}

export interface PaginatedUsers {
  items: AdminUser[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface UserRow {
  id: number;
  email: string;
  activo: boolean;
  creado_en: Date;
  roles: string[];
  paciente_id: number | null;
  profesional_id: number | null;
}

const USER_SELECT = `
  SELECT u.id,
         u.email,
         u.activo,
         u.creado_en,
         COALESCE(
           (SELECT array_agg(r.nombre ORDER BY r.nombre)
              FROM usuario_rol ur JOIN rol r ON r.id = ur.rol_id
             WHERE ur.usuario_id = u.id),
           ARRAY[]::text[]
         ) AS roles,
         (SELECT p.id FROM paciente p WHERE p.usuario_id = u.id) AS paciente_id,
         (SELECT pr.id FROM profesional pr WHERE pr.usuario_id = u.id) AS profesional_id
    FROM usuario u
`;

const ROLE_NAMES: readonly RoleName[] = ['patient', 'professional', 'staff', 'admin'];

function toAdminUser(row: UserRow): AdminUser {
  return {
    id: row.id,
    email: row.email,
    active: row.activo,
    roles: row.roles.filter((role): role is RoleName =>
      (ROLE_NAMES as readonly string[]).includes(role),
    ),
    patientId: row.paciente_id,
    professionalId: row.profesional_id,
    createdAt: row.creado_en.toISOString(),
  };
}

@Injectable()
export class AdminService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly audit: AuditService,
    private readonly availability: AvailabilityService,
  ) {}

  /** EP-15: paginated user list. */
  async listUsers(user: AuthUser, page: number): Promise<PaginatedUsers> {
    const size = pageSize();
    const countResult = await this.pool.query<{ total: string }>(
      'SELECT count(*)::text AS total FROM usuario',
    );
    const total = Number.parseInt(countResult.rows[0]?.total ?? '0', 10);

    const rows = await this.pool.query<UserRow>(
      `${USER_SELECT}
        ORDER BY u.id ASC
        LIMIT $1 OFFSET $2`,
      [size, (page - 1) * size],
    );

    await this.audit.recordFor(user, {
      action: AUDIT_ACTIONS.usersRead,
      resourceType: 'usuario',
      resourceId: null,
      metadata: { page, pageSize: size },
    });

    return {
      items: rows.rows.map(toAdminUser),
      page,
      pageSize: size,
      total,
      totalPages: Math.max(1, Math.ceil(total / size)),
    };
  }

  /** EP-16: creates a user with the given roles (409 when the email exists). */
  async createUser(user: AuthUser, email: string, roles: RoleName[]): Promise<AdminUser> {
    const passwordHash = await hashPassword(seedPassword());
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      const existing = await client.query<{ id: number }>(
        'SELECT id FROM usuario WHERE lower(email) = lower($1)',
        [email],
      );
      if (existing.rowCount !== 0) {
        throw conflict('A user with that email already exists.');
      }

      const inserted = await client.query<{ id: number }>(
        'INSERT INTO usuario (email, password_hash) VALUES ($1, $2) RETURNING id',
        [email, passwordHash],
      );
      const userId = inserted.rows[0].id;

      await client.query(
        `INSERT INTO usuario_rol (usuario_id, rol_id)
         SELECT $1, id FROM rol WHERE nombre = ANY($2::text[])`,
        [userId, roles],
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    const created = await this.pool.query<UserRow>(
      `${USER_SELECT} WHERE lower(u.email) = lower($1)`,
      [email],
    );
    const row = created.rows[0];
    if (row === undefined) {
      throw notFound('User not found.');
    }

    await this.audit.recordFor(user, {
      action: AUDIT_ACTIONS.userCreated,
      resourceType: 'usuario',
      resourceId: row.id,
      metadata: { roles },
    });

    return toAdminUser(row);
  }

  /** EP-17: replaces the role set of a user (422 on an unknown role). */
  async updateRoles(user: AuthUser, userId: number, roles: RoleName[]): Promise<AdminUser> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const existing = await client.query<{ id: number }>('SELECT id FROM usuario WHERE id = $1', [
        userId,
      ]);
      if (existing.rowCount === 0) {
        throw notFound('User not found.');
      }

      const known = await client.query<{ nombre: string }>(
        'SELECT nombre FROM rol WHERE nombre = ANY($1::text[])',
        [roles],
      );
      const knownNames = known.rows.map((row) => row.nombre);
      const unknown = roles.filter((role) => !knownNames.includes(role));
      if (unknown.length > 0) {
        throw validationError(`body.roles: unknown role ${unknown.join(', ')}`);
      }

      await client.query('DELETE FROM usuario_rol WHERE usuario_id = $1', [userId]);
      await client.query(
        `INSERT INTO usuario_rol (usuario_id, rol_id)
         SELECT $1, id FROM rol WHERE nombre = ANY($2::text[])`,
        [userId, roles],
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    const updated = await this.pool.query<UserRow>(`${USER_SELECT} WHERE u.id = $1`, [userId]);
    const row = updated.rows[0];
    if (row === undefined) {
      throw notFound('User not found.');
    }

    await this.audit.recordFor(user, {
      action: AUDIT_ACTIONS.userRolesUpdated,
      resourceType: 'usuario',
      resourceId: userId,
      metadata: { roles },
    });

    return toAdminUser(row);
  }

  /** EP-18: replaces the whole availability set of a professional. */
  async replaceAvailability(
    user: AuthUser,
    professionalId: number,
    slots: Slot[],
  ): Promise<Slot[]> {
    const stored = await this.availability.replaceAvailability(professionalId, slots);

    await this.audit.recordFor(user, {
      action: AUDIT_ACTIONS.availabilityReplaced,
      resourceType: 'disponibilidad',
      resourceId: professionalId,
      metadata: { slots: slots.length },
    });

    return stored;
  }

  /** EP-19: paginated audit query with actor/action/date filters. */
  async listAudit(
    user: AuthUser,
    filters: { actor?: string; action?: string; from?: Date; to?: Date; page: number },
  ): Promise<PaginatedAudit> {
    let actorId: number | undefined;
    if (filters.actor !== undefined && filters.actor.trim() !== '') {
      actorId = await this.resolveActor(filters.actor.trim());
    }

    const result = await this.audit.list({
      actor: actorId,
      action: filters.action,
      from: filters.from,
      to: filters.to,
      page: filters.page,
      pageSize: pageSize(),
    });

    await this.audit.recordFor(user, {
      action: AUDIT_ACTIONS.auditRead,
      resourceType: 'auditoria',
      resourceId: null,
      metadata: { page: filters.page },
    });

    return result;
  }

  /** The `actor` filter accepts either a numeric user id or an email. */
  private async resolveActor(actor: string): Promise<number | undefined> {
    if (/^\d+$/.test(actor)) {
      return Number.parseInt(actor, 10);
    }
    const found = await this.pool.query<{ id: number }>(
      'SELECT id FROM usuario WHERE lower(email) = lower($1)',
      [actor],
    );
    // An unknown actor yields no rows instead of leaking whether it exists.
    return found.rows[0]?.id ?? -1;
  }
}
