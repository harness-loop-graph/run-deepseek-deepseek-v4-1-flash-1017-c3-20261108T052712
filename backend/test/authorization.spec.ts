import { describe, expect, it } from 'vitest';
import { Reflector } from '@nestjs/core';
import { AppException } from '../src/common/errors';
import { AuthGuard, Roles, RolesGuard } from '../src/common/guards';
import { RateLimiterService } from '../src/common/rate-limiter.service';
import { TokensService } from '../src/auth/tokens.service';
import { FakePool, asPool, empty, rows } from './support/fake-pool';
import {
  adminUser,
  createContext,
  createRequest,
  patientUser,
  professionalUser,
  staffUser,
} from './support/http';

/**
 * RF-09 / RF-10: authorization and data isolation.
 *
 * The guards are exercised through the real `Reflector` metadata, and the
 * service-level ownership rules with the fake pool, so the tests cover both
 * layers that enforce the scope (route guard + per-resource check).
 */

function statusOf(error: unknown): number | undefined {
  return error instanceof AppException ? error.getStatus() : undefined;
}

const USER_ROW = {
  id: 3,
  email: 'paciente1@seed.local',
  password_hash: 'scrypt$1$1$1$AA$AA',
  activo: true,
  roles: ['patient'],
  paciente_id: 1,
  profesional_id: null,
};

function tokensPool(session: Record<string, unknown>): FakePool {
  const pool = new FakePool();
  pool.on(/FROM token_sesion/, () => rows([session]));
  pool.on(/FROM usuario u/, () => rows([USER_ROW]));
  return pool;
}

function tokensService(pool: FakePool): TokensService {
  return new TokensService(asPool(pool));
}

function authGuardFor(tokens: TokensService): AuthGuard {
  return new AuthGuard(new Reflector(), tokens, new RateLimiterService());
}

class PatientOnlyController {
  @Roles('patient')
  patientRoute(): void {
    return undefined;
  }
}

class AdminOnlyController {
  @Roles('admin')
  adminRoute(): void {
    return undefined;
  }
}

class UnrestrictedController {
  open(): void {
    return undefined;
  }
}

describe('authentication guard (RF-08, RF-09)', () => {
  it('rejects a request without a bearer token with 401', async () => {
    const guard = authGuardFor(tokensService(tokensPool({})));

    await expect(guard.canActivate(createContext())).rejects.toSatisfy(
      (error: unknown) => statusOf(error) === 401,
    );
  });

  it('rejects an expired access token with 401', async () => {
    const expired = {
      id: 1,
      usuario_id: 3,
      sesion_id: 's',
      tipo: 'access',
      expira_en: new Date(Date.now() - 60_000),
      revocado_en: null,
    };
    const guard = authGuardFor(tokensService(tokensPool(expired)));
    const request = createRequest({ headers: { authorization: 'Bearer expired-token' } });

    await expect(guard.canActivate(createContext({ request }))).rejects.toSatisfy(
      (error: unknown) => statusOf(error) === 401,
    );
  });

  it('rejects a revoked access token with 401', async () => {
    const revoked = {
      id: 1,
      usuario_id: 3,
      sesion_id: 's',
      tipo: 'access',
      expira_en: new Date(Date.now() + 60_000),
      revocado_en: new Date(),
    };
    const guard = authGuardFor(tokensService(tokensPool(revoked)));
    const request = createRequest({ headers: { authorization: 'Bearer revoked-token' } });

    await expect(guard.canActivate(createContext({ request }))).rejects.toSatisfy(
      (error: unknown) => statusOf(error) === 401,
    );
  });

  it('resolves the caller of a valid access token', async () => {
    const valid = {
      id: 1,
      usuario_id: 3,
      sesion_id: 's',
      tipo: 'access',
      expira_en: new Date(Date.now() + 60_000),
      revocado_en: null,
    };
    const guard = authGuardFor(tokensService(tokensPool(valid)));
    const request = createRequest({ headers: { authorization: 'Bearer good-token' } });

    await expect(guard.canActivate(createContext({ request }))).resolves.toBe(true);
    expect(request.user?.patientId).toBe(1);
    expect(request.user?.roles).toEqual(['patient']);
  });
});

describe('role guard (RF-09)', () => {
  const guard = new RolesGuard(new Reflector());

  it('allows a role declared on the handler', () => {
    const context = createContext({
      handler: PatientOnlyController.prototype.patientRoute,
      controller: PatientOnlyController,
      request: createRequest({ user: patientUser() }),
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('denies a patient on an admin route with 403', () => {
    const context = createContext({
      handler: AdminOnlyController.prototype.adminRoute,
      controller: AdminOnlyController,
      request: createRequest({ user: patientUser() }),
    });
    expect(() => guard.canActivate(context)).toThrowError(
      expect.objectContaining({ code: 'forbidden' }),
    );
  });

  it('denies staff on an admin route with 403', () => {
    const context = createContext({
      handler: AdminOnlyController.prototype.adminRoute,
      controller: AdminOnlyController,
      request: createRequest({ user: staffUser() }),
    });
    expect(() => guard.canActivate(context)).toThrowError(
      expect.objectContaining({ code: 'forbidden' }),
    );
  });

  it('allows an admin on an admin route', () => {
    const context = createContext({
      handler: AdminOnlyController.prototype.adminRoute,
      controller: AdminOnlyController,
      request: createRequest({ user: adminUser() }),
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('leaves a route without a role declaration to the auth guard', () => {
    const context = createContext({
      handler: UnrestrictedController.prototype.open,
      controller: UnrestrictedController,
    });
    expect(guard.canActivate(context)).toBe(true);
  });
});

describe('clinical history isolation (RF-10)', () => {
  it('denies a patient the history of another patient', async () => {
    const { EncountersService } = await import('../src/encounters/encounters.service');
    const { AuditService } = await import('../src/audit/audit.service');
    const pool = new FakePool();
    pool.on(/FROM paciente WHERE id/, () => rows([{ exists: true }]));
    pool.on(/FROM cita\s+WHERE profesional_id/, () => empty());
    const service = new EncountersService(asPool(pool), new AuditService(asPool(pool)));

    await expect(service.clinicalHistory(patientUser(3, 1), 2)).rejects.toSatisfy(
      (error: unknown) => statusOf(error) === 403,
    );
  });

  it('denies a professional without an assigned appointment', async () => {
    const { EncountersService } = await import('../src/encounters/encounters.service');
    const { AuditService } = await import('../src/audit/audit.service');
    const pool = new FakePool();
    pool.on(/FROM paciente WHERE id/, () => rows([{ exists: true }]));
    pool.on(/SELECT EXISTS/, () => rows([{ exists: false }]));
    const service = new EncountersService(asPool(pool), new AuditService(asPool(pool)));

    await expect(service.clinicalHistory(professionalUser(6, 1), 2)).rejects.toSatisfy(
      (error: unknown) => statusOf(error) === 403,
    );
  });

  it('allows a professional with an assigned appointment', async () => {
    const { EncountersService } = await import('../src/encounters/encounters.service');
    const { AuditService } = await import('../src/audit/audit.service');
    const pool = new FakePool();
    pool.on(/FROM paciente WHERE id/, () => rows([{ exists: true }]));
    pool.on(/SELECT EXISTS/, () => rows([{ exists: true }]));
    const service = new EncountersService(asPool(pool), new AuditService(asPool(pool)));

    const history = await service.clinicalHistory(professionalUser(6, 1), 2);
    expect(history.patientId).toBe(2);
    expect(history.encounters).toEqual([]);
  });

  it('allows a patient their own history', async () => {
    const { EncountersService } = await import('../src/encounters/encounters.service');
    const { AuditService } = await import('../src/audit/audit.service');
    const pool = new FakePool();
    pool.on(/FROM paciente WHERE id/, () => rows([{ exists: true }]));
    const service = new EncountersService(asPool(pool), new AuditService(asPool(pool)));

    const history = await service.clinicalHistory(patientUser(3, 1), 1);
    expect(history.patientId).toBe(1);
  });
});

describe('appointment isolation (RF-10)', () => {
  const appointmentRow = {
    id: 7,
    paciente_id: 2,
    profesional_id: 2,
    franja_inicio: new Date('2030-01-07T09:00:00.000Z'),
    franja_fin: new Date('2030-01-07T09:30:00.000Z'),
    estado: 'scheduled',
    creada_en: new Date('2030-01-01T00:00:00.000Z'),
    paciente_nombre: 'Luis',
    paciente_apellidos: 'Ramírez',
    paciente_documento: 'DOC-0002',
    profesional_nombre: 'Javier',
    profesional_apellidos: 'López',
    profesional_especialidad: 'Cardiología',
  };

  async function service(): Promise<{
    detail: (user: ReturnType<typeof patientUser>, id: number) => Promise<unknown>;
  }> {
    const { AppointmentsService } = await import('../src/appointments/appointments.service');
    const { AuditService } = await import('../src/audit/audit.service');
    const pool = new FakePool();
    pool.on(/FROM cita c/, () => rows([appointmentRow]));
    return new AppointmentsService(asPool(pool), new AuditService(asPool(pool)));
  }

  it('denies a patient the appointment of another patient', async () => {
    const appointments = await service();
    await expect(appointments.detail(patientUser(3, 1), 7)).rejects.toSatisfy(
      (error: unknown) => statusOf(error) === 403,
    );
  });

  it('denies a professional an appointment assigned to a colleague', async () => {
    const appointments = await service();
    await expect(appointments.detail(professionalUser(6, 1), 7)).rejects.toSatisfy(
      (error: unknown) => statusOf(error) === 403,
    );
  });

  it('allows the assigned professional', async () => {
    const appointments = await service();
    const detail = (await appointments.detail(professionalUser(7, 2), 7)) as {
      id: number;
    };
    expect(detail.id).toBe(7);
  });

  it('denies staff any appointment detail (clinical content)', async () => {
    const appointments = await service();
    await expect(appointments.detail(staffUser(), 7)).rejects.toSatisfy(
      (error: unknown) => statusOf(error) === 403,
    );
  });
});
