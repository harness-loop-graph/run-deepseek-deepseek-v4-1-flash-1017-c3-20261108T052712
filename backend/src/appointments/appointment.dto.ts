import {
  Schema,
  integer,
  nonEmptyString,
  object,
  optional,
  query,
  required,
  string,
} from '../common/validation';

/** Strict schemas of the appointment endpoints (RF-12). */

export interface BookAppointmentDto {
  professionalId: number;
  slotStart: string;
}

export const bookAppointmentSchema: Schema<BookAppointmentDto> = object<BookAppointmentDto>({
  professionalId: required(integer({ min: 1 })),
  slotStart: required(string({ format: 'date-time' })),
});

export interface EncounterDto {
  notes: string;
  diagnosis: string;
}

export const encounterSchema: Schema<EncounterDto> = object<EncounterDto>({
  notes: required(nonEmptyString(20_000)),
  diagnosis: required(nonEmptyString(20_000)),
});

export interface IdParam {
  id: number;
}

export const idParamSchema: Schema<IdParam> = object<IdParam>({
  id: required(integer({ min: 1 })),
});

export interface PageQuery {
  page?: number;
}

export const pageQuerySchema: Schema<PageQuery> = query<PageQuery>({
  page: optional(integer({ min: 1, max: 100_000 })),
});
