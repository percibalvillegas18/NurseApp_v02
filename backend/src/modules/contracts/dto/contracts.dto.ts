import {
  IsString,
  IsOptional,
  IsInt,
  IsDateString,
  IsIn,
  IsNotEmpty,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const;

export const CONTRACT_TYPES = ['Permanent', 'FixedTerm', 'Temporary', 'Locum', 'Other'] as const;
export const CONTRACT_STATUSES = [
  'Draft',
  'PendingApproval',
  'Active',
  'Suspended',
  'Expired',
  'Terminated',
  'Superseded',
] as const;

export class CreateContractDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  contractNumber?: string;

  @IsInt()
  @Type(() => Number)
  nurseId: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  positionId?: number;

  @IsInt()
  @Type(() => Number)
  agencyId: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  nursingUnitId?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  departmentId?: number;

  @IsIn(CONTRACT_TYPES as unknown as string[])
  contractType: string;

  @IsDateString()
  startDate: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsDateString()
  probationEndDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateContractDto {
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  positionId?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  agencyId?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  nursingUnitId?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  departmentId?: number;

  @IsOptional()
  @IsIn(CONTRACT_TYPES as unknown as string[])
  contractType?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string | null;

  @IsOptional()
  @IsDateString()
  probationEndDate?: string | null;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class TerminateContractDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  reason: string;
}

export class RenewContractDto {
  @IsDateString()
  startDate: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsIn(CONTRACT_TYPES as unknown as string[])
  contractType?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  agencyId?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  positionId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class AddContractDocumentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  docType: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  fileName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  storageRef?: string;

  @IsOptional()
  @IsString()
  @IsIn(ALLOWED_MIME_TYPES as unknown as string[])
  mimeType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
