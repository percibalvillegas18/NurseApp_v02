import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { resolveJwtSecret } from '../../config/jwt.env';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { LoginThrottleService } from './login-throttle.service';
import { AuditModule } from '../audit/audit.module';
import { RbacModule } from '../rbac/rbac.module';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        // No hardcoded fallback: an unset (or too-short) JWT_SECRET now fails
        // the boot instead of silently signing tokens with a published
        // development key that anyone could use to forge them.
        const { value, ephemeral } = resolveJwtSecret('JWT_SECRET', (k) =>
          configService.get<string>(k),
        );
        if (ephemeral) {
          new Logger('AuthModule').warn(
            'JWT_SECRET is not configured - generated a random ephemeral signing key. ' +
              'Existing tokens will not survive a restart. Set JWT_SECRET for any real deployment.',
          );
        }
        return {
          secret: value,
          signOptions: {
            expiresIn: configService.get('JWT_EXPIRY', '3600s'),
          },
        };
      },
    }),
    AuditModule,
    // AuthController's /auth/attempts* endpoints are RBAC-protected, and
    // RbacGuard needs EffectiveAccessService. RbacModule does not import
    // AuthModule, so this is not circular.
    RbacModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, LoginThrottleService],
  exports: [AuthService, JwtStrategy, PassportModule, LoginThrottleService],
})
export class AuthModule {}
