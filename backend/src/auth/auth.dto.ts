import {
  Schema,
  arrayOf,
  nonEmptyString,
  object,
  oneOf,
  optional,
  query,
  required,
  string,
} from '../common/validation';
import { ROLE_NAMES, RoleName } from './auth-user';

/**
 * Strict request schemas of the auth endpoints (RF-12).
 * `response_type`, `client_id`, `redirect_uri`, `code_challenge`,
 * `code_challenge_method` and `state` are the fixed EP-01 query contract.
 */

export interface AuthorizeQuery {
  response_type: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method?: string;
  state: string;
}

export const authorizeQuerySchema: Schema<AuthorizeQuery> = query<AuthorizeQuery>({
  response_type: required(string({ maxLength: 32 })),
  client_id: required(string({ maxLength: 128 })),
  redirect_uri: required(string({ maxLength: 2048 })),
  code_challenge: required(string({ maxLength: 128 })),
  code_challenge_method: optional(string({ maxLength: 16 })),
  state: required(string({ maxLength: 512 })),
});

export interface LoginFormDto {
  response_type: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method?: string;
  state: string;
  email: string;
  password: string;
}

/** Hidden fields carried by the login form plus the credentials (EP-01). */
export const loginFormSchema: Schema<LoginFormDto> = object<LoginFormDto>({
  response_type: required(string({ maxLength: 32 })),
  client_id: required(string({ maxLength: 128 })),
  redirect_uri: required(string({ maxLength: 2048 })),
  code_challenge: required(string({ maxLength: 128 })),
  code_challenge_method: optional(string({ maxLength: 16 })),
  state: required(string({ maxLength: 512 })),
  email: required(string({ maxLength: 254, format: 'email' })),
  password: required(string({ maxLength: 512, trim: false, minLength: 1 })),
});

export interface TokenRequestDto {
  code: string;
  code_verifier: string;
  client_id: string;
  redirect_uri: string;
}

export const tokenRequestSchema: Schema<TokenRequestDto> = object<TokenRequestDto>({
  code: required(string({ maxLength: 512 })),
  code_verifier: required(string({ maxLength: 128, trim: false })),
  client_id: required(string({ maxLength: 128 })),
  redirect_uri: required(string({ maxLength: 2048 })),
});

export interface TokenBodyDto {
  token?: string;
  refresh_token?: string;
  refreshToken?: string;
}

export const tokenBodySchema: Schema<TokenBodyDto> = object<TokenBodyDto>({
  token: optional(string({ maxLength: 1024, trim: false })),
  refresh_token: optional(string({ maxLength: 1024, trim: false })),
  refreshToken: optional(string({ maxLength: 1024, trim: false })),
});

export const roleListSchema: Schema<RoleName[]> = arrayOf<RoleName>(oneOf(ROLE_NAMES), {
  minLength: 1,
  maxLength: ROLE_NAMES.length,
});

export interface CreateUserDto {
  email: string;
  roles: RoleName[];
}

export const createUserSchema: Schema<CreateUserDto> = object<CreateUserDto>({
  email: required(string({ maxLength: 254, format: 'email' })),
  roles: required(roleListSchema),
});

export interface UpdateRolesDto {
  roles: RoleName[];
}

export const updateRolesSchema: Schema<UpdateRolesDto> = object<UpdateRolesDto>({
  roles: required(roleListSchema),
});

/** Clinical free text (RF-22: rendered as text, never as HTML). */
export const clinicalTextSchema: Schema<string> = nonEmptyString(20_000);
