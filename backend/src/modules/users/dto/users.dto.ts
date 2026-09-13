import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  IsEmail,
  IsArray,
  IsIn,
  MinLength,
  MaxLength,
  Matches,
  ArrayNotEmpty,
} from 'class-validator';

/** User account statuses (VARCHAR(50) in auth.users) */
export const USER_STATUSES = ['Active', 'Suspended'] as const;

/**
 * CreateUserDto - admin creates a login account (menu USER_MANAGEMENT / CREATE).
 * Fields limited to the existing auth.users columns per product decision:
 * username, email, full_name, password, primary role + optional extra roles.
 */
export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  username!: string;

  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  full_name!: string;

  /** Admin-set password — C-8 fix: enforce complexity */
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{}|;:,.<>?])/, {
    message: 'Password must contain at least one uppercase letter, one lowercase letter, one digit, and one special character',
  })
  password!: string;

  @IsInt()
  primary_role_id!: number;

  /** Additional role assignments (multi-role OR logic) */
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  role_ids?: number[];

  @IsOptional()
  @IsIn(USER_STATUSES as unknown as string[])
  status?: string;
}

export class UpdateUserDto {
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  full_name?: string;

  @IsOptional()
  @IsInt()
  primary_role_id?: number;

  /** Full replacement of the additional-role set when provided */
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  role_ids?: number[];

  @IsOptional()
  @IsIn(USER_STATUSES as unknown as string[])
  status?: string;
}

/** Admin-set password reset (menu USER_MANAGEMENT / EDIT) */
export class ResetPasswordDto {
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{}|;:,.<>?])/, {
    message: 'Password must contain at least one uppercase letter, one lowercase letter, one digit, and one special character',
  })
  password!: string;
}
