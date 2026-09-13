/** Staff positions describe employment, independently of authorization roles. */
export const STAFF_POSITIONS = [
  { code: 'HN', name: 'Head Nurse' },
  { code: 'AHN', name: 'Asst. Head Nurse' },
  { code: 'CI', name: 'Clinical Instructor' },
  { code: 'SN', name: 'Staff Nurse' },
  { code: 'PCT', name: 'Patient Care Tech' },
  { code: 'TEC', name: 'ECG Technician' },
  { code: 'CN', name: 'Charge Nurse' },
  { code: 'HCA', name: 'Health Care Asst.' },
  { code: 'MW', name: 'Midwife' },
];

export interface CredentialField {
  key: string;
  label: string;
  type: 'text' | 'date' | 'number' | 'select' | 'unit';
  options?: string[];
}
export interface CredentialTemplate {
  code: string;
  name: string;
  category: string;
  credentialType: string;
  description: string;
  numberLabel?: string;
  authorityLabel?: string;
  issuedLabel?: string;
  expiryLabel?: string;
  fields: CredentialField[];
}
const text = (key: string, label: string): CredentialField => ({ key, label, type: 'text' });
const date = (key: string, label: string): CredentialField => ({ key, label, type: 'date' });
const select = (key: string, label: string, options: string[]): CredentialField => ({ key, label, type: 'select', options });
const competencyFields: CredentialField[] = [
  text('evaluatorName', 'Evaluator Name'),
  select('assessmentStatus', 'Pass/Fail Status', ['Pass', 'Fail', 'Pending']),
];

export const CREDENTIAL_TEMPLATES: CredentialTemplate[] = [
  { code: 'PASSPORT', name: 'Passport', category: 'Identity & Legal', credentialType: 'Identity',
    description: 'Government-issued document verifying international identity and nationality.',
    numberLabel: 'Document Number', issuedLabel: 'Issue Date', expiryLabel: 'Expiry Date',
    fields: [text('issuingCountry', 'Issuing Country')] },
  { code: 'IQAMA', name: 'Resident ID (Iqama)', category: 'Identity & Legal', credentialType: 'Identity',
    description: 'Saudi residency permit proving legal permission to live and work.',
    numberLabel: 'Iqama Number', authorityLabel: 'Sponsor/Employer Name', issuedLabel: 'Issue Date', expiryLabel: 'Expiry Date (Gregorian)',
    fields: [text('expiryDateHijri', 'Expiry Date (Hijri, YYYY-MM-DD)'), text('jobTitle', 'Job Title')] },
  { code: 'HOSPITAL_ID', name: 'Hospital ID', category: 'Identity & Legal', credentialType: 'Identity',
    description: 'Internal facility badge verifying employee role, department, and access.',
    numberLabel: 'Employee ID Number', issuedLabel: 'Issue Date', expiryLabel: 'Expiry Date',
    fields: [text('departmentCostCenter', 'Department/Cost Center'), text('accessLevel', 'Access Level')] },
  { code: 'PROFESSIONAL_LICENSE', name: 'Professional License', category: 'Licensure', credentialType: 'License',
    description: 'Nursing/medical license issued by the home country or previous country.',
    numberLabel: 'License Number', authorityLabel: 'Issuing Board', issuedLabel: 'Issue Date', expiryLabel: 'Expiry Date',
    fields: [text('issuingCountry', 'Issuing Country'), select('psvStatus', 'PSV Status (DataFlow)', ['Not Started', 'In Progress', 'Verified', 'Discrepancy', 'Unable to Verify'])] },
  { code: 'SCFHS', name: 'Saudi Council License', category: 'Licensure', credentialType: 'License',
    description: 'National practice license issued by the Saudi Commission for Health Specialties.',
    numberLabel: 'SCFHS Registration Number', issuedLabel: 'Issue Date', expiryLabel: 'Expiry Date',
    fields: [text('professionalClassification', 'Professional Classification')] },
  { code: 'EMPLOYMENT_CONTRACT', name: 'Employment Contract', category: 'Liability & Clearance', credentialType: 'Contract',
    description: 'Legal agreement between healthcare worker and hiring entity (MOH/SOP/Agency).',
    numberLabel: 'Contract ID', authorityLabel: 'Contracting Agency', issuedLabel: 'Start Date', expiryLabel: 'Expiry Date',
    fields: [date('probationEndDate', 'Probation End Date')] },
  { code: 'MALPRACTICE', name: 'Medical Malpractice', category: 'Liability & Clearance', credentialType: 'Insurance',
    description: 'Professional liability coverage protecting against claims of medical negligence.',
    numberLabel: 'Policy Number', authorityLabel: 'Insurance Provider', issuedLabel: 'Effective Date', expiryLabel: 'Expiry Date',
    fields: [{ key: 'coverageAmount', label: 'Coverage Amount', type: 'number' }, text('coverageCurrency', 'Coverage Currency')] },
  { code: 'STAFF_CLEARANCE', name: 'Staff Clearance', category: 'Liability & Clearance', credentialType: 'Clearance',
    description: 'Background checks, health screenings, and onboarding clearance.',
    numberLabel: 'Clearance Form ID', issuedLabel: 'Approval Date',
    fields: [select('medicalFitnessStatus', 'Medical Fitness Status', ['Pending', 'Fit', 'Fit with Restrictions', 'Unfit']), select('backgroundCheckStatus', 'Background Check Status', ['Pending', 'Passed', 'Failed'])] },
  { code: 'CORE_COMPETENCY', name: 'Core Generic Competency', category: 'Clinical Competency', credentialType: 'Competency',
    description: 'Assessment of foundational clinical skills required of all staff.',
    issuedLabel: 'Assessment Date', expiryLabel: 'Next Reassessment Due Date', fields: competencyFields },
  { code: 'UNIT_COMPETENCY', name: 'Unit Specific Competency', category: 'Clinical Competency', credentialType: 'Competency',
    description: 'Specialized skills checklist tailored to the assigned department.',
    issuedLabel: 'Assessment Date', expiryLabel: 'Next Reassessment Date',
    fields: [{ key: 'assignedUnitId', label: 'Assigned Unit', type: 'unit' }, ...competencyFields] },
  { code: 'CONSCIOUS_SEDATION', name: 'Conscious Sedation', category: 'Clinical Competency', credentialType: 'Certification',
    description: 'Certification for safely administering and monitoring moderate sedation.',
    numberLabel: 'Certificate Number', authorityLabel: 'Certifying Department', issuedLabel: 'Issue Date', expiryLabel: 'Expiry Date',
    fields: [{ key: 'supervisedCasesCount', label: 'Supervised Cases Count', type: 'number' }] },
  ...[
    ['BLS', 'CPR, AED use, and basic life-saving skills.'],
    ['ACLS', 'Management of severe adult cardiovascular emergencies.'],
    ['PALS', 'Recognition and intervention in pediatric emergencies.'],
    ['NRP', 'Assessment, resuscitation, and stabilization of newborns.'],
    ['BICSL', 'Basic infection control skills.'],
  ].map(([code, description]): CredentialTemplate => ({
    code, name: code, description, category: 'Life Support', credentialType: 'Certification',
    numberLabel: 'Certificate Number', authorityLabel: code === 'BICSL' ? 'Training Facility' : 'Training Provider',
    issuedLabel: 'Issue Date', expiryLabel: 'Expiry Date', fields: [],
  })),
];
