import { Migration } from './types';
import { migration as rolesUsuarios } from './001_roles_usuarios.migration';
import { migration as pacientesProfesionales } from './002_pacientes_profesionales.migration';
import { migration as disponibilidad } from './003_disponibilidad.migration';
import { migration as citas } from './004_citas.migration';
import { migration as encuentros } from './005_encuentros.migration';
import { migration as adjuntos } from './006_adjuntos.migration';
import { migration as auditoria } from './007_auditoria.migration';
import { migration as oauthTokens } from './008_oauth_tokens.migration';

/**
 * Versioned migration registry (RF-02).
 *
 * A migration is a module named `NNN_name.migration.ts` exporting
 * `export const migration: Migration` with both `up` and `down`. This list is
 * the canonical order: a new version is created as a new file and appended
 * here, which keeps the applied sequence explicit and reviewable.
 */
export const migrations: readonly Migration[] = [
  rolesUsuarios,
  pacientesProfesionales,
  disponibilidad,
  citas,
  encuentros,
  adjuntos,
  auditoria,
  oauthTokens,
];

/**
 * Fails fast on an inconsistent registry: versions must be positive integers in
 * strictly ascending order, names must be unique, and every migration must
 * carry both directions of the change (RF-02).
 */
export function validateMigrations(list: readonly Migration[]): void {
  if (list.length === 0) {
    throw new Error('migrations_registry_empty');
  }

  const names = new Set<string>();
  let previousVersion = 0;

  for (const migration of list) {
    if (!Number.isInteger(migration.version) || migration.version <= 0) {
      throw new Error(`migration_invalid_version: ${String(migration.version)}`);
    }
    if (migration.version <= previousVersion) {
      throw new Error(`migration_version_order: ${migration.version} after ${previousVersion}`);
    }
    if (migration.name.trim() === '' || names.has(migration.name)) {
      throw new Error(`migration_invalid_name: ${migration.name}`);
    }
    if (migration.up.trim() === '' || migration.down.trim() === '') {
      throw new Error(`migration_missing_direction: ${migration.name}`);
    }
    names.add(migration.name);
    previousVersion = migration.version;
  }
}

export type { Migration } from './types';
