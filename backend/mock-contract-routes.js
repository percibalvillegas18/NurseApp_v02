/**
 * Contract Master mock routes — loaded by mock-server.js
 * In-memory agencies (MOH/SOP/HCC/HHC), positions, contracts, lifecycle actions.
 */
module.exports = function registerContractRoutes(app, deps) {
  const { mockNurses } = deps;
  const day = 86400000;

  const mockAgencies = [
    { id: 1, code: 'MOH', name: 'Ministry of Health', nameAr: '\u0648\u0632\u0627\u0631\u0629 \u0627\u0644\u0635\u062d\u0629', agencyType: 'Government', description: 'Civil servants under Saudi MOH', status: 'Active' },
    { id: 2, code: 'SOP', name: 'Self-Operating Program', nameAr: '\u0628\u0631\u0646\u0627\u0645\u062c \u0627\u0644\u062a\u0634\u063a\u064a\u0644 \u0627\u0644\u0630\u0627\u062a\u064a', agencyType: 'HospitalDirect', description: 'Hospital direct hiring (SOP)', status: 'Active' },
    { id: 3, code: 'HCC', name: 'HCC Contracting', nameAr: null, agencyType: 'ThirdParty', description: 'Third-party medical manpower', status: 'Active' },
    { id: 4, code: 'HHC', name: 'HHC Contracting', nameAr: null, agencyType: 'ThirdParty', description: 'Third-party specialized staffing', status: 'Active' },
  ];
  const mockPositions = [
    { id: 1, code: 'RN-ICU', name: 'Registered Nurse - ICU', category: 'Nursing', status: 'Active' },
    { id: 2, code: 'RN-ER', name: 'Registered Nurse - Emergency', category: 'Nursing', status: 'Active' },
    { id: 3, code: 'LPN-GEN', name: 'Licensed Practical Nurse - General', category: 'Nursing', status: 'Active' },
    { id: 4, code: 'CNA-GEN', name: 'Certified Nursing Assistant - General', category: 'Nursing', status: 'Active' },
  ];
  let mockContractSeq = 3;
  const mockContractHistory = [];
  const mockContracts = [
    {
      id: 1, contractNumber: 'CTR-MOH-1001', nurseId: 1, jobNo: 'JOB-1001', positionId: 1, agencyId: 1,
      nursingUnitId: 1, departmentId: null, contractType: 'Permanent', status: 'Active',
      startDate: new Date(Date.now() - 730 * day).toISOString().slice(0, 10), endDate: null,
      notes: 'MOH permanent', activatedAt: new Date().toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    },
    {
      id: 2, contractNumber: 'CTR-SOP-1002', nurseId: 2, jobNo: 'JOB-1002', positionId: 1, agencyId: 2,
      nursingUnitId: 1, departmentId: null, contractType: 'FixedTerm', status: 'Active',
      startDate: new Date(Date.now() - 180 * day).toISOString().slice(0, 10),
      endDate: new Date(Date.now() + 180 * day).toISOString().slice(0, 10),
      notes: 'SOP fixed term', activatedAt: new Date().toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    },
    {
      id: 3, contractNumber: 'CTR-HCC-1003', nurseId: 3, jobNo: 'JOB-1003', positionId: 3, agencyId: 3,
      nursingUnitId: 1, departmentId: null, contractType: 'Temporary', status: 'Active',
      startDate: new Date(Date.now() - 30 * day).toISOString().slice(0, 10),
      endDate: new Date(Date.now() + 60 * day).toISOString().slice(0, 10),
      notes: 'HCC temporary', activatedAt: new Date().toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    },
  ];

  function mapMockContract(c) {
    const nurse = mockNurses.find((n) => n.id === c.nurseId);
    const agency = mockAgencies.find((a) => a.id === c.agencyId);
    const position = mockPositions.find((p) => p.id === c.positionId);
    return {
      ...c,
      nurse: nurse
        ? {
            id: nurse.id,
            jobNo: nurse.jobNo,
            firstName: nurse.firstName,
            lastName: nurse.lastName,
            fullName: [nurse.firstName, nurse.middleName, nurse.lastName].filter(Boolean).join(' '),
            employeeNumber: nurse.employeeNumber,
          }
        : undefined,
      agency: agency
        ? { id: agency.id, code: agency.code, name: agency.name, agencyType: agency.agencyType }
        : undefined,
      position: position
        ? { id: position.id, code: position.code, name: position.name }
        : undefined,
    };
  }

  function pushHist(contractId, from, to, reason) {
    mockContractHistory.push({
      id: mockContractHistory.length + 1,
      contractId,
      fromStatus: from,
      toStatus: to,
      reason,
      changedAt: new Date().toISOString(),
    });
  }

  function datesOverlap(aStart, aEnd, bStart, bEnd) {
    const aE = aEnd || '9999-12-31';
    const bE = bEnd || '9999-12-31';
    return aStart <= bE && bStart <= aE;
  }

  function hasValidContract(nurseId, onDate) {
    const d = String(onDate).slice(0, 10);
    return mockContracts.some(
      (c) =>
        c.nurseId === nurseId &&
        c.status === 'Active' &&
        c.startDate <= d &&
        (c.endDate == null || c.endDate >= d),
    );
  }
  app.locals.hasValidContract = hasValidContract;
  // Exposed for the workforce module (analytics coverage + leave roster interplay)
  app.locals.mockContracts = mockContracts;
  // Lets the demo seed reserve contract IDs without later POST /contracts collisions
  app.locals.bumpContractSeq = (min) => { mockContractSeq = Math.max(mockContractSeq, min); };

  function contractAction(id, toStatus, reason) {
    const c = mockContracts.find((x) => x.id === id);
    if (!c) return { error: 404, message: 'Contract not found' };
    const from = c.status;

    if (toStatus === 'Active') {
      for (const other of mockContracts) {
        if (other.id === c.id) continue;
        if (other.nurseId !== c.nurseId) continue;
        if (other.status !== 'Active') continue;
        if (!datesOverlap(c.startDate, c.endDate, other.startDate, other.endDate)) continue;
        const ofrom = other.status;
        other.status = 'Superseded';
        other.updatedAt = new Date().toISOString();
        pushHist(other.id, ofrom, 'Superseded', 'Superseded by activation of ' + c.contractNumber);
      }
    }

    c.status = toStatus;
    c.updatedAt = new Date().toISOString();
    if (toStatus === 'Active') c.activatedAt = new Date().toISOString();
    if (toStatus === 'Terminated') {
      c.terminatedAt = new Date().toISOString();
      c.terminationReason = reason;
    }
    pushHist(c.id, from, toStatus, reason || toStatus);
    return { c };
  }

  app.get('/api/v1/contracts/agencies', (req, res) => {
    res.json({ success: true, data: mockAgencies, timestamp: new Date().toISOString() });
  });
  app.get('/api/v1/contracts/positions', (req, res) => {
    res.json({ success: true, data: mockPositions, timestamp: new Date().toISOString() });
  });
  app.get('/api/v1/contracts/expiring', (req, res) => {
    const days = parseInt(req.query.days || '90', 10);
    const limit = new Date(Date.now() + days * day).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const rows = mockContracts.filter(
      (c) => c.status === 'Active' && c.endDate && c.endDate >= today && c.endDate <= limit,
    );
    res.json({ success: true, data: rows.map(mapMockContract), timestamp: new Date().toISOString() });
  });
  app.get('/api/v1/contracts', (req, res) => {
    let rows = mockContracts.slice();
    if (req.query.status) rows = rows.filter((c) => c.status === req.query.status);
    if (req.query.agencyId) rows = rows.filter((c) => c.agencyId === parseInt(req.query.agencyId, 10));
    if (req.query.nurseId) rows = rows.filter((c) => c.nurseId === parseInt(req.query.nurseId, 10));
    if (req.query.search) {
      const q = String(req.query.search).toLowerCase();
      rows = rows.filter((c) => {
        const m = mapMockContract(c);
        return (
          (c.contractNumber || '').toLowerCase().includes(q) ||
          (c.jobNo || '').toLowerCase().includes(q) ||
          (m.nurse?.fullName || '').toLowerCase().includes(q)
        );
      });
    }
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '20', 10);
    const total = rows.length;
    const items = rows.slice((page - 1) * limit, page * limit).map(mapMockContract);
    res.json({
      success: true,
      data: {
        items,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 1,
          hasNextPage: page * limit < total,
          hasPreviousPage: page > 1,
        },
      },
      timestamp: new Date().toISOString(),
    });
  });
  app.get('/api/v1/contracts/:id/history', (req, res) => {
    const id = parseInt(req.params.id, 10);
    res.json({
      success: true,
      data: mockContractHistory.filter((h) => h.contractId === id),
      timestamp: new Date().toISOString(),
    });
  });
  app.get('/api/v1/contracts/:id/documents', (req, res) => {
    res.json({ success: true, data: [], timestamp: new Date().toISOString() });
  });
  app.get('/api/v1/contracts/:id', (req, res) => {
    const c = mockContracts.find((x) => x.id === parseInt(req.params.id, 10));
    if (!c) {
      return res.status(404).json({ success: false, message: 'Contract not found', timestamp: new Date().toISOString() });
    }
    res.json({ success: true, data: mapMockContract(c), timestamp: new Date().toISOString() });
  });
  app.post('/api/v1/contracts', (req, res) => {
    const b = req.body || {};
    if (!b.nurseId || !b.agencyId || !b.contractType || !b.startDate) {
      return res.status(400).json({
        success: false,
        message: 'nurseId, agencyId, contractType, startDate required',
        timestamp: new Date().toISOString(),
      });
    }
    const nurse = mockNurses.find((n) => n.id === b.nurseId && !n._deleted);
    if (!nurse) {
      return res.status(404).json({ success: false, message: 'Nurse not found', timestamp: new Date().toISOString() });
    }
    mockContractSeq += 1;
    const c = {
      id: mockContractSeq,
      contractNumber: b.contractNumber || `CTR-MOCK-${mockContractSeq}`,
      nurseId: b.nurseId,
      jobNo: nurse.jobNo,
      positionId: b.positionId || null,
      agencyId: b.agencyId,
      nursingUnitId: b.nursingUnitId || nurse.homeUnit?.id || null,
      departmentId: b.departmentId || null,
      contractType: b.contractType,
      status: 'Draft',
      startDate: b.startDate,
      endDate: b.endDate || null,
      notes: b.notes || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockContracts.push(c);
    pushHist(c.id, null, 'Draft', 'Created');
    res.status(201).json({
      success: true,
      statusCode: 201,
      data: mapMockContract(c),
      timestamp: new Date().toISOString(),
    });
  });
  app.patch('/api/v1/contracts/:id', (req, res) => {
    const c = mockContracts.find((x) => x.id === parseInt(req.params.id, 10));
    if (!c) {
      return res.status(404).json({ success: false, message: 'Contract not found', timestamp: new Date().toISOString() });
    }
    if (!['Draft', 'PendingApproval', 'Suspended'].includes(c.status)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot edit in status ' + c.status,
        timestamp: new Date().toISOString(),
      });
    }
    Object.assign(c, req.body, { updatedAt: new Date().toISOString() });
    res.json({ success: true, data: mapMockContract(c), timestamp: new Date().toISOString() });
  });
  app.post('/api/v1/contracts/:id/submit', (req, res) => {
    const c = mockContracts.find((x) => x.id === parseInt(req.params.id, 10));
    if (!c) return res.status(404).json({ success: false, message: 'Not found', timestamp: new Date().toISOString() });
    if (c.status !== 'Draft') {
      return res.status(400).json({ success: false, message: 'Only Draft can be submitted', timestamp: new Date().toISOString() });
    }
    const r = contractAction(c.id, 'PendingApproval', 'Submitted');
    res.json({ success: true, data: mapMockContract(r.c), timestamp: new Date().toISOString() });
  });
  app.post('/api/v1/contracts/:id/approve', (req, res) => {
    const c = mockContracts.find((x) => x.id === parseInt(req.params.id, 10));
    if (!c) return res.status(404).json({ success: false, message: 'Not found', timestamp: new Date().toISOString() });
    if (!['Draft', 'PendingApproval'].includes(c.status)) {
      return res.status(400).json({ success: false, message: 'Cannot approve', timestamp: new Date().toISOString() });
    }
    const r = contractAction(c.id, 'Active', 'Approved and activated');
    res.json({ success: true, data: mapMockContract(r.c), timestamp: new Date().toISOString() });
  });
  app.post('/api/v1/contracts/:id/activate', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const r = contractAction(id, 'Active', 'Activated');
    if (r.error) {
      return res.status(r.error).json({ success: false, message: r.message, timestamp: new Date().toISOString() });
    }
    res.json({ success: true, data: mapMockContract(r.c), timestamp: new Date().toISOString() });
  });
  app.post('/api/v1/contracts/:id/suspend', (req, res) => {
    const c = mockContracts.find((x) => x.id === parseInt(req.params.id, 10));
    if (!c) return res.status(404).json({ success: false, message: 'Not found', timestamp: new Date().toISOString() });
    if (c.status !== 'Active') {
      return res.status(400).json({ success: false, message: 'Only Active can be suspended', timestamp: new Date().toISOString() });
    }
    const r = contractAction(c.id, 'Suspended', (req.body && req.body.reason) || 'Suspended');
    res.json({ success: true, data: mapMockContract(r.c), timestamp: new Date().toISOString() });
  });
  app.post('/api/v1/contracts/:id/terminate', (req, res) => {
    const c = mockContracts.find((x) => x.id === parseInt(req.params.id, 10));
    if (!c) return res.status(404).json({ success: false, message: 'Not found', timestamp: new Date().toISOString() });
    if (!req.body || !req.body.reason) {
      return res.status(400).json({ success: false, message: 'reason required', timestamp: new Date().toISOString() });
    }
    const r = contractAction(c.id, 'Terminated', req.body.reason);
    res.json({ success: true, data: mapMockContract(r.c), timestamp: new Date().toISOString() });
  });
  app.post('/api/v1/contracts/:id/renew', (req, res) => {
    const prior = mockContracts.find((x) => x.id === parseInt(req.params.id, 10));
    if (!prior) return res.status(404).json({ success: false, message: 'Not found', timestamp: new Date().toISOString() });
    if (!['Active', 'Expired', 'Suspended'].includes(prior.status)) {
      return res.status(400).json({ success: false, message: 'Only Active, Expired, or Suspended can be renewed', timestamp: new Date().toISOString() });
    }
    const b = req.body || {};
    if (!b.startDate) {
      return res.status(400).json({ success: false, message: 'startDate required', timestamp: new Date().toISOString() });
    }
    mockContractSeq += 1;
    const neu = {
      id: mockContractSeq,
      contractNumber: `CTR-REN-${mockContractSeq}`,
      nurseId: prior.nurseId,
      jobNo: prior.jobNo,
      positionId: b.positionId || prior.positionId,
      agencyId: b.agencyId || prior.agencyId,
      nursingUnitId: prior.nursingUnitId,
      departmentId: prior.departmentId,
      contractType: b.contractType || prior.contractType,
      status: 'Draft',
      startDate: b.startDate,
      endDate: b.endDate || null,
      renewalOfId: prior.id,
      notes: b.notes || `Renewal of ${prior.contractNumber}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockContracts.push(neu);
    pushHist(neu.id, null, 'Draft', 'Created as renewal; prior remains ' + prior.status + ' until activate');
    res.status(201).json({
      success: true,
      statusCode: 201,
      data: mapMockContract(neu),
      timestamp: new Date().toISOString(),
    });
  });
  app.post('/api/v1/contracts/:id/documents', (req, res) => {
    res.status(201).json({
      success: true,
      statusCode: 201,
      data: { id: 1, ...(req.body || {}) },
      timestamp: new Date().toISOString(),
    });
  });

  return { mockContracts, mockAgencies, hasValidContract };
};
