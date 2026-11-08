import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { AuthRateLimited, CurrentUser, Public } from '../common/guards';
import { AppException, invalidGrant, unauthorized } from '../common/errors';
import { RateLimiterService } from '../common/rate-limiter.service';
import { AuthUser } from './auth-user';
import { AuthService } from './auth.service';
import { IssuedTokens } from './tokens.service';
import {
  AuthorizeQuery,
  TokenBodyDto,
  TokenRequestDto,
  authorizeQuerySchema,
  loginFormSchema,
  tokenBodySchema,
  tokenRequestSchema,
} from './auth.dto';
import { renderLoginErrorPage, renderLoginForm } from './login-form';
import {
  HttpRequest,
  HttpResponse,
  clientIp,
  redirect,
  sendHtml,
} from '../common/http.types';

/**
 * EP-01 .. EP-04 (RF-07, RF-08).
 *
 * The authorization endpoint and the login form are server-rendered so the
 * whole flow is automatable with a standard HTML form; the token endpoints are
 * plain JSON.
 *
 * RF-14 quota: the four credential-verifying endpoints (`POST /auth/login`,
 * `/auth/token`, `/auth/token/refresh`, `/auth/revoke`) are limited to 5
 * requests per minute per IP. A successful call refunds its slot — the quota
 * exists to stop credential guessing, not to lock a clinic out of its own
 * sessions — while every failed attempt keeps consuming it, so a brute force
 * run is throttled with `429` + `Retry-After` after five tries.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly limiter: RateLimiterService,
  ) {}

  /** EP-01: validates the request and redirects (302) to the login form. */
  @Public()
  @Get('authorize')
  authorize(@Query() rawQuery: Record<string, unknown>, @Res() response: HttpResponse): void {
    const parsed = authorizeQuerySchema.parse(rawQuery, 'query');
    const request = { ...parsed, code_challenge_method: parsed.code_challenge_method ?? 'S256' };
    this.auth.validateAuthorizeRequest(request);

    const location = new URL('/auth/login', 'http://backend.local');
    location.searchParams.set('response_type', request.response_type);
    location.searchParams.set('client_id', request.client_id);
    location.searchParams.set('redirect_uri', request.redirect_uri);
    location.searchParams.set('code_challenge', request.code_challenge);
    location.searchParams.set('code_challenge_method', request.code_challenge_method);
    location.searchParams.set('state', request.state);

    redirect(response, `${location.pathname}${location.search}`);
  }

  /**
   * EP-01 (login form): renders the standard HTML form whose hidden fields
   * carry the authorization request. No separate consent step.
   */
  @Public()
  @Get('login')
  loginForm(@Query() rawQuery: Record<string, unknown>, @Res() response: HttpResponse): void {
    let parsed: AuthorizeQuery;
    try {
      parsed = authorizeQuerySchema.parse(rawQuery, 'query');
    } catch (error) {
      const message =
        error instanceof AppException ? error.message : 'Invalid authorization request.';
      sendHtml(response, 400, renderLoginErrorPage(message));
      return;
    }
    const request = { ...parsed, code_challenge_method: parsed.code_challenge_method ?? 'S256' };

    try {
      this.auth.validateAuthorizeRequest(request);
    } catch (error) {
      const message =
        error instanceof AppException ? error.message : 'Invalid authorization request.';
      sendHtml(response, 400, renderLoginErrorPage(message));
      return;
    }

    sendHtml(
      response,
      200,
      renderLoginForm({
        response_type: request.response_type,
        client_id: request.client_id,
        redirect_uri: request.redirect_uri,
        code_challenge: request.code_challenge,
        code_challenge_method: request.code_challenge_method,
        state: request.state,
      }),
    );
  }

  /**
   * EP-01 (form submit): authenticates the credentials and redirects (302) to
   * the registered redirect URI with `code` and `state`.
   */
  @Public()
  @AuthRateLimited()
  @Post('login')
  async submitLogin(
    @Body() rawBody: unknown,
    @Req() request: HttpRequest,
    @Res() response: HttpResponse,
  ): Promise<void> {
    const parsed = loginFormSchema.parse(rawBody, 'body');
    const form = { ...parsed, code_challenge_method: parsed.code_challenge_method ?? 'S256' };

    try {
      const location = await this.auth.completeLogin(form, parsed.email, parsed.password);
      this.refund(request);
      redirect(response, location);
    } catch (error) {
      const message =
        error instanceof AppException ? error.message : 'The credentials could not be verified.';
      sendHtml(
        response,
        401,
        renderLoginForm(
          {
            response_type: form.response_type,
            client_id: form.client_id,
            redirect_uri: form.redirect_uri,
            code_challenge: form.code_challenge,
            code_challenge_method: form.code_challenge_method,
            state: form.state,
          },
          message,
        ),
      );
    }
  }

  /** EP-02: authorization code + PKCE verifier -> token pair. */
  @Public()
  @AuthRateLimited()
  @Post('token')
  @HttpCode(200)
  async token(
    @Body() rawBody: unknown,
    @Req() request: HttpRequest,
  ): Promise<IssuedTokens> {
    const body: TokenRequestDto = tokenRequestSchema.parse(rawBody, 'body');
    const issued = await this.auth.exchangeCode(body);
    this.refund(request);
    return issued;
  }

  /** EP-03: refresh -> rotated token pair; 401 when expired or revoked. */
  @Public()
  @AuthRateLimited()
  @Post('token/refresh')
  @HttpCode(200)
  async refresh(
    @Body() rawBody: unknown,
    @Req() request: HttpRequest,
  ): Promise<IssuedTokens> {
    const body: TokenBodyDto = tokenBodySchema.parse(rawBody, 'body');
    const refreshToken = body.refresh_token ?? body.refreshToken ?? body.token;
    if (refreshToken === undefined) {
      throw invalidGrant('refresh_token is required.');
    }
    const issued = await this.auth.refresh(refreshToken);
    this.refund(request);
    return issued;
  }

  /**
   * EP-04: revokes the caller's session. Accepts the refresh token in the body
   * or the access token in the `Authorization` header; 204 on success.
   */
  @Public()
  @AuthRateLimited()
  @Post('revoke')
  @HttpCode(204)
  async revoke(
    @Body() rawBody: unknown,
    @Req() request: HttpRequest,
    @CurrentUser() user: AuthUser | undefined,
  ): Promise<void> {
    const body: TokenBodyDto = tokenBodySchema.parse(rawBody ?? {}, 'body');
    const header = request.headers.authorization;
    const bearer =
      typeof header === 'string' ? /^Bearer\s+(.+)$/i.exec(header.trim())?.[1] : undefined;
    const token = body.refresh_token ?? body.refreshToken ?? body.token ?? bearer;

    if (token === undefined || token.trim() === '') {
      throw unauthorized('A token is required to revoke the session.');
    }

    let actorId = user?.userId;
    if (actorId === undefined) {
      actorId = await this.auth.actorOfToken(token);
    }
    await this.auth.revoke(token, actorId);
    this.refund(request);
  }

  /** Returns the consumed auth slot of a successful call (see the class doc). */
  private refund(request: HttpRequest): void {
    this.limiter.clear('auth', clientIp(request));
  }
}
