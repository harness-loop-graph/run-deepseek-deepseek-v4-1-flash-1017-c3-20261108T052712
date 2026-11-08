import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokensService } from './tokens.service';

/**
 * EP-01 .. EP-04 (RF-07, RF-08).
 *
 * `TokensService` is exported because the global `AuthGuard` resolves the
 * bearer token of every other module through it.
 */
@Module({
  controllers: [AuthController],
  providers: [AuthService, TokensService],
  exports: [TokensService, AuthService],
})
export class AuthModule {}
