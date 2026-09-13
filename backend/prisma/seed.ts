/**
 * Prisma Seed - Real Hospital Data
 * Uses bcrypt for password hashing
 * Run: npm run prisma:seed
 */

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting seed...');

  const passwordHash = await bcrypt.hash('Password123!', 12);
  console.log('🔐 Generated password hash for Password123!');

  // Upsert hospital roles
  const roles = [
    {
      code: 'RN',
      name: 'Registered Nurse',
      description: 'Licensed RN providing direct patient care',
      category: 'Clinical',
      department: 'Nursing',
      assignable_by_roles: ['CHARGE_NURSE', 'NURSE_MANAGER', 'SYSTEM_ADMIN'],
      is_exclusive: true,
    },
    {
      code: 'LPN',
      name: 'Licensed Practical Nurse',
      description: 'Licensed LPN providing supporting care under RN supervision',
      category: 'Clinical',
      department: 'Nursing',
      assignable_by_roles: ['CHARGE_NURSE', 'NURSE_MANAGER', 'SYSTEM_ADMIN'],
      is_exclusive: true,
    },
    {
      code: 'CNA',
      name: 'Certified Nursing Assistant',
      description: 'Certified assistant providing hygiene and mobility support',
      category: 'Clinical',
      department: 'Nursing',
      assignable_by_roles: ['CHARGE_NURSE', 'NURSE_MANAGER', 'SYSTEM_ADMIN'],
      is_exclusive: true,
    },
    {
      code: 'CHARGE_NURSE',
      name: 'Charge Nurse',
      description: 'Unit-level clinical leader',
      category: 'Clinical',
      department: 'Nursing',
      assignable_by_roles: ['NURSE_MANAGER', 'SYSTEM_ADMIN'],
      is_exclusive: true,
    },
    {
      code: 'NURSE_MANAGER',
      name: 'Nurse Manager',
      description: 'Department-level manager',
      category: 'Administrative',
      department: 'Nursing',
      assignable_by_roles: ['SYSTEM_ADMIN'],
      is_exclusive: true,
    },
    {
      code: 'SCHEDULER',
      name: 'Workforce Scheduler',
      description: 'Duty roster and leave management',
      category: 'Administrative',
      department: 'Nursing',
      assignable_by_roles: ['NURSE_MANAGER', 'SYSTEM_ADMIN'],
      is_exclusive: true,
    },
    {
      code: 'HR_ADMIN',
      name: 'HR Administrator',
      description: 'HR administration and credential verification',
      category: 'Administrative',
      department: 'Human Resources',
      assignable_by_roles: ['SYSTEM_ADMIN'],
      is_exclusive: true,
    },
    {
      code: 'COMPLIANCE_OFFICER',
      name: 'Compliance Officer',
      description: 'Regulatory compliance and audit',
      category: 'Administrative',
      department: 'Compliance',
      assignable_by_roles: ['SYSTEM_ADMIN'],
      is_exclusive: true,
    },
    {
      code: 'SYSTEM_ADMIN',
      name: 'System Administrator',
      description: 'Full system administration',
      category: 'System',
      department: 'IT',
      assignable_by_roles: ['SYSTEM_ADMIN'],
      is_exclusive: false,
    },
    {
      code: 'READONLY_USER',
      name: 'Read-Only User',
      description: 'View-only access',
      category: 'System',
      department: 'IT',
      assignable_by_roles: ['SYSTEM_ADMIN'],
      is_exclusive: false,
    },
  ];

  for (const role of roles) {
    await prisma.system_hospital_roles.upsert({
      where: { code: role.code },
      update: {
        name: role.name,
        description: role.description,
        category: role.category,
        department: role.department,
        assignable_by_roles: role.assignable_by_roles,
        is_exclusive: role.is_exclusive,
        status: 'Active',
      },
      create: {
        code: role.code,
        name: role.name,
        description: role.description,
        category: role.category,
        department: role.department,
        assignable_by_roles: role.assignable_by_roles,
        is_exclusive: role.is_exclusive,
        status: 'Active',
        created_by: BigInt(1),
        updated_by: BigInt(1),
      },
    });
    console.log(`✅ Role ${role.code} upserted`);
  }

  // Upsert users
  const users = [
    { username: 'admin.system', email: 'admin@hospital.local', full_name: 'System Administrator', role: 'SYSTEM_ADMIN' },
    { username: 'susan.lee', email: 'susan.lee@hospital.local', full_name: 'Susan Lee - Nurse Manager, ICU', role: 'NURSE_MANAGER' },
    { username: 'james.wilson', email: 'james.wilson@hospital.local', full_name: 'James Wilson - Charge Nurse, ICU', role: 'CHARGE_NURSE' },
    { username: 'maria.garcia', email: 'maria.garcia@hospital.local', full_name: 'Maria Garcia - Registered Nurse, ICU', role: 'RN' },
    { username: 'ahmed.hassan', email: 'ahmed.hassan@hospital.local', full_name: 'Ahmed Hassan - Registered Nurse, ICU', role: 'RN' },
    { username: 'jennifer.smith', email: 'jennifer.smith@hospital.local', full_name: 'Jennifer Smith - Licensed Practical Nurse, ICU', role: 'LPN' },
    { username: 'david.kim', email: 'david.kim@hospital.local', full_name: 'David Kim - Nursing Assistant, ICU', role: 'CNA' },
    { username: 'rachel.brown', email: 'rachel.brown@hospital.local', full_name: 'Rachel Brown - Workforce Scheduler', role: 'SCHEDULER' },
    { username: 'patricia.johnson', email: 'patricia.johnson@hospital.local', full_name: 'Patricia Johnson - HR Administrator', role: 'HR_ADMIN' },
    { username: 'michael.wong', email: 'michael.wong@hospital.local', full_name: 'Michael Wong - Compliance Officer', role: 'COMPLIANCE_OFFICER' },
  ];

  for (const u of users) {
    const user = await prisma.auth_users.upsert({
      where: { username: u.username },
      update: {
        email: u.email,
        full_name: u.full_name,
        status: 'Active',
        email_verified: true,
        password_hash: passwordHash,
      },
      create: {
        username: u.username,
        email: u.email,
        password_hash: passwordHash,
        full_name: u.full_name,
        status: 'Active',
        email_verified: true,
        created_by: BigInt(1),
        updated_by: BigInt(1),
      },
    });

    // Get role id
    const role = await prisma.system_hospital_roles.findUnique({ where: { code: u.role } });
    if (role) {
      // Update primary_role_id
      await prisma.auth_users.update({
        where: { id: user.id },
        data: { primary_role_id: role.id },
      });

      // Upsert assignment
      await prisma.auth_user_role_assignments.upsert({
        where: { user_id_role_id: { user_id: user.id, role_id: role.id } },
        update: { status: 'Active', reason: `${role.name} - Auto seeded` },
        create: {
          user_id: user.id,
          role_id: role.id,
          assigned_by: BigInt(1),
          reason: `${role.name} - Auto seeded`,
          status: 'Active',
        },
      });
      console.log(`✅ User ${u.username} with role ${u.role} upserted`);
    }
  }

  console.log('🎉 Seed completed!');
  console.log('📝 Default password for all users: Password123!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
