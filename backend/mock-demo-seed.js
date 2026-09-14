/**
 * TEMP demo dataset — loaded by mock-server.js AFTER mock-workforce-routes.
 *
 * Seeds (all flagged `isDemo: true`, all IDs/names prefixed DEMO):
 *   • 10 demo login users, one per role (demo.sysadmin … demo.viewer)
 *   • 9 demo nurses, one per staff position (HN … MW), 4 linked to demo logins
 *   • ~48 demo credentials per nurse: PASSPORT + IQAMA (non-Saudi) +
 *     HOSPITAL_ID + SCFHS + BLS + extras (incl. expiring/expired/pending variety)
 *   • 9 Active demo contracts (MOH/SOP/HCC/HHC mix) so demo nurses roster cleanly
 *   • 9 demo roster assignments across ICU_A / ICU_B / ER_TRIAGE
 *
 * Management endpoints (open dev endpoints, like the other /mock/* helpers):
 *   GET    /api/v1/mock/demo       — seeded? + counts
 *   POST   /api/v1/mock/demo/seed  — seed now (idempotent, per-record skip)
 *   DELETE /api/v1/mock/demo       — remove EVERY demo row, including roster/leave
 *                                    rows and tokens created against demo nurses
 *
 * Arrays are spliced in place (never reassigned) so every module holding a
 * reference stays correct. Preview-only; never deploy.
 */
module.exports = function registerDemoSeed(app, deps) {
  const {
    mockUsers, MOCK_USER_ROLES, mockNurses, mockCredentials,
    mockNurseRoles, mockUnits, mockRoster, mockLeaveRequests,
    mockCredentialDocuments, issuedAccessTokens, issuedRefreshTokens, loginAttempts,
  } = deps;

  const day = 86400000;
  const isoDay = (offset) => new Date(Date.now() + offset * day).toISOString().slice(0, 10);
  const nowIso = () => new Date().toISOString();
  const nextId = (arr) => arr.reduce((m, r) => Math.max(m, r.id || 0), 0) + 1;
  const pad2 = (i) => String(i + 1).padStart(2, '0');
  const pad4 = (i) => String(i + 1).padStart(4, '0');

  const PASSPORT_ISSUER = {
    Saudi: 'MOI Saudi Arabia',
    Filipino: 'DFA Philippines',
    Indian: 'MEA India',
    Egyptian: 'MOFA Egypt',
    Nigerian: 'NIS Nigeria',
  };

  // ------------------------------------------------------------------ users
  const DEMO_PEOPLE = [
    { username: 'demo.sysadmin', fullName: 'Demo System Admin (TEMP)', roleCode: 'SYSTEM_ADMIN' },
    { username: 'demo.manager', fullName: 'Demo Nurse Manager (TEMP)', roleCode: 'NURSE_MANAGER' },
    { username: 'demo.charge', fullName: 'Demo Charge Nurse (TEMP)', roleCode: 'CHARGE_NURSE' },
    { username: 'demo.rn', fullName: 'Demo Registered Nurse (TEMP)', roleCode: 'RN' },
    { username: 'demo.lpn', fullName: 'Demo Practical Nurse (TEMP)', roleCode: 'LPN' },
    { username: 'demo.cna', fullName: 'Demo Nursing Assistant (TEMP)', roleCode: 'CNA' },
    { username: 'demo.scheduler', fullName: 'Demo Scheduler (TEMP)', roleCode: 'SCHEDULER' },
    { username: 'demo.hr', fullName: 'Demo HR Admin (TEMP)', roleCode: 'HR_ADMIN' },
    { username: 'demo.compliance', fullName: 'Demo Compliance Officer (TEMP)', roleCode: 'COMPLIANCE_OFFICER' },
    { username: 'demo.viewer', fullName: 'Demo Read-Only User (TEMP)', roleCode: 'READONLY_USER' },
  ];

  function seedUsers() {
    const created = [];
    for (const p of DEMO_PEOPLE) {
      if (mockUsers[p.username]) continue;
      const role = MOCK_USER_ROLES.find((r) => r.code === p.roleCode);
      if (!role) continue;
      mockUsers[p.username] = {
        id: nextId(Object.values(mockUsers)),
        username: p.username,
        email: `${p.username}@hospital.local`,
        fullName: p.fullName,
        full_name: p.fullName,
        role: role.code,
        roleName: role.name,
        status: 'Active',
        primary_role_id: role.id,
        primary_role: { code: role.code, name: role.name, category: role.category },
        roles: [{ code: role.code, name: role.name, category: role.category }],
        isDemo: true,
        createdAt: nowIso(),
      };
      created.push(p.username);
    }
    return created;
  }

  // ----------------------------------------------------------------- nurses
  // One per staff position; Saudi-hospital nationality mix; 4 linked to logins.
  const DEMO_NURSES = [
    { positionCode: 'HN', positionName: 'Head Nurse', firstName: 'Fatimah', middleName: null, lastName: 'Al-Harbi', gender: 'Female', dateOfBirth: '1985-06-20', nationality: 'Saudi', phone: '+966-55-100-0001', hireDate: '2015-02-01', employmentType: 'FullTime', primaryRoleId: 1, homeUnitId: 1, linkUser: null },
    { positionCode: 'AHN', positionName: 'Asst. Head Nurse', firstName: 'Priya', middleName: null, lastName: 'Nair', gender: 'Female', dateOfBirth: '1990-09-11', nationality: 'Indian', phone: '+966-55-100-0002', hireDate: '2017-05-10', employmentType: 'FullTime', primaryRoleId: 1, homeUnitId: 1, linkUser: null },
    { positionCode: 'CI', positionName: 'Clinical Instructor', firstName: 'Mona', middleName: 'Adel', lastName: 'El-Sayed', gender: 'Female', dateOfBirth: '1988-01-25', nationality: 'Egyptian', phone: '+966-55-100-0003', hireDate: '2018-08-01', employmentType: 'FullTime', primaryRoleId: 1, homeUnitId: 2, linkUser: null },
    { positionCode: 'SN', positionName: 'Staff Nurse', firstName: 'Grace', middleName: 'M', lastName: 'Santos', gender: 'Female', dateOfBirth: '1992-04-30', nationality: 'Filipino', phone: '+966-55-100-0004', hireDate: '2019-11-01', employmentType: 'FullTime', primaryRoleId: 1, homeUnitId: 1, linkUser: 'demo.rn' },
    { positionCode: 'PCT', positionName: 'Patient Care Tech', firstName: 'Ravi', middleName: null, lastName: 'Kumar', gender: 'Male', dateOfBirth: '1994-07-07', nationality: 'Indian', phone: '+966-55-100-0005', hireDate: '2021-03-15', employmentType: 'FullTime', primaryRoleId: 3, homeUnitId: 2, linkUser: 'demo.cna' },
    { positionCode: 'TEC', positionName: 'ECG Technician', firstName: 'Omar', middleName: null, lastName: 'Farouk', gender: 'Male', dateOfBirth: '1991-12-02', nationality: 'Egyptian', phone: '+966-55-100-0006', hireDate: '2020-06-01', employmentType: 'FullTime', primaryRoleId: 3, homeUnitId: 3, linkUser: null },
    { positionCode: 'CN', positionName: 'Charge Nurse', firstName: 'Linda', middleName: 'R', lastName: 'Cruz', gender: 'Female', dateOfBirth: '1987-03-14', nationality: 'Filipino', phone: '+966-55-100-0007', hireDate: '2016-09-01', employmentType: 'FullTime', primaryRoleId: 4, homeUnitId: 1, linkUser: 'demo.charge' },
    { positionCode: 'HCA', positionName: 'Health Care Asst.', firstName: 'Aisha', middleName: null, lastName: 'Bello', gender: 'Female', dateOfBirth: '1995-10-19', nationality: 'Nigerian', phone: '+966-55-100-0008', hireDate: '2022-02-01', employmentType: 'PartTime', primaryRoleId: 2, homeUnitId: 2, linkUser: 'demo.lpn' },
    { positionCode: 'MW', positionName: 'Midwife', firstName: 'Zainab', middleName: null, lastName: 'Al-Ansari', gender: 'Female', dateOfBirth: '1989-05-05', nationality: 'Saudi', phone: '+966-55-100-0009', hireDate: '2017-12-01', employmentType: 'FullTime', primaryRoleId: 1, homeUnitId: 3, linkUser: null },
  ];

  function seedNurses() {
    const created = [];
    DEMO_NURSES.forEach((d, i) => {
      const employeeNumber = `DEMO-EMP-${pad2(i)}`;
      if (mockNurses.some((x) => x.employeeNumber === employeeNumber)) return;
      const role = mockNurseRoles.find((r) => r.id === d.primaryRoleId) || null;
      const unit = mockUnits.find((u) => u.id === d.homeUnitId) || null;
      const linked = d.linkUser ? mockUsers[d.linkUser] : null;
      mockNurses.push({
        id: nextId(mockNurses),
        employeeNumber,
        jobNo: `DEMO-JOB-${pad2(i)}`,
        firstName: d.firstName,
        middleName: d.middleName || null,
        lastName: d.lastName,
        gender: d.gender,
        dateOfBirth: d.dateOfBirth,
        nationality: d.nationality,
        phone: d.phone,
        hireDate: d.hireDate,
        employmentType: d.employmentType,
        status: 'Active',
        userId: linked ? linked.id : null,
        username: linked ? linked.username : null,
        primaryRole: role ? { id: role.id, code: role.code, name: role.name } : null,
        positionCode: d.positionCode,
        homeUnit: unit,
        isDemo: true,
        _deleted: false,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });
      created.push(employeeNumber);
    });
    return created;
  }

  // ------------------------------------------------------------ credentials
  function addCred(nurseId, spec) {
    if (mockCredentials.some((c) => c.credentialNumber === spec.credentialNumber)) return null;
    const verified = spec.status === 'Valid';
    const cred = {
      id: nextId(mockCredentials),
      nurseId,
      credentialType: spec.credentialType,
      name: spec.name,
      issuingAuthority: spec.issuingAuthority || null,
      credentialNumber: spec.credentialNumber,
      issuedDate: spec.issuedOff != null ? isoDay(spec.issuedOff) : null,
      expiryDate: spec.expiryOff != null ? isoDay(spec.expiryOff) : null,
      templateCode: spec.templateCode || null,
      trackingData: spec.trackingData || {},
      status: spec.status || 'Valid',
      verifiedBy: verified ? 1 : null,
      verifiedAt: verified ? nowIso() : null,
      isDemo: true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    mockCredentials.push(cred);
    return cred;
  }

  function seedCredentials() {
    let count = 0;
    const demoNurses = mockNurses.filter((n) => n.isDemo && !n._deleted);
    demoNurses.forEach((n, i) => {
      const d = DEMO_NURSES.find((x) => `DEMO-JOB-${pad2(DEMO_NURSES.indexOf(x))}` === n.jobNo) || {};
      const num = pad4(i);
      const put = (spec) => { if (addCred(n.id, spec)) count += 1; };

      // Passport — every demo nurse (legal identity demo)
      put({
        credentialType: 'Identity', name: 'PASSPORT', templateCode: 'PASSPORT',
        trackingData: { issuingCountry: n.nationality },
        issuingAuthority: PASSPORT_ISSUER[n.nationality] || 'Demo Passport Office',
        credentialNumber: `DEMO-P-${num}`,
        issuedOff: -500, expiryOff: 1500, status: 'Valid',
      });
      // Iqama — non-Saudi only (Saudis hold a National ID instead)
      if (n.nationality !== 'Saudi') {
        put({
          credentialType: 'Identity', name: 'IQAMA', templateCode: 'IQAMA',
          trackingData: { expiryDateHijri: '1449-03-10', jobTitle: d.positionName || n.positionCode },
          issuingAuthority: 'Jawazat (Demo)',
          credentialNumber: `DEMO-IQ-${num}`,
          issuedOff: -200, expiryOff: 160, status: 'Valid',
        });
      }
      // Hospital ID + SCFHS + BLS — everyone
      put({
        credentialType: 'Identity', name: 'HOSPITAL_ID', templateCode: 'HOSPITAL_ID',
        trackingData: { departmentCostCenter: 'ICU-01', accessLevel: 'Clinical' },
        issuingAuthority: 'Demo General Hospital',
        credentialNumber: `DEMO-HID-${num}`,
        issuedOff: -100, expiryOff: 265, status: 'Valid',
      });
      put({
        credentialType: 'License', name: 'SCFHS_LICENSE', templateCode: 'SCFHS',
        trackingData: { professionalClassification: 'Specialist Nursing' },
        issuingAuthority: 'SCFHS',
        credentialNumber: `DEMO-SCFHS-${num}`,
        issuedOff: -300, expiryOff: 400,
        // HCA's SCFHS is fresh off the scanner — demos the verify flow
        status: n.positionCode === 'HCA' ? 'PendingVerification' : 'Valid',
      });
      put({
        credentialType: 'Certification', name: 'BLS', templateCode: 'BLS',
        issuingAuthority: 'American Heart Association',
        credentialNumber: `DEMO-BLS-${num}`,
        issuedOff: -340,
        // TEC's BLS expires in 12 days — demos the expiring-soon alert
        expiryOff: n.positionCode === 'TEC' ? 12 : 300, status: 'Valid',
      });
      // Extras per position
      if (n.positionCode === 'HN') {
        put({
          credentialType: 'Competency', name: 'CORE_COMPETENCY', templateCode: 'CORE_COMPETENCY',
          trackingData: { evaluatorName: 'Demo CNO', assessmentStatus: 'Pass' },
          issuingAuthority: 'Nursing Education (Demo)',
          credentialNumber: `DEMO-CC-${num}`,
          issuedOff: -90, expiryOff: 275, status: 'Valid',
        });
      }
      if (n.positionCode === 'CI') {
        put({
          credentialType: 'Competency', name: 'UNIT_COMPETENCY', templateCode: 'UNIT_COMPETENCY',
          trackingData: { assignedUnitId: String(n.homeUnit ? n.homeUnit.id : 1), evaluatorName: 'Demo Educator', assessmentStatus: 'Pass' },
          issuingAuthority: 'Nursing Education (Demo)',
          credentialNumber: `DEMO-UC-${num}`,
          issuedOff: -60, expiryOff: 305, status: 'Valid',
        });
      }
      if (n.positionCode === 'CN') {
        put({
          credentialType: 'Certification', name: 'ACLS', templateCode: 'ACLS',
          issuingAuthority: 'American Heart Association',
          credentialNumber: `DEMO-ACLS-${num}`,
          issuedOff: -180, expiryOff: 185, status: 'Valid',
        });
      }
      if (n.positionCode === 'MW') {
        put({
          credentialType: 'Certification', name: 'NRP', templateCode: 'NRP',
          issuingAuthority: 'American Academy of Pediatrics',
          credentialNumber: `DEMO-NRP-${num}`,
          issuedOff: -200, expiryOff: 165, status: 'Valid',
        });
        // Expired PALS — demos the expired-credential alert + renew flow
        put({
          credentialType: 'Certification', name: 'PALS', templateCode: 'PALS',
          issuingAuthority: 'American Heart Association',
          credentialNumber: `DEMO-PALS-${num}`,
          issuedOff: -800, expiryOff: -5, status: 'Expired',
        });
      }
    });
    return count;
  }

  // -------------------------------------------------------------- contracts
  function seedContracts() {
    const store = app.locals.mockContracts || [];
    const created = [];
    const demoNurses = mockNurses.filter((n) => n.isDemo && !n._deleted);
    const typeByAgency = { 1: 'Permanent', 2: 'FixedTerm', 3: 'Temporary', 4: 'FixedTerm' };
    demoNurses.forEach((n, i) => {
      const contractNumber = `DEMO-CTR-${pad2(i)}`;
      if (store.some((c) => c.contractNumber === contractNumber)) return;
      const agencyId = (i % 4) + 1;
      const contractType = typeByAgency[agencyId];
      store.push({
        id: nextId(store),
        contractNumber,
        nurseId: n.id,
        jobNo: n.jobNo,
        positionId: (i % 4) + 1,
        agencyId,
        nursingUnitId: n.homeUnit ? n.homeUnit.id : null,
        departmentId: null,
        contractType,
        status: 'Active',
        startDate: isoDay(-180),
        endDate: contractType === 'Permanent' ? null : isoDay(180),
        notes: 'TEMP demo contract',
        isDemo: true,
        activatedAt: nowIso(),
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });
      created.push(contractNumber);
    });
    if (typeof app.locals.bumpContractSeq === 'function' && store.length) {
      app.locals.bumpContractSeq(store.reduce((m, c) => Math.max(m, c.id), 0));
    }
    return created;
  }

  // ----------------------------------------------------------------- roster
  function seedRoster() {
    const created = [];
    const demoNurses = mockNurses.filter((n) => n.isDemo && !n._deleted);
    demoNurses.forEach((n, i) => {
      if (mockRoster.some((a) => a.isDemo && a.nurseId === n.id)) return;
      mockRoster.push({
        id: nextId(mockRoster),
        nurseId: n.id,
        unitId: n.homeUnit ? n.homeUnit.id : 1,
        shiftId: (i % 3) + 1,
        postId: null,
        assignmentDate: isoDay(i + 1),
        status: i % 2 === 0 ? 'Confirmed' : 'Scheduled',
        notes: 'TEMP demo assignment',
        isDemo: true,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });
      created.push(n.id);
    });
    return created;
  }

  // ------------------------------------------------------------- manage API
  function stats() {
    const s = {
      seeded: Object.values(mockUsers).some((u) => u.isDemo),
      users: Object.values(mockUsers).filter((u) => u.isDemo).length,
      nurses: mockNurses.filter((n) => n.isDemo && !n._deleted).length,
      credentials: mockCredentials.filter((c) => c.isDemo).length,
      contracts: (app.locals.mockContracts || []).filter((c) => c.isDemo).length,
      rosterAssignments: mockRoster.filter((a) => a.isDemo && a.status !== 'Cancelled').length,
    };
    app.locals.demoStats = s;
    return s;
  }

  function seedAll() {
    const users = seedUsers();
    const nurses = seedNurses();
    const credentials = seedCredentials();
    const contracts = seedContracts();
    const roster = seedRoster();
    return { users, nurses, credentialCount: credentials, contracts, roster, stats: stats() };
  }

  function clearDemo() {
    const demoUsernames = Object.keys(mockUsers).filter((k) => mockUsers[k].isDemo);
    const demoUserIds = new Set(demoUsernames.map((k) => mockUsers[k].id));
    demoUsernames.forEach((k) => {
      delete mockUsers[k];
      if (loginAttempts) delete loginAttempts[k];
    });
    for (const [tok, uid] of issuedAccessTokens) {
      if (demoUserIds.has(uid)) issuedAccessTokens.delete(tok);
    }
    for (const [tok, uid] of issuedRefreshTokens) {
      if (demoUserIds.has(uid)) issuedRefreshTokens.delete(tok);
    }
    const demoNurseIds = new Set(mockNurses.filter((n) => n.isDemo).map((n) => n.id));
    const demoCredIds = new Set(mockCredentials.filter((c) => c.isDemo).map((c) => c.id));
    const strip = (arr, pred) => {
      let n = 0;
      for (let i = arr.length - 1; i >= 0; i--) {
        if (pred(arr[i])) { arr.splice(i, 1); n += 1; }
      }
      return n;
    };
    const nurses = strip(mockNurses, (n) => n.isDemo);
    const credentials = strip(mockCredentials, (c) => c.isDemo);
    const contracts = strip(app.locals.mockContracts || [], (c) => c.isDemo);
    // Orphans: roster/leave rows anyone created against demo nurses
    const roster = strip(mockRoster, (a) => demoNurseIds.has(a.nurseId));
    const leave = strip(mockLeaveRequests || [], (r) => demoNurseIds.has(r.nurseId));
    if (mockCredentialDocuments) {
      for (const id of demoCredIds) delete mockCredentialDocuments[id];
    }
    return {
      users: demoUsernames.length, nurses, credentials, contracts,
      rosterAssignments: roster, leaveRequests: leave, stats: stats(),
    };
  }

  app.get('/api/v1/mock/demo', (req, res) => {
    res.json({ success: true, data: stats(), timestamp: new Date().toISOString() });
  });

  app.post('/api/v1/mock/demo/seed', (req, res) => {
    const result = seedAll();
    console.log(`[MOCK] Demo seed: +${result.users.length} users, +${result.nurses.length} nurses, +${result.credentialCount} credentials, +${result.contracts.length} contracts, +${result.roster.length} roster`);
    res.status(201).json({ success: true, statusCode: 201, data: result, timestamp: new Date().toISOString() });
  });

  app.delete('/api/v1/mock/demo', (req, res) => {
    const result = clearDemo();
    console.log(`[MOCK] Demo cleared: -${result.users} users, -${result.nurses} nurses, -${result.credentials} credentials, -${result.contracts} contracts, -${result.rosterAssignments} roster, -${result.leaveRequests} leave`);
    res.json({ success: true, data: result, timestamp: new Date().toISOString() });
  });

  // Seed on startup so the preview is populated immediately
  seedAll();
  return { seed: seedAll, clear: clearDemo, stats };
};
