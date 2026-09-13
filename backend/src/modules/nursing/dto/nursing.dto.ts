import { STAFF_POSITIONS, CREDENTIAL_TEMPLATES } from '../staff-catalog';
import {
  IsObject,
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  IsDateString,
  IsIn,
  MaxLength,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * L-3 fix: Limit tracking_data to 20 keys and 4KB total serialized size
 */
@ValidatorConstraint({ name: 'trackingDataSize', async: false })
class TrackingDataSizeConstraint implements ValidatorConstraintInterface {
  validate(value: any, _args: ValidationArguments): boolean {
    if (!value || typeof value !== 'object') return true;
    const keys = Object.keys(value);
    if (keys.length > 20) return false;
    try {
      return JSON.stringify(value).length <= 4096;
    } catch {
      return false;
    }
  }
  defaultMessage(_args: ValidationArguments): string {
    return 'tracking_data must have at most 20 keys and be under 4KB when serialized';
  }
}

// ---------------------------------------------------------------------------
// Nurses
// ---------------------------------------------------------------------------

export const EMPLOYMENT_TYPES = ['FullTime', 'PartTime', 'PRN', 'Contract'] as const;
export const NURSE_STATUSES = ['Active', 'OnLeave', 'Suspended', 'Terminated'] as const;
export const CREDENTIAL_TYPES = ['License', 'Certification', 'Identity', 'Contract', 'Insurance', 'Clearance', 'Competency'] as const;
export const CREDENTIAL_STATUSES = [
  'PendingVerification',
  'Valid',
  'ExpiringSoon',
  'Expired',
  'Suspended',
  'Revoked',
] as const;
export const ROSTER_STATUSES = [
  'Scheduled',
  'Confirmed',
  'Completed',
  'Cancelled',
  'Swapped',
  'NoShow',
] as const;

export const GENDERS = ['Male', 'Female'] as const;

export class CreateNurseDto {
  @IsOptional()
  @IsIn(STAFF_POSITIONS.map(p => p.code))
  position_code?: string;

  /** Optional - auto-generated (EMP-YYYY-NNNNN) when omitted */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  employee_number?: string;

  /**
   * Job No. - manually entered, required, unique per nurse.
   * Distinct from employee_number, which this form auto-generates.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  job_no: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  user_id?: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  first_name: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  middle_name?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  last_name: string;

  @IsOptional()
  @IsIn(GENDERS as unknown as string[])
  gender?: string;

  @IsOptional()
  @IsDateString()
  date_of_birth?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nationality?: string;

  // NOTE: email intentionally absent - sourced from the linked login
  // account (auth.users.email), not entered on the nurse record.

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  /** Optional - belongs to the (later) employment group */
  @IsOptional()
  @IsDateString()
  hire_date?: string;

  @IsOptional()
  @IsIn(EMPLOYMENT_TYPES as unknown as string[])
  employment_type?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  primary_role_id?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  home_unit_id?: number;
}

export class UpdateNurseDto {
  @IsOptional()
  @IsIn(STAFF_POSITIONS.map(p => p.code))
  position_code?: string;

  /** Job No. - optional on update, but never blank when provided. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  job_no?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  employee_number?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  user_id?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  first_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  middle_name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  last_name?: string;

  @IsOptional()
  @IsIn(GENDERS as unknown as string[])
  gender?: string;

  @IsOptional()
  @IsDateString()
  date_of_birth?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nationality?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @IsDateString()
  hire_date?: string;

  @IsOptional()
  @IsIn(EMPLOYMENT_TYPES as unknown as string[])
  employment_type?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  primary_role_id?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  home_unit_id?: number;

  @IsOptional()
  @IsIn(NURSE_STATUSES as unknown as string[])
  status?: string;
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export class CreateCredentialDto {
  @IsOptional()
  @IsIn(CREDENTIAL_TEMPLATES.map(t => t.code))
  template_code?: string;

  @IsOptional()
  @IsObject()
  @Validate(TrackingDataSizeConstraint)
  tracking_data?: Record<string, string | number>;

  @IsInt()
  @Type(() => Number)
  nurse_id: number;

  @IsIn(CREDENTIAL_TYPES as unknown as string[])
  credential_type: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  issuing_authority?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  credential_number?: string;

  @IsOptional()
  @IsDateString()
  issued_date?: string;

  @IsOptional()
  @IsDateString()
  expiry_date?: string;
}

export class UpdateCredentialDto {
  @IsOptional()
  @IsIn(CREDENTIAL_TEMPLATES.map(t => t.code))
  template_code?: string;

  @IsOptional()
  @IsObject()
  @Validate(TrackingDataSizeConstraint)
  tracking_data?: Record<string, string | number>;

  @IsOptional()
  @IsIn(CREDENTIAL_TYPES as unknown as string[])
  credential_type?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  issuing_authority?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  credential_number?: string;

  @IsOptional()
  @IsDateString()
  issued_date?: string;

  @IsOptional()
  @IsDateString()
  expiry_date?: string;

}

export class VerifyCredentialDto {
  @IsOptional()
  @IsIn(['Valid', 'Suspended', 'Revoked'])
  status?: string = 'Valid';
}

// ---------------------------------------------------------------------------
// Roster assignments
// ---------------------------------------------------------------------------

export class CreateRosterAssignmentDto {
  @IsInt()
  @Type(() => Number)
  nurse_id: number;

  @IsInt()
  @Type(() => Number)
  nursing_unit_id: number;

  @IsInt()
  @Type(() => Number)
  shift_id: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  post_id?: number;

  @IsDateString()
  assignment_date: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class UpdateRosterAssignmentDto {
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  nurse_id?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  nursing_unit_id?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  shift_id?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  post_id?: number;

  @IsOptional()
  @IsDateString()
  assignment_date?: string;

  @IsOptional()
  @IsIn(ROSTER_STATUSES as unknown as string[])
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
