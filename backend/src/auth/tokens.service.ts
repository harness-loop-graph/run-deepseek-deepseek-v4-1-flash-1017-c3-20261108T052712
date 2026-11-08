import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../database/database.tokens';
import { oauthConfig } from '../common/app-config';
import { unauthorized } from '../common/errors';
import { AuthUser, RoleName } from './auth-user';

/**
 * Token issuing and verification (RF-07, RF-08).
 *
 * Tokens are opaque random strings; only their HMAC-SHA256 hash is stored, so
 * a database dump cannot be replayed as a session. Expiry is explicit in the
 * row (`expira_en`) and revocation is a column (`revocado_en`), which makes
 * EP-04 immediate: the very next request carrying a revoked token is denied.
 */

export interface IssuedTokens {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_expires_in: number;
  scope: string;
}

export interface UserRecord {
  id: number;
  email: string;
  password_hash: string;
  activo: boolean;
  roles: string[];
  paciente_id: number | null;
  profesional_id: number | null;
}

interface SessionRow {
  id: number;
  usuario_id: number;
  sesion_id: string;
  tipo: 'access' | 'refresh';
  expira_en: Date;
  revocado_en: Date | null;
}

const USER_SELECT = `
  SELECT u.id,
         u.email,
         u.password_hash,
         u.activo,
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

export function hashToken(token: string): string {
  return createHmac('sha256', oauthConfig().tokenSecret).update(token).digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** PKCE S256: BASE64URL(SHA256(ASCII(code_verifier))). */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function toAuthUser(row: UserRecord): AuthUser {
  return {
    userId: row.id,
    email: row.email,
    roles: row.roles.filter((role): role is RoleName =>
      (['patient', 'professional', 'staff', 'admin'] as string[]).includes(role),
    ),
    patientId: row.paciente_id ?? undefined,
    professionalId: row.profesional_id ?? undefined,
  };
}

@Injectable()
export class TokensService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  /** Issues a fresh access/refresh pair in a new session. */
  async issueForUser(userId: number): Promise<IssuedTokens> {
    const config = oauthConfig();
    const sesionId = randomUUID();
    const accessToken = randomToken();
    const refreshToken = randomToken(48);
    const accessExpires = new Date(Date.now() + config.accessTtlSeconds * 1000);
    const refreshExpires = new Date(Date.now() + config.refreshTtlSeconds * 1000);

    await this.pool.query(
      `INSERT INTO token_sesion (usuario_id, sesion_id, tipo, token_hash, expira_en)
       VALUES ($1, $2, 'access', $3, $4), ($1, $2, 'refresh', $5, $6)`,
      [
        userId,
        sesionId,
        hashToken(accessToken),
        accessExpires,
        hashToken(refreshToken),
        refreshExpires,
      ],
    );

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'Bearer',
      expires_in: config.accessTtlSeconds,
      refresh_expires_in: config.refreshTtlSeconds,
      scope: 'appointments availability clinical',
    };
  }

  /** Resolves the caller of an access token, or throws 401. */
  async resolveAccessToken(token: string): Promise<AuthUser> {
    const session = await this.findSession(token, 'access');
    const user = await this.findUserById(session.usuario_id);
    if (user === undefined || !user.activo) {
      throw unauthorized('The access token is no longer valid.');
    }
    return toAuthUser(user);
  }

  /**
   * Rotates a refresh token: the previous session is revoked and a new pair is
   * issued, so a replayed refresh token is rejected (RF-08).
   */
  async refresh(refreshToken: string): Promise<IssuedTokens> {
    const session = await this.findSession(refreshToken, 'refresh');
    const user = await this.findUserById(session.usuario_id);
    if (user === undefined || !user.activo) {
      throw unauthorized('The refresh token is no longer valid.');
    }
    await this.revokeSession(session.sesion_id);
    return this.issueForUser(session.usuario_id);
  }

  /**
   * Revokes the session of the given token (access or refresh). Returns false
   * when the token is unknown or already unusable, which EP-04 maps to 401.
   */
  async revoke(token: string): Promise<boolean> {
    const result = await this.pool.query<{ sesion_id: string }>(
      `UPDATE token_sesion
          SET revocado_en = now()
        WHERE token_hash = $1
          AND revocado_en IS NULL
        RETURNING sesion_id`,
      [hashToken(token)],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return false;
    }
    await this.revokeSession(row.sesion_id);
    return true;
  }

  async revokeSession(sesionId: string): Promise<void> {
    await this.pool.query(
      `UPDATE token_sesion
          SET revocado_en = now()
        WHERE sesion_id = $1
          AND revocado_en IS NULL`,
      [sesionId],
    );
  }

  async findUserByEmail(email: string): Promise<UserRecord | undefined> {
    const result = await this.pool.query<UserRecord>(
      `${USER_SELECT} WHERE lower(u.email) = lower($1)`,
      [email],
    );
    return result.rows[0];
  }

  async findUserById(userId: number): Promise<UserRecord | undefined> {
    const result = await this.pool.query<UserRecord>(`${USER_SELECT} WHERE u.id = $1`, [userId]);
    return result.rows[0];
  }

  /** True when the access token is present, unexpired and not revoked. */
  async isUsableAccessToken(token: string): Promise<boolean> {
    try {
      await this.findSession(token, 'access');
      return true;
    } catch {
      return false;
    }
  }

  /** Owner of any unexpired, unrevoked token (access or refresh). */
  async userIdOfToken(token: string): Promise<number | undefined> {
    const result = await this.pool.query<{ usuario_id: number }>(
      `SELECT usuario_id
         FROM token_sesion
        WHERE token_hash = $1
          AND revocado_en IS NULL
          AND expira_en > now()`,
      [hashToken(token)],
    );
    return result.rows[0]?.usuario_id;
  }

  private async findSession(token: string, tipo: 'access' | 'refresh'): Promise<SessionRow> {
    const result = await this.pool.query<SessionRow>(
      `SELECT id, usuario_id, sesion_id, tipo, expira_en, revocado_en
         FROM token_sesion
        WHERE token_hash = $1 AND tipo = $2`,
      [hashToken(token), tipo],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw unauthorized('The token is invalid.');
    }
    if (row.revocado_en !== null) {
      throw unauthorized('The token has been revoked.');
    }
    if (row.expira_en.getTime() <= Date.now()) {
      throw unauthorized('The token has expired.');
    }
    return row;
  }
}
