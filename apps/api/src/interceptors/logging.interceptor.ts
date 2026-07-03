import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const { method, path } = req;
    const start = Date.now();

    return next.handle().pipe(
      tap({
        complete: () => {
          const res = context.switchToHttp().getResponse<Response>();
          this.logger.log(
            `${method} ${path} ${res.statusCode} ${Date.now() - start}ms`,
          );
        },
        error: (err: unknown) => {
          const anyErr = err as {
            status?: number;
            statusCode?: number;
            getStatus?: () => number;
          };
          const status =
            typeof anyErr?.getStatus === 'function'
              ? anyErr.getStatus()
              : (anyErr?.statusCode ?? anyErr?.status ?? 500);

          const message = err instanceof Error ? err.message : String(err);
          this.logger.error(
            `${method} ${path} ${status} ${Date.now() - start}ms ${message}`,
            err instanceof Error ? err.stack : undefined,
          );
        },
      }),
    );
  }
}
