/**
 * Contract for a versioned, reversible migration (RF-02).
 *
 * A migration carries both directions of the change: `up` creates it and
 * `down` undoes exactly that. The SQL lives next to the TypeScript module (one
 * module per version) so the compiled output in `dist/` is self-contained: the
 * backend image needs no asset-copy step and the runner can never drift from
 * the sources.
 *
 * Adding a migration: create `NNN_name.migration.ts` exporting
 * `export const migration: Migration` and register it in `index.ts`.
 */
export interface Migration {
  /** Ordered, unique version number. */
  version: number;
  /** Human readable name, recorded in `schema_migrations`. */
  name: string;
  /** Forward SQL, executed inside one transaction. */
  up: string;
  /** Reverse SQL, executed inside one transaction. */
  down: string;
}
