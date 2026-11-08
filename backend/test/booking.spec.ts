import { describe, expect, it } from 'vitest';
import { AppException } from '../src/common/errors';
import { AppointmentsService } from '../src/appointments/appointments.service';
import { AuditService } from '../src/audit/audit.service';
import { FakePool, asPool, empty, rows } from './support/fake-pool';
import { patientUser, staffUser } from './support/http';

/**
 * RF-13: the booking transaction.
 *
 * `book()` opens a transaction, locks the availability row (`FOR UPDATE`), then
 * checks and inserts the appointment. The fake pool serialises transactions
 * through `BEGIN`, which is exactly the lock semantics of PostgreSQL: the
 * second concurrent booking only starts after the first one committed, so it
 * re-reads the committed row and must be rejected with 409.
 */

const SLOT = '2030-01-07T09:00:00.000Z';
const SLOT_END = '2030-01-07T09:30:00.000Z';

interface BookingState {
  taken: Map<string, number>;
  nextId: number;
}

function bookingPool(state: BookingState = { taken: new Map(), nextId: 1 }): {
  pool: FakePool;
  state: BookingState;
} {
  const pool = new FakePool();

  pool.on(/FROM disponibilidad/, (params) =>
    params[1] === SLOT ? rows([{ franja_fin: new Date(SLOT_END) }]) : empty(),
  );

  pool.on(/FROM cita/, (params) => {
    const key = `${String(params[0])}|${String(params[1])}`;
    const id = state.taken.get(key);
    return id === undefined ? empty() : rows([{ id }]);
  });

  pool.on(/INSERT INTO cita/, (params) => {
    const key = `${String(params[1])}|${String(params[2])}`;
    if (state.taken.has(key)) {
      // The partial unique index turns the duplicate into no row at all.
      return empty();
    }
    const id = state.nextId;
    state.nextId += 1;
    state.taken.set(key, id);
    return rows([{ id }]);
  });

  return { pool, state };
}

function serviceFor(pool: FakePool): AppointmentsService {
  return new AppointmentsService(asPool(pool), new AuditService(asPool(pool)));
}

function statusOf(error: unknown): number | undefined {
  return error instanceof AppException ? error.getStatus() : undefined;
}

describe('EP-07 booking transaction (RF-13)', () => {
  it('books a free slot and returns its id inside one transaction', async () => {
    const { pool, state } = bookingPool();
    const service = serviceFor(pool);

    const created = await service.book(patientUser(3, 1), 1, SLOT);

    expect(created.id).toBe(1);
    expect(state.taken.size).toBe(1);
    expect(pool.transactions()).toBe(1);
    expect(pool.statements).toContain('COMMIT');
  });

  it('gives one success and one 409 for two concurrent bookings of the same slot', async () => {
    const { pool, state } = bookingPool();
    const service = serviceFor(pool);

    const [first, second] = await Promise.allSettled([
      service.book(patientUser(3, 1), 1, SLOT),
      service.book(patientUser(4, 2), 1, SLOT),
    ]);

    const fulfilled = [first, second].filter((result) => result.status === 'fulfilled');
    const rejected = [first, second].filter((result) => result.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const failure = (rejected[0] as PromiseRejectedResult).reason;
    expect(statusOf(failure)).toBe(409);
    expect(state.taken.size).toBe(1);
    // Both transactions were opened; the loser rolled back.
    expect(pool.transactions()).toBe(2);
    expect(pool.statements).toContain('ROLLBACK');
  });

  it('rejects a slot the professional does not offer with 422', async () => {
    const { pool } = bookingPool();
    const service = serviceFor(pool);

    await expect(service.book(patientUser(), 1, '2030-01-07T23:00:00.000Z')).rejects.toSatisfy(
      (error: unknown) => statusOf(error) === 422,
    );
    expect(pool.statements).toContain('ROLLBACK');
  });

  it('rejects a slot in the past with 422 before opening a transaction', async () => {
    const { pool } = bookingPool();
    const service = serviceFor(pool);

    await expect(service.book(patientUser(), 1, '2000-01-01T09:00:00.000Z')).rejects.toSatisfy(
      (error: unknown) => statusOf(error) === 422,
    );
    expect(pool.transactions()).toBe(0);
  });

  it('denies booking to a caller without a patient profile (403)', async () => {
    const { pool } = bookingPool();
    const service = serviceFor(pool);

    await expect(service.book(staffUser(), 1, SLOT)).rejects.toSatisfy(
      (error: unknown) => statusOf(error) === 403,
    );
  });
});
