import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsIn,
} from 'class-validator';
import {
  RESOURCE_TYPES,
  type ResourceType,
} from '../../../common/types';

export class EvaluateAccessDto {
  @IsString()
  @IsNotEmpty()
  menuCode!: string;

  @IsString()
  @IsNotEmpty()
  permissionCode!: string;

  @IsNumber()
  @IsOptional()
  resourceId?: number;

  @IsString()
  @IsOptional()
  @IsIn([...RESOURCE_TYPES])
  resourceType?: ResourceType;
}

export class PreviewAccessChangeDto {
  @IsString()
  @IsNotEmpty()
  changeType!: string; // PERMISSION_GRANT, PERMISSION_REVOKE, MENU_ACCESS_GRANT, etc

  @IsNumber()
  @IsNotEmpty()
  menuId!: number;

  @IsNumber()
  @IsOptional()
  permissionId?: number;

  @IsOptional()
  proposedAllowed?: boolean;
}
