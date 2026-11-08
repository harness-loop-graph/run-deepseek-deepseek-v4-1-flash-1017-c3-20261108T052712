import { Schema, integer, object, optional, query, required, string } from '../common/validation';

/**
 * Strict schemas of the clinical endpoints (RF-12).
 *
 * Dates are `YYYY-MM-DD`; timestamps are ISO-8601. Undeclared fields are a 422
 * on every endpoint, so a client can never smuggle an extra column into a
 * write.
 */

export interface IdParam {
  id: number;
}

export const idParamSchema: Schema<IdParam> = object<IdParam>({
  id: required(integer({ min: 1 })),
});

export interface ClinicalHistoryQuery {
  /** Accepted for forward compatibility; the chronology is always complete. */
  page?: number;
}

export const clinicalHistoryQuerySchema: Schema<ClinicalHistoryQuery> =
  query<ClinicalHistoryQuery>({
    page: optional(integer({ min: 1, max: 100_000 })),
  });

/** Form field names accepted by EP-13, in order of preference. */
export const ATTACHMENT_FIELDS = ['file', 'attachment', 'archivo'] as const;
