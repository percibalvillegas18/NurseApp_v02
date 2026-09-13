import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma.service';
import { resolveJwtSecret } from '../../../config/jwt.env';

export interface JwtPayload {
  sub: number; // user id
  username: string;
  role: string;
  primaryRoleId?: number;
  /** Bound login session; tokens issued before session binding omit it. */
  sessionId?: string;
  iat?: number;
  exp?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // Same resolution as the signing side - never a published default.
      secretOrKey: resolveJwtSecret('JWT_SECRET', (k) =>
        configService.get<string>(k),
      ).value,
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.prisma.auth_users.findUnique({
      where: { id: payload.sub },
      include: {
        primary_role: true,
        user_role_assignments: {
          where: {
            status: 'Active',
            OR: [
              { effective_from: null },
              { effective_from: { lte: new Date() } },
            ],
            AND: [
              {
                OR: [
                  { effective_to: null },
                  { effective_to: { gte: new Date() } },
                ],
              },
            ],
          },
          include: { role: true },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (user.status !== 'Active') {
      throw new UnauthorizedException(`User status is ${user.status}`);
    }

    if (user.locked_until && user.locked_until > new Date()) {
      throw new UnauthorizedException('Account is locked');
    }

    // M-19 fix: tokens without a session binding must not bypass session checks.
    if (!payload.sessionId) {
      throw new UnauthorizedException('Token is missing session binding');
    }

    // Reject tokens whose bound session has been logged out or revoked.
    // Mock/preview mode keeps sessions in memory, so this is enforced there too.
    const session = await this.prisma.auth_sessions.findUnique({
      where: { id: payload.sessionId },
      select: { status: true, user_id: true, absolute_timeout_at: true, expires_at: true },
    });
    if (!session || session.user_id !== user.id) {
      throw new UnauthorizedException('Session no longer exists');
    }
    if (session.status !== 'Active') {
      throw new UnauthorizedException(`Session is ${session.status}`);
    }
    // H-6 fix: enforce absolute timeout — sessions cannot live forever even
    // if the client keeps refreshing the access token.
    if (session.absolute_timeout_at && new Date(session.absolute_timeout_at) < new Date()) {
      throw new UnauthorizedException('Session has exceeded its absolute timeout');
    }
    if (session.expires_at && new Date(session.expires_at) < new Date()) {
      throw new UnauthorizedException('Session has expired');
    }

    // NOTE: do not spread `payload` here. It used to end with `...payload`,
    // which re-added the raw `sub` claim *after* `userId`, so `req.user.sub`
    // silently overrode the mapped id and `req.user.id` became undefined -
    // logout then revoked `where: { id: <sessionId>, user_id: undefined }`,
    // i.e. nothing, and the token stayed valid after logout.
    return {
      id: user.id,
      userId: user.id,
      username: user.username,
      email: user.email,
      fullName: user.full_name,
      status: user.status,
      primaryRole: user.primary_role,
      roles: user.user_role_assignments.map((ura) => ura.role),
      roleCode: user.primary_role?.code,
      roleName: user.primary_role?.name,
      // Keep legacy fields for compatibility
      primaryRoleId: user.primary_role_id,
      sessionId: payload.sessionId,
    };
  }
}
