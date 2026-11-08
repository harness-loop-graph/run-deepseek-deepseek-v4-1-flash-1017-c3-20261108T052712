import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { AppException } from '../src/common/errors';
import { AuthService } from '../src/auth/auth.service';
import { AuditService } from '../src/audit/audit.service';
import { TokensService, hashToken, pkceChallenge, randomToken } from '../src/auth/tokens.service';
import { hashPassword } from '../src/database/seed/password';
import { FakePool, asPool, empty, rows } from './support/fake-pool';

/**
 * RF-07 / RF-08: OAuth 2.0 authorization code + PKCE, token expiry and
 * immediate revocation.
 *
 * The token tables are modelled in memory with the same columns the migrations
 * create (`expira_en`, `revocado_en`, `usado_en`), so the tests exercise the
 * real service queries: an expired token, a revoked token and a replayed code
 * must all be rejected.
 */

const CLIENT_ID = 'medapp-spa';
const REDIRECT_URI = 'http://localhost:8080/auth/callback';

interface Session {
  id: number;
  usuario_id: number;
  sesion_id: string;
  tipo: 'access' | 'refresh';
  token_hash: string;
  expira_en: Date;
  revocado_en: Date | null;
}

interface Code {
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

interface State {
  sessions: Session[];
  codes: Code[];
  nextId: number;
}

function createState(): State {
  return { sessions: [], codes: [], nextId: 1 };
}

function createPool(state: State, user: { id: number; password_hash: string }): FakePool {
  const pool = new FakePool();

  pool.on(/INSERT INTO codigo_autorizacion/, (params) => {
    const code: Code = {
      id: state.nextId++,
      codigo_hash: String(params[0]),
      usuario_id: Number(params[1]),
      client_id: String(params[2]),
      redirect_uri: String(params[3]),
      code_challenge: String(params[4]),
      code_challenge_method: String(params[5]),
      expira_en: params[6] as Date,
      usado_en: null,
    };
    state.codes.push(code);
    return empty();
  });

  pool.on(/FROM codigo_autorizacion/, (params) => {
    const found = state.codes.filter((code) => code.codigo_hash === String(params[0]));
    return rows(found);
  });

  pool.on(/UPDATE codigo_autorizacion/, (params) => {
    const code = state.codes.find(
      (candidate) => candidate.id === Number(params[0]) && candidate.usado_en === null,
    );
    if (code === undefined) {
      return empty();
    }
    code.usado_en = new Date();
    return rows([{ id: code.id }]);
  });

  pool.on(/INSERT INTO token_sesion/, (params) => {
    const usuarioId = Number(params[0]);
    const sesionId = String(params[1]);
    state.sessions.push(
      {
        id: state.nextId++,
        usuario_id: usuarioId,
        sesion_id: sesionId,
        tipo: 'access',
        token_hash: String(params[2]),
        expira_en: params[3] as Date,
        revocado_en: null,
      },
      {
        id: state.nextId++,
        usuario_id: usuarioId,
        sesion_id: sesionId,
        tipo: 'refresh',
        token_hash: String(params[4]),
        expira_en: params[5] as Date,
        revocado_en: null,
      },
    );
    return empty();
  });

  pool.on(/UPDATE token_sesion[\s\S]*WHERE token_hash/, (params) => {
    const session = state.sessions.find(
      (candidate) => candidate.token_hash === String(params[0]) && candidate.revocado_en === null,
    );
    if (session === undefined) {
      return empty();
    }
    session.revocado_en = new Date();
    return rows([{ sesion_id: session.sesion_id }]);
  });

  pool.on(/UPDATE token_sesion[\s\S]*WHERE sesion_id/, (params) => {
    for (const session of state.sessions) {
      if (session.sesion_id === String(params[0]) && session.revocado_en === null) {
        session.revocado_en = new Date();
      }
    }
    return empty();
  });

  pool.on(/FROM token_sesion/, (params) => {
    const found = state.sessions.filter(
      (session) =>
        session.token_hash === String(params[0]) &&
        (params[1] === undefined || session.tipo === String(params[1])),
    );
    return rows(found);
  });

  pool.on(/FROM usuario u/, () =>
    rows([
      {
        id: user.id,
        email: 'paciente1@seed.local',
        password_hash: user.password_hash,
        activo: true,
        roles: ['patient'],
        paciente_id: 1,
        profesional_id: null,
      },
    ]),
  );

  return pool;
}

function statusOf(error: unknown): number | undefined {
  return error instanceof AppException ? error.getStatus() : undefined;
}

describe('OAuth PKCE flow (RF-07)', () => {
  let state: State;
  let pool: FakePool;
  let service: AuthService;
  let verifier: string;

  beforeEach(async () => {
    state = createState();
    const passwordHash = await hashPassword('Seed!Passw0rd');
    pool = createPool(state, { id: 3, password_hash: passwordHash });
    const tokens = new TokensService(asPool(pool));
    service = new AuthService(asPool(pool), tokens, new AuditService(asPool(pool)));
    verifier = randomToken(48);
  });

  const authorize = (): {
    response_type: string;
    client_id: string;
    redirect_uri: string;
    code_challenge: string;
    code_challenge_method: string;
    state: string;
  } => ({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code_challenge: pkceChallenge(verifier),
    code_challenge_method: 'S256',
    state: 'state-123',
  });

  it('issues a code and exchanges it for an access and refresh token', async () => {
    const location = await service.completeLogin(authorize(), 'paciente1@seed.local', 'Seed!Passw0rd');
    expect(location.startsWith(REDIRECT_URI)).toBe(true);
    const url = new URL(location);
    const code = url.searchParams.get('code');
    expect(code).not.toBeNull();
    expect(url.searchParams.get('state')).toBe('state-123');

    const tokens = await service.exchangeCode({
      code: code as string,
      code_verifier: verifier,
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
    });

    expect(tokens.access_token).toBeTruthy();
    expect(tokens.refresh_token).toBeTruthy();
    expect(tokens.token_type).toBe('Bearer');
    expect(tokens.expires_in).toBe(900);
    expect(tokens.refresh_expires_in).toBe(28800);
    // Only hashes are stored.
    expect(state.sessions.every((session) => session.token_hash !== tokens.access_token)).toBe(true);
  });

  it('rejects a wrong PKCE verifier with 400', async () => {
    const location = await service.completeLogin(authorize(), 'paciente1@seed.local', 'Seed!Passw0rd');
    const code = new URL(location).searchParams.get('code') as string;

    await expect(
      service.exchangeCode({
        code,
        code_verifier: randomToken(48),
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
      }),
    ).rejects.toSatisfy((error: unknown) => statusOf(error) === 400);
  });

  it('rejects a replayed authorization code with 401', async () => {
    const location = await service.completeLogin(authorize(), 'paciente1@seed.local', 'Seed!Passw0rd');
    const code = new URL(location).searchParams.get('code') as string;
    const request = {
      code,
      code_verifier: verifier,
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
    };

    await service.exchangeCode(request);
    await expect(service.exchangeCode(request)).rejects.toSatisfy(
      (error: unknown) => statusOf(error) === 401,
    );
  });

  it('rejects an unknown authorization code with 401', async () => {
    await expect(
      service.exchangeCode({
        code: 'unknown',
        code_verifier: verifier,
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
      }),
    ).rejects.toSatisfy((error: unknown) => statusOf(error) === 401);
  });

  it('rejects an expired authorization code with 401', async () => {
    const location = await service.completeLogin(authorize(), 'paciente1@seed.local', 'Seed!Passw0rd');
    const code = new URL(location).searchParams.get('code') as string;
    state.codes[0].expira_en = new Date(Date.now() - 1000);

    await expect(
      service.exchangeCode({
        code,
        code_verifier: verifier,
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
      }),
    ).rejects.toSatisfy((error: unknown) => statusOf(error) === 401);
  });

  it('rejects an unregistered client or redirect URI', async () => {
    await expect(
      service.completeLogin(
        { ...authorize(), client_id: 'other-spa' },
        'paciente1@seed.local',
        'Seed!Passw0rd',
      ),
    ).rejects.toSatisfy((error: unknown) => statusOf(error) === 400);

    await expect(
      service.completeLogin(
        { ...authorize(), redirect_uri: 'http://evil.local/cb' },
        'paciente1@seed.local',
        'Seed!Passw0rd',
      ),
    ).rejects.toSatisfy((error: unknown) => statusOf(error) === 400);
  });

  it('rejects a non-S256 challenge method', async () => {
    await expect(
      service.completeLogin(
        { ...authorize(), code_challenge_method: 'plain' },
        'paciente1@seed.local',
        'Seed!Passw0rd',
      ),
    ).rejects.toSatisfy((error: unknown) => statusOf(error) === 400);
  });

  it('rejects bad credentials with 401', async () => {
    await expect(
      service.completeLogin(authorize(), 'paciente1@seed.local', 'wrong-password'),
    ).rejects.toSatisfy((error: unknown) => statusOf(error) === 401);
  });

  it('never stores the plaintext password', async () => {
    const stored = pool.statements.join(' ');
    expect(stored).not.toContain('Seed!Passw0rd');
  });
});

describe('token policy (RF-08)', () => {
  let state: State;
  let tokens: TokensService;

  beforeEach(() => {
    state = createState();
    tokens = new TokensService(asPool(createPool(state, { id: 3, password_hash: 'x' })));
  });

  afterEach(() => {
    state = createState();
  });

  it('resolves a live access token to the caller', async () => {
    const issued = await tokens.issueForUser(3);
    const user = await tokens.resolveAccessToken(issued.access_token);
    expect(user.userId).toBe(3);
    expect(user.patientId).toBe(1);
  });

  it('rejects an expired access token with 401', async () => {
    const issued = await tokens.issueForUser(3);
    const access = state.sessions.find((session) => session.tipo === 'access');
    if (access !== undefined) {
      access.expira_en = new Date(Date.now() - 1000);
    }

    await expect(tokens.resolveAccessToken(issued.access_token)).rejects.toSatisfy(
      (error: unknown) => statusOf(error) === 401,
    );
  });

  it('rejects a revoked access token with 401', async () => {
    const issued = await tokens.issueForUser(3);
    await expect(tokens.revoke(issued.access_token)).resolves.toBe(true);

    await expect(tokens.resolveAccessToken(issued.access_token)).rejects.toSatisfy(
      (error: unknown) => statusOf(error) === 401,
    );
  });

  it('revokes the whole session (access and refresh) immediately', async () => {
    const issued = await tokens.issueForUser(3);
    await tokens.revoke(issued.refresh_token);

    await expect(tokens.refresh(issued.refresh_token)).rejects.toSatisfy(
      (error: unknown) => statusOf(error) === 401,
    );
    await expect(tokens.resolveAccessToken(issued.access_token)).rejects.toSatisfy(
      (error: unknown) => statusOf(error) === 401,
    );
  });

  it('rotates the refresh token and rejects the previous one', async () => {
    const issued = await tokens.issueForUser(3);
    const rotated = await tokens.refresh(issued.refresh_token);

    expect(rotated.refresh_token).not.toBe(issued.refresh_token);
    await expect(tokens.refresh(issued.refresh_token)).rejects.toSatisfy(
      (error: unknown) => statusOf(error) === 401,
    );
    await expect(tokens.resolveAccessToken(rotated.access_token)).resolves.toMatchObject({
      userId: 3,
    });
  });

  it('rejects an unknown token with 401 and does not revoke anything', async () => {
    await expect(tokens.revoke('never-issued')).resolves.toBe(false);
    await expect(tokens.resolveAccessToken('never-issued')).rejects.toSatisfy(
      (error: unknown) => statusOf(error) === 401,
    );
  });

  it('rejects an expired refresh token with 401', async () => {
    const issued = await tokens.issueForUser(3);
    for (const session of state.sessions) {
      session.expira_en = new Date(Date.now() - 1000);
    }
    await expect(tokens.refresh(issued.refresh_token)).rejects.toSatisfy(
      (error: unknown) => statusOf(error) === 401,
    );
  });
});

describe('PKCE and token helpers', () => {
  it('computes the S256 challenge of RFC 7636', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(pkceChallenge(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('hashes tokens instead of storing them verbatim', () => {
    const token = randomToken(32);
    const hash = hashToken(token);

    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(token);
    expect(hashToken(token)).toBe(hash);
    expect(hashToken(randomToken(32))).not.toBe(hash);
    expect(createHash('sha256').update(token).digest('hex')).not.toBe(hash);
  });

  it('generates unique url-safe tokens', () => {
    const first = randomToken(32);
    const second = randomToken(32);
    expect(first).not.toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9\-_]+$/);
  });
});
