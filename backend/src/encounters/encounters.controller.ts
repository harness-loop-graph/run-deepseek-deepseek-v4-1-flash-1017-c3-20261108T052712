import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser, Roles } from '../common/guards';
import { AuthUser } from '../auth/auth-user';
import { maxUploadBytes } from '../common/app-config';
import { validationError } from '../common/errors';
import { HttpRequest, HttpResponse, UploadedFile as UploadedFileShape } from '../common/http.types';
import { clinicalHistoryQuerySchema, idParamSchema } from './encounter.dto';
import { ClinicalHistory, EncountersService, StoredAttachment } from './encounters.service';

/**
 * EP-12, EP-13, EP-14.
 *
 * `staff` and `admin` are deliberately absent from every route here: clinical
 * content is never reachable by a scheduling or administration role (RF-10).
 */
@Controller()
export class EncountersController {
  constructor(private readonly encounters: EncountersService) {}

  /** EP-12: chronology of one patient (self, or assigned professional). */
  @Roles('patient', 'professional')
  @Get('patients/:id/clinical-history')
  history(
    @Param() rawParams: Record<string, unknown>,
    @Query() rawQuery: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ): Promise<ClinicalHistory> {
    const params = idParamSchema.parse(rawParams, 'params');
    clinicalHistoryQuerySchema.parse(rawQuery, 'query');
    return this.encounters.clinicalHistory(user, params.id);
  }

  /**
   * EP-13: multipart upload of one attachment. The size limit is enforced by
   * the multipart parser (413) and again by the service (413); the declared
   * MIME type must be PDF/JPEG/PNG and match the file signature (415).
   */
  @Roles('professional')
  @Post('encounters/:id/attachments')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: maxUploadBytes(), files: 1 } }))
  upload(
    @Param() rawParams: Record<string, unknown>,
    @UploadedFile() file: UploadedFileShape | undefined,
    @CurrentUser() user: AuthUser,
    @Req() request: HttpRequest,
  ): Promise<StoredAttachment> {
    const params = idParamSchema.parse(rawParams, 'params');
    const single = file ?? firstFile(request);
    if (single === undefined) {
      throw validationError('body.file: a file is required');
    }
    return this.encounters.upload(user, params.id, single);
  }

  /** EP-14: streams an attachment to its author or the owning patient. */
  @Roles('patient', 'professional')
  @Get('attachments/:id')
  async download(
    @Param() rawParams: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
    @Res() response: HttpResponse,
  ): Promise<void> {
    const params = idParamSchema.parse(rawParams, 'params');
    const attachment = await this.encounters.download(user, params.id);

    response.status(200);
    response.setHeader('Content-Type', attachment.mimeType);
    response.setHeader('Content-Length', String(attachment.body.length));
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${attachment.filename.replace(/["\\]/g, '_')}"`,
    );
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.send(attachment.body);
  }
}

/** Falls back to any single uploaded file when the field name differs. */
function firstFile(request: HttpRequest): UploadedFileShape | undefined {
  const files = (request as HttpRequest & { files?: UploadedFileShape[] }).files;
  if (Array.isArray(files) && files.length > 0) {
    return files[0];
  }
  const single = (request as HttpRequest & { file?: UploadedFileShape }).file;
  return single;
}
