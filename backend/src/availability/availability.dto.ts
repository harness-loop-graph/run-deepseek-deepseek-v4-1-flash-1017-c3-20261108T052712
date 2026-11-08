import {
  Schema,
  arrayOf,
  integer,
  object,
  optional,
  query,
  required,
  string,
} from '../common/validation';

/**
 * Strict request schemas for the availability endpoints (RF-12).
 * Dates are `YYYY-MM-DD` and timestamps are ISO-8601, as fixed by SPEC.md.
 */

export interface AvailabilityQuery {
  professionalId: number;
  from?: string;
  to?: string;
}

export const availabilityQuerySchema: Schema<AvailabilityQuery> = query<AvailabilityQuery>({
  professionalId: required(integer({ min: 1 })),
  from: optional(string({ format: 'date' })),
  to: optional(string({ format: 'date' })),
});

export interface AgendaQuery {
  from?: string;
  to?: string;
  /** Only used by staff: a professional always reads their own agenda. */
  professionalId?: number;
}

export const agendaQuerySchema: Schema<AgendaQuery> = query<AgendaQuery>({
  from: optional(string({ format: 'date' })),
  to: optional(string({ format: 'date' })),
  professionalId: optional(integer({ min: 1 })),
});

export interface SlotDto {
  start: string;
  end: string;
}

export interface AvailabilityReplacementDto {
  slots: SlotDto[];
}

/** EP-18: a full replacement of the professional's slot set. */
export const availabilityReplacementSchema: Schema<AvailabilityReplacementDto> =
  object<AvailabilityReplacementDto>({
    slots: required(
      arrayOf<SlotDto>(
        object<SlotDto>({
          start: required(string({ format: 'date-time' })),
          end: required(string({ format: 'date-time' })),
        }),
        { maxLength: 2000 },
      ),
    ),
  });

export interface IdParam {
  id: number;
}

export const idParamSchema: Schema<IdParam> = object<IdParam>({
  id: required(integer({ min: 1 })),
});
