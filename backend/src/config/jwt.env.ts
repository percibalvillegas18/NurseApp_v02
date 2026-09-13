/**
 * JWT signing-key resolution.
 *
 * Both the signing side (JwtModule) and the verifying side (JwtStrategy) used
 * to fall back to the same literal development string when JWT_SECRET was
 * unset. That string is committed in .env.example and docker-compose.yml, so a
 * missing environment variable produced a *working* app whose tokens anyone
 * could forge.
 *
 * Now:
 *   - a provided secret is used as-is (and must be long enough),
 *   - otherwise, if the instance is an explicitly-flagged demo/preview
 *     (ALLOW_MOCK_DATA=true) a random ephemeral key is generated so tokens
 *     still cannot be forged - they just do not survive a restart,
 *   - otherwise the process refuses to start.
 */

import { randomBytes } from 'crypto';

const MIN_SECRET_LENGTH = 32;

export function isMockDataAllowed(): boolean {
  return String(process.env.ALLOW_MOCK_DATA || '').toLowerCase() === 'true';
}

/** Generated once per process (per env var) for demo/preview instances only. */
const ephemeralSecrets = new Map<string, string>();

function generateEphemeralSecret(envVar: string): string {
  let secret = ephemeralSecrets.get(envVar);
  if (!secret) {
    // 48 url-safe random characters, generated per process.
    secret = randomBytes(36).toString('base64url');
    ephemeralSecrets.set(envVar, secret);
  }
  return secret;
}

/**
 * Memoised resolution.
 *
 * JwtModule (signing), JwtStrategy (verifying) and AuthService (per-call sign
 * options) each resolve the secret independently. Without memoisation an
 * ephemeral demo key would be generated three times and nothing would verify.
 */
const resolved = new Map<string, ResolvedSecret>();

export interface ResolvedSecret {
  value: string;
  /** true when the key was generated for this process rather than configured. */
  ephemeral: boolean;
}

export function resolveJwtSecret(
  envVar: 'JWT_SECRET' | 'JWT_REFRESH_SECRET',
  configGet?: (key: string) => string | undefined,
): ResolvedSecret {
  const cached = resolved.get(envVar);
  if (cached) return cached;

  const result = computeJwtSecret(envVar, configGet);
  resolved.set(envVar, result);
  return result;
}

function computeJwtSecret(
  envVar: 'JWT_SECRET' | 'JWT_REFRESH_SECRET',
  configGet?: (key: string) => string | undefined,
): ResolvedSecret {
  const fromConfig = configGet ? configGet(envVar) : undefined;
  const provided = (fromConfig ?? process.env[envVar] ?? '').trim();

  if (provided) {
    if (provided.length < MIN_SECRET_LENGTH) {
      throw new Error(
        `${envVar} must be at least ${MIN_SECRET_LENGTH} characters (got ${provided.length}). ` +
          `Generate one with: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`,
      );
    }
    return { value: provided, ephemeral: false };
  }

  if (isMockDataAllowed()) {
    return { value: generateEphemeralSecret(envVar), ephemeral: true };
  }

  throw new Error(
    `${envVar} is required and has no default. Refusing to start with a well-known ` +
      `development key - anyone could forge tokens for this service. ` +
      `Set ${envVar} to at least ${MIN_SECRET_LENGTH} random characters, e.g. ` +
      `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))". ` +
      `(Demo/preview instances may set ALLOW_MOCK_DATA=true to use a random ephemeral key.)`,
  );
}
