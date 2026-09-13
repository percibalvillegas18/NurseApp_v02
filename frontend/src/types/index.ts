export interface User {
  id: number;
  username: string;
  email: string;
  fullName: string;
  role: string;
  roleName: string;
  status: string;
  primaryRole?: {
    code: string;
    name: string;
    category: string;
  };
  roles?: Array<{
    code: string;
    name: string;
    category: string;
  }>;
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  sessionId: string;
}

export interface LoginResponse {
  user: User;
  tokens: Tokens;
}

export interface AccessDecision {
  decision: 'ALLOW' | 'DENY';
  reason: string;
  menuAccessible: boolean;
  permissionGranted: boolean;
  dataScopeValid: boolean;
  cacheTtl: number;
  evaluatedAt: string;
  userRole: string | null;
  userRoles: string[];
}

export interface EvaluateAccessRequest {
  menuCode: string;
  permissionCode: string;
  resourceId?: number;
}

export interface EvaluateAccessResponse {
  userId: number;
  menuCode: string;
  permissionCode: string;
  resourceId?: number;
  decision: {
    allowed: boolean;
    menuAccessible: boolean;
    permissionGranted: boolean;
    dataScopeValid: boolean;
    reason: string;
    evaluatedAt: string;
    cacheTtl: number;
    roles: string[];
  };
}

export interface Menu {
  id: number;
  code: string;
  name: string;
  description?: string;
  parent_menu_id: number | null;
  display_order: number;
  route: string;
  icon?: string;
  is_functional: boolean;
  status: string;
  children?: Menu[];
  visible?: boolean;
  enabled?: boolean;
  permissions?: Record<string, boolean>;
}

export interface Permission {
  id: number;
  code: string;
  name: string;
  description: string;
  category: 'Standard' | 'Administrative' | 'Workflow' | 'Sensitive';
  risk_level: 'Low' | 'Medium' | 'High' | 'Critical';
  status: string;
}

export interface RoleMenuAccess {
  id: number;
  role_code: string;
  menu_id: number;
  menu?: Menu;
  visible: boolean;
  enabled: boolean;
  assignment_source: string;
  override_flag: boolean;
  status: string;
}

export interface RolePermission {
  id: number;
  role_code: string;
  menu_id: number;
  permission_id: number;
  menu?: Menu;
  permission?: Permission;
  allowed: boolean;
  source: string;
  override_flag: boolean;
  status: string;
}

export interface HospitalRole {
  id: number;
  code: string;
  name: string;
  description: string;
  category: 'Clinical' | 'Administrative' | 'System' | 'Support';
  department?: string;
  status: string;
}

export interface DataScope {
  id: number;
  user_id: number;
  scope_type: 'Hospital' | 'Department' | 'NursingUnit' | 'Post' | 'Shift' | 'Assigned' | 'All';
  organization_id?: number;
  department_id?: number;
  nursing_unit_id?: number;
  organization?: { name: string };
  department?: { name: string };
  nursing_unit?: { name: string };
  status: string;
}

export interface AuditLog {
  id: number;
  user_id?: number;
  username?: string;
  action: string;
  entity_type: string;
  entity_id?: number;
  description?: string;
  changes?: any;
  status: string;
  created_at: string;
}

export interface ApiResponse<T> {
  success: boolean;
  statusCode?: number;
  data: T;
  message?: string;
  timestamp: string;
  requestId?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

// ============================================================================
// Nursing domain (V3_0) - mirrors Nest /nursing API response shapes
// ============================================================================

export type CredentialSummary = 'Valid' | 'ExpiringSoon' | 'Expired' | 'None';
export type EmploymentType = 'FullTime' | 'PartTime' | 'PRN' | 'Contract';
export type NurseStatus = 'Active' | 'OnLeave' | 'Suspended' | 'Terminated';
export type CredentialStatus =
  | 'PendingVerification'
  | 'Valid'
  | 'ExpiringSoon'
  | 'Expired'
  | 'Suspended'
  | 'Revoked';
export type RosterStatus =
  | 'Scheduled'
  | 'Confirmed'
  | 'Completed'
  | 'Cancelled'
  | 'Swapped'
  | 'NoShow';

export interface Nurse {
  id: number;
  /** Manually entered, unique per nurse (distinct from the auto-generated employeeNumber) */
  jobNo: string;
  employeeNumber: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  /** Computed: First + Middle + Last */
  fullName: string;
  gender: 'Male' | 'Female' | null;
  dateOfBirth: string | null;
  nationality: string | null;
  /** Sourced from the linked login account (auth.users.email); read-only */
  email: string | null;
  /** Contact No. (mobile) */
  phone: string | null;
  hireDate: string | null;
  employmentType: EmploymentType;
  status: NurseStatus;
  userId: number | null;
  username: string | null;
  primaryRole: { id: number; code: string; name: string } | null;
  positionCode: string | null;
  department: { id: number; name: string } | null;
  homeUnit: { id: number; code: string; name: string; departmentId: number } | null;
  credentialSummary: CredentialSummary;
  credentialCounts: { total: number; expired: number; expiringSoon: number };
  createdAt: string;
  updatedAt: string;
}

export interface NurseCredential {
  id: number;
  nurseId: number;
  templateCode: string | null;
  category: string | null;
  trackingData: Record<string, string | number>;
  credentialType: string;
  name: string;
  issuingAuthority: string | null;
  credentialNumber: string | null;
  issuedDate: string | null;
  expiryDate: string | null;
  daysUntilExpiry: number | null;
  status: CredentialStatus;
  verifiedBy: number | null;
  verifiedAt: string | null;
  nurse?: { id: number; employeeNumber: string; fullName: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface RosterAssignment {
  id: number;
  nurseId: number;
  nurseName?: string;
  employeeNumber?: string;
  unitId: number;
  unitCode?: string;
  unitName?: string;
  shiftId: number;
  shiftCode?: string;
  shiftName?: string;
  postId: number | null;
  postCode?: string;
  postName?: string;
  assignmentDate: string; // YYYY-MM-DD
  status: RosterStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NurseDetail extends Nurse {
  credentials: NurseCredential[];
  upcomingAssignments: RosterAssignment[];
}

export interface CredentialTemplate {
  code: string; name: string; category: string; credentialType: string; description: string;
  numberLabel?: string; authorityLabel?: string; issuedLabel?: string; expiryLabel?: string;
  fields: Array<{ key: string; label: string; type: 'text' | 'date' | 'number' | 'select' | 'unit'; options?: string[] }>;
}
export interface NursingLookups {
  positions: Array<{ code: string; name: string }>;
  departments: Array<{ id: number; code: string; name: string }>;
  credentialTemplates: CredentialTemplate[];
  roles: Array<{ id: number; code: string; name: string; category: string }>;
  units: Array<{ id: number; code: string; name: string; department_id: number }>;
  shifts: Array<{ id: number; code: string; name: string; start_time: string; end_time: string }>;
  posts: Array<{ id: number; code: string; name: string; nursing_unit_id: number }>;
  /** Country display names for the Nationality selector */
  countries: string[];
}

export interface NurseListParams {
  search?: string;
  status?: string;
  unitId?: number;
  page?: number;
  limit?: number;
}

export interface RosterListParams {
  from?: string;
  to?: string;
  unitId?: number;
  nurseId?: number;
  status?: string;
}

// ---------------------------------------------------------------------------
// User Management (Administration -> User Management)
// ---------------------------------------------------------------------------
export interface ManagedRole {
  id: number;
  code: string;
  name: string;
  category: string | null;
}

export interface ManagedUser {
  id: number;
  username: string;
  email: string;
  fullName: string;
  status: 'Active' | 'Suspended';
  emailVerified: boolean;
  lastLoginAt: string | null;
  lastPasswordChangeAt: string | null;
  failedLoginAttempts: number;
  lockedUntil: string | null;
  primaryRole: ManagedRole | null;
  roles: ManagedRole[];
  createdAt: string;
  updatedAt: string;
}

export interface UserListParams {
  search?: string;
  status?: string;
  page?: number;
  limit?: number;
}

export interface UserLookups {
  roles: ManagedRole[];
  statuses: string[];
}

export interface LoginHistoryItem {
  id: number;
  action: string;
  status: string;
  description: string | null;
  errorMessage?: string | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface UserSession {
  id: string;
  ipAddress: string;
  userAgent: string | null;
  loginAt: string;
  lastActivityAt: string;
  expiresAt: string;
  status: string;
  revokedAt: string | null;
}

export interface CreateUserPayload {
  username: string;
  email: string;
  full_name: string;
  password: string;
  primary_role_id: number;
  role_ids?: number[];
  status?: string;
}
