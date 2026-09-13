import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditService } from '../../modules/audit/audit.service';

/**
 * Audit Interceptor — HIPAA § 164.312(b) Audit Controls
 *
 * Logs:
 *  1. All mutating requests (POST / PUT / PATCH / DELETE)
 *  2. Authenticated GET access to PHI-bearing nursing resources
 *     (nurse master, credentials, roster)
 *
 * PHI read logs intentionally store only metadata (who / what resource / when /
 * outcome). Response bodies are never written to the audit trail so the log
 * system does not become a second copy of ePHI.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  /**
   * Path patterns that expose ePHI (or strong identifiers linked to workforce
   * health operations). Matched against the path only (no query string).
   */
  private static readonly PHI_READ_PATTERNS: RegExp[] = [
    /\/nursing\/nurses(\/|$)/i, // list + /nurses/:id + /nurses/:id/credentials
    /\/nursing\/credentials(\/|$)/i, // expiring credentials, etc.
    /\/nursing\/roster(\/|$)/i, // roster list / filters
  ];

  constructor(private auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, body, params, query, user, ip, headers } = request;
    const path = (url || '').split('?')[0];

    const isMutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    const isPhiRead = method === 'GET' && this.isPhiReadPath(path);

    // /auth/* is audited explicitly by AuthService (login success/failure,
    // lockouts). Double-logging would include attempt bodies we must not store.
    const isAuthRoute = /(^|\/)auth(\/|$)/i.test(path);

    // Lookups are reference data only — not PHI access.
    const isLookup = /\/nursing\/lookups(\/|$)/i.test(path);

    const shouldAudit =
      !isAuthRoute && !isLookup && !!user && (isMutating || isPhiRead);

    if (!shouldAudit) {
      return next.handle();
    }

    const startTime = Date.now();
    const entityType = this.extractEntityType(path);
    const entityId = this.extractEntityId(params, path);

    return next.handle().pipe(
      tap({
        next: async () => {
          const duration = Date.now() - startTime;
          const action = isPhiRead
            ? `VIEW_${entityType}`.toUpperCase()
            : `${method}_${entityType}`.toUpperCase();

          try {
            await this.auditService.log({
              userId: user.id ?? user.sub,
              username: user.username,
              action,
              entityType,
              entityId,
              description: isPhiRead
                ? `PHI read ${method} ${path} - ${duration}ms`
                : `${method} ${path} - ${duration}ms`,
              changes: isPhiRead
                ? {
                    // Metadata only — no response payload (would re-store PHI).
                    accessType: 'READ',
                    path,
                    params: this.sanitizeParams(params),
                    query: this.sanitizeQuery(query),
                  }
                : {
                    body: this.sanitizeBody(body),
                    params: this.sanitizeParams(params),
                    query: this.sanitizeQuery(query),
                  },
              ipAddress: ip,
              userAgent: headers?.['user-agent'],
              sessionId: user.sessionId,
              status: 'Success',
            });
          } catch (error: any) {
            this.logger.error(`Failed to write audit log: ${error.message}`, error.stack);
          }
        },
        error: async (error: any) => {
          const duration = Date.now() - startTime;
          const action = isPhiRead
            ? `FAILED_VIEW_${entityType}`.toUpperCase()
            : `FAILED_${method}_${entityType}`.toUpperCase();

          try {
            await this.auditService.log({
              userId: user?.id ?? user?.sub,
              username: user?.username,
              action,
              entityType,
              entityId,
              description: `${method} ${path} failed - ${duration}ms - ${error?.message || 'error'}`,
              changes: isPhiRead
                ? {
                    accessType: 'READ',
                    path,
                    params: this.sanitizeParams(params),
                    query: this.sanitizeQuery(query),
                  }
                : undefined,
              ipAddress: ip,
              userAgent: headers?.['user-agent'],
              sessionId: user?.sessionId,
              status: 'Failure',
              errorMessage: error?.message,
            });
          } catch (auditError: any) {
            this.logger.error(`Failed to write audit failure log: ${auditError.message}`);
          }
        },
      }),
    );
  }

  private isPhiReadPath(path: string): boolean {
    return AuditInterceptor.PHI_READ_PATTERNS.some((re) => re.test(path));
  }

  private extractEntityType(path: string): string {
    const p = path.toLowerCase();

    // Nursing / PHI
    if (p.includes('/nursing/nurses') && p.includes('/credentials')) return 'NurseCredential';
    if (p.includes('/nursing/nurses')) return 'Nurse';
    if (p.includes('/nursing/credentials')) return 'Credential';
    if (p.includes('/nursing/roster')) return 'RosterAssignment';

    // RBAC / admin
    if (p.includes('access-levels')) return 'AccessLevel';
    if (p.includes('menus')) return 'Menu';
    if (p.includes('permissions')) return 'Permission';
    if (p.includes('data-scopes')) return 'UserDataScope';
    if (p.includes('roles')) return 'Role';
    if (p.includes('/users')) return 'User';
    if (p.includes('/audit')) return 'AuditLog';
    if (p.includes('auth')) return 'Auth';

    return 'Unknown';
  }

  private extractEntityId(params: any, path: string): number | undefined {
    if (params?.id != null && params.id !== '') {
      const n = parseInt(String(params.id), 10);
      return Number.isFinite(n) ? n : undefined;
    }
    // /nursing/nurses/:id/credentials — id is the nurse
    const m = path.match(/\/nursing\/nurses\/(\d+)/i);
    if (m) {
      const n = parseInt(m[1], 10);
      return Number.isFinite(n) ? n : undefined;
    }
    return undefined;
  }

  private sanitizeBody(body: any): any {
    if (!body || typeof body !== 'object') return null;
    const sanitized = { ...body };
    // Credential fields can contain passport/residency identifiers and health status.
    // Audit field names, without copying these values into another data store.
    if ('tracking_data' in sanitized || 'template_code' in sanitized || 'credential_number' in sanitized) {
      return { fields: Object.keys(sanitized) };
    }
    // L-4 fix: redact PHI/PII fields that were previously logged verbatim.
    // HIPAA §164.312(b) requires audit controls but also mandates the minimum
    // necessary standard — only log that these fields were present, not their values.
    const PHI_FIELDS = [
      'password', 'password_hash', 'refreshToken', 'accessToken', 'token',
      'currentPassword', 'newPassword',
      // PHI fields that were previously missed:
      'date_of_birth', 'dob', 'birth_date',
      'nationality', 'national_id', 'passport_number',
      'phone', 'phone_number', 'mobile', 'contact_number',
      'gender', 'sex',
      'ssn', 'social_security',
      'address', 'home_address',
      'emergency_contact_phone', 'emergency_contact_name',
    ];
    for (const field of PHI_FIELDS) {
      if (field in sanitized) {
        sanitized[field] = '[REDACTED]';
      }
    }
    return sanitized;
  }

  private sanitizeParams(params: any): any {
    if (!params || typeof params !== 'object') return undefined;
    return { ...params };
  }

  private sanitizeQuery(query: any): any {
    if (!query || typeof query !== 'object') return undefined;
    // Keep filters (search, status, dates) for accountability; drop tokens if any.
    const out = { ...query };
    delete out.token;
    delete out.accessToken;
    return out;
  }
}
