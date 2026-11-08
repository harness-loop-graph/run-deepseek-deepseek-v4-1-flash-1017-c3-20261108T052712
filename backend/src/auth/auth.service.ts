import { timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../database/database.tokens';
import { oauthConfig } from '../common/app-config';
import { invalidGrant, invalidRequest, unauthorized } from '../common/errors';
import { verifyPassword } from '../database/seed/password';
import { AuditService, AUDIT_ACTIONS } from '../audit/audit.service';
import { IssuedTokens, TokensService, hashToken, pkceChallenge, randomToken } from './tokens.service';
import { LoginFormFields } from './login-form';

/**
 * OAuth 2.0 authorization-code flow with PKCE S256 (RF-07).
 *
 * Only one public client is registered (`OAUTH_CLIENT_ID` /
 * `OAUTH_REDIRECT_URI`), there is no client secret and no other flow. An
 * authorization code is single-use, short-lived and bound to the PKCE
 * challenge, the client and the redirect URI.
 */

export interface AuthorizeRequest {
  response_type: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  state: string;
}

export interface TokenRequest {
  code: string;
  code_verifier: string;
  client_id: string;
  redirect_uri: string;
}

interface CodeRow {
  id: number;
  codigo_hash: string;
  usuario_id: number;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  expira_en: Date;
  usado_en: Date | null;
}

/** A PKCE verifier is 43..128 characters of the unreserved set (RFC 7636). */
const PKCE_VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
/** A PKCE S256 challenge is BASE64URL(SHA256(verifier)): 43 characters. */
const PKCE_CHALLENGE = /^[A-Za-z0-9\-_]{43}$/;

@Injectable()
export class AuthService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly tokens: TokensService,
    private readonly audit: AuditService,
  ) {}

  /** Validates the authorization request against the registered client. */
  validateAuthorizeRequest(request: AuthorizeRequest): void {
    const config = oauthConfig();
    if (request.response_type !== 'code') {
      throw invalidRequest('response_type must be "code".');
    }
    if (request.client_id !== config.clientId) {
      throw invalidRequest('Unknown client_id.');
    }
    if (request.redirect_uri !== config.redirectUri) {
      throw invalidRequest('Unregistered redirect_uri.');
    }
    if (request.code_challenge_method !== 'S256') {
      throw invalidRequest('code_challenge_method must be "S256".');
    }
    if (!PKCE_CHALLENGE.test(request.code_challenge)) {
      throw invalidRequest('code_challenge must be a BASE64URL SHA-256 digest.');
    }
    if (request.state.trim() === '' || request.state.length > 512) {
      throw invalidRequest('state is required.');
    }
  }

  /**
   * Authenticates the login form and issues a single-use authorization code.
   * Returns the redirect location (the registered redirect URI + code/state).
   */
  async completeLogin(form: LoginFormFields, email: string, password: string): Promise<string> {
    this.validateAuthorizeRequest(form);

    const user = await this.tokens.findUserByEmail(email);
    const passwordOk =
      user === undefined ? false : await verifyPassword(password, user.password_hash);

    if (user === undefined || !passwordOk || !user.activo) {
      await this.audit.record({
        actorId: user?.id ?? 0,
        action: AUDIT_ACTIONS.loginFailed,
        resourceType: 'usuario',
        resourceId: user?.id ?? null,
        metadata: { email: email.slice(0, 254) },
      });
      throw unauthorized('Invalid email or password.');
    }

    const code = randomToken(32);
    const expiresAt = new Date(Date.now() + oauthConfig().codeTtlSeconds * 1000);
    await this.pool.query(
      `INSERT INTO codigo_autorizacion
         (codigo_hash, usuario_id, client_id, redirect_uri, code_challenge, code_challenge_method, expira_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        hashToken(code),
        user.id,
        form.client_id,
        form.redirect_uri,
        form.code_challenge,
        form.code_challenge_method,
        expiresAt,
      ],
    );

    await this.audit.record({
      actorId: user.id,
      action: AUDIT_ACTIONS.loginSucceeded,
      resourceType: 'usuario',
      resourceId: user.id,
    });

    const location = new URL(form.redirect_uri);
    location.searchParams.set('code', code);
    location.searchParams.set('state', form.state);
    return location.toString();
  }

  /**
   * EP-02: exchanges a code for a token pair. A wrong verifier is a 400; an
   * unknown, reused or expired code is a 401.
   */
  async exchangeCode(request: TokenRequest): Promise<IssuedTokens> {
    const config = oauthConfig();
    if (request.client_id !== config.clientId) {
      throw invalidGrant('Unknown client.');
    }
    if (request.redirect_uri !== config.redirectUri) {
      throw invalidGrant('redirect_uri does not match the authorization request.');
    }
    if (!PKCE_VERIFIER.test(request.code_verifier)) {
      throw invalidRequest('code_verifier must be 43..128 unreserved characters.');
    }

    const found = await this.pool.query<CodeRow>(
      `SELECT id, codigo_hash, usuario_id, client_id, redirect_uri, code_challenge,
              code_challenge_method, expira_en, usado_en
         FROM codigo_autorizacion
        WHERE codigo_hash = $1`,
      [hashToken(request.code)],
    );
    const code = found.rows[0];
    if (code === undefined || code.usado_en !== null || code.expira_en.getTime() <= Date.now()) {
      throw invalidGrant('The authorization code is invalid or expired.');
    }
    if (code.client_id !== request.client_id || code.redirect_uri !== request.redirect_uri) {
      throw invalidGrant('The authorization code does not belong to this client.');
    }

    const expected = Buffer.from(code.code_challenge, 'utf8');
    const actual = Buffer.from(pkceChallenge(request.code_verifier), 'utf8');
    const verifierMatches =
      expected.length === actual.length && timingSafeEqual(expected, actual);
    if (!verifierMatches) {
      throw invalidRequest('PKCE verification failed.');
    }

    // Single use: the update is conditional so two concurrent exchanges of the
    // same code cannot both obtain tokens.
    const consumed = await this.pool.query(
      `UPDATE codigo_autorizacion
          SET usado_en = now()
        WHERE id = $1 AND usado_en IS NULL
        RETURNING id`,
      [code.id],
    );
    if ((consumed.rowCount ?? 0) !== 1) {
      throw invalidGrant('The authorization code has already been used.');
    }

    return this.tokens.issueForUser(code.usuario_id);
  }

  async refresh(refreshToken: string): Promise<IssuedTokens> {
    const issued = await this.tokens.refresh(refreshToken);
    return issued;
  }

  /** EP-04: revocation is immediate; an unknown or dead token is a 401. */
  async revoke(token: string, actorId: number): Promise<void> {
    const revoked = await this.tokens.revoke(token);
    if (!revoked) {
      throw unauthorized('The token is invalid or already revoked.');
    }
    await this.audit.record({
      actorId,
      action: AUDIT_ACTIONS.tokenRevoked,
      resourceType: 'token',
      resourceId: null,
    });
  }

  /** Resolves the owner of a token, used by EP-04 when only a token is given. */
  async actorOfToken(token: string): Promise<number> {
    const userId = await this.tokens.userIdOfToken(token);
    if (userId === undefined) {
      throw unauthorized('The token is invalid or already revoked.');
    }
    return userId;
  }
}
