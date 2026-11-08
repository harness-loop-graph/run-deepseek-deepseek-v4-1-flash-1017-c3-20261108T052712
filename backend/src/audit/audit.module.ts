import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/**
 * Global audit module (RF-15): every write and every clinical read records an
 * `auditoria` row. Global so domain modules inject `AuditService` directly.
 */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
