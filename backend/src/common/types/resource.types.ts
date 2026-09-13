/**
 * Discriminator so the same numeric id cannot collide across tables
 * (nurse vs unit vs contract, etc.).
 */
export type ResourceType =
  | 'nurse'
  | 'unit'
  | 'post'
  | 'contract'
  | 'credential'
  | 'user'
  | 'department'
  | 'organization';

/** Runtime list for class-validator `@IsIn(...)`. */
export const RESOURCE_TYPES: readonly ResourceType[] = [
  'nurse',
  'unit',
  'post',
  'contract',
  'credential',
  'user',
  'department',
  'organization',
] as const;

export function isResourceType(value: unknown): value is ResourceType {
  return (
    typeof value === 'string' &&
    (RESOURCE_TYPES as readonly string[]).includes(value)
  );
}
