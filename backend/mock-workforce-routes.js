/**
 * Workforce mock routes — loaded by mock-server.js AFTER mock-contract-routes.
 *
 * In-memory, Nest-shape responses for the parts of the system that have no
 * Nest module yet (leave, analytics, settings) plus RBAC access-levels
 * (Nest parity: RbacController.getAccessLevels / createAccessLevel).
 *
 * Analytics endpoints compute LIVE from the shared in-memory arrays, so they
 * stay consistent with every create/update made through the preview.
 */
module.exports = function registerWorkforceRoutes(app, deps) {
  const { mockNurses, mockUsers, mockMenus, mockCredentials, mockRoster, mockUnits, mockShifts } = deps;
  const day = 86400000;
  const todayStr = () => new Date().toISOString().slice(0, 10);
  const isoDay = (offset) => new Date(Date.now() + offset * day).toISOString().slice(0, 10);

  const contracts = () => app.locals.mockContracts || [];
  const hasValidContract =
    app.locals.hasValidContract || (() => false);

  const usersById = () => Object.values(mockUsers || {});
  const userById = (id) => usersById().find((u) => u.id === id) || null;
  const nurseName = (n) =>
    n ? [n.firstName, n.middleName, n.lastName].filter(Boolean).join(' ') : '—';
  const activeNurses = () => (mockNurses || []).filter((n) => !n._deleted && n.status === 'Active');

  const daysBetweenInclusive = (start, end) =>
    Math.round((Date.parse(end) - Date.parse(start)) / day) + 1;

  const rangesOverlap = (aStart, aEnd, bStart, bEnd) => aStart <= bEnd && bStart <= aEnd;

  const authUserId = (req) => {
    const m = String(req.headers.authorization || '').match(/mock_jwt_(\d+)_/);
    return m ? parseInt(m[1], 10) : null;
  };

  // ==========================================================================
  // LEAVE MANAGEMENT
  // ==========================================================================
  const mockLeaveTypes = [
    { code: 'ANNUAL', name: 'Annual Leave', annualEntitlement: 30, paid: true, requiresApproval: true, description: 'Regular paid vacation' },
    { code: 'SICK', name: 'Sick Leave', annualEntitlement: 30, paid: true, requiresApproval: true, description: 'Medically certified illness' },
    { code: 'EMERGENCY', name: 'Emergency Leave', annualEntitlement: 5, paid: true, requiresApproval: true, description: 'Urgent family matters' },
    { code: 'MATERNITY', name: 'Maternity Leave', annualEntitlement: 70, paid: true, requiresApproval: true, description: '70 days per labor law' },
    { code: 'PATERNITY', name: 'Paternity Leave', annualEntitlement: 3, paid: true, requiresApproval: true, description: 'New-child leave' },
    { code: 'HAJJ', name: 'Hajj Leave', annualEntitlement: 10, paid: true, requiresApproval: true, description: 'Once per employment' },
    { code: 'STUDY', name: 'Study Leave', annualEntitlement: 10, paid: true, requiresApproval: true, description: 'Exams / training courses' },
    { code: 'UNPAID', name: 'Unpaid Leave', annualEntitlement: 0, paid: false, requiresApproval: true, description: 'No balance cap; approval required' },
  ];

  let mockLeaveSeq = 0;
  // Status: Draft -> Submitted -> Approved | Rejected ; any of Draft/Submitted/Approved -> Cancelled
  const mockLeaveRequests = [];
  function seedLeave(nurseId, leaveTypeCode, startOff, endOff, status, extra = {}) {
    mockLeaveSeq += 1;
    const startDate = isoDay(startOff);
    const endDate = isoDay(endOff);
    mockLeaveRequests.push({
      id: mockLeaveSeq,
      nurseId,
      leaveTypeCode,
      startDate,
      endDate,
      days: daysBetweenInclusive(startDate, endDate),
      reason: extra.reason || 'Seeded demo request',
      contactInfo: extra.contactInfo || null,
      status,
      submittedAt: ['Submitted', 'Approved', 'Rejected'].includes(status) ? new Date(Date.now() - 3 * day).toISOString() : null,
      decidedBy: ['Approved', 'Rejected'].includes(status) ? 2 : null,
      decidedAt: ['Approved', 'Rejected'].includes(status) ? new Date(Date.now() - 2 * day).toISOString() : null,
      decisionNote: extra.decisionNote || null,
      createdAt: new Date(Date.now() - 5 * day).toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  seedLeave(1, 'ANNUAL', -60, -53, 'Approved', { reason: 'Family vacation' });
  seedLeave(2, 'SICK', -3, -2, 'Approved', { reason: 'Flu with medical report' });
  seedLeave(3, 'ANNUAL', 10, 16, 'Submitted', { reason: 'Annual vacation' });
  seedLeave(4, 'EMERGENCY', 2, 3, 'Submitted', { reason: 'Family emergency' });
  seedLeave(2, 'ANNUAL', 30, 40, 'Draft', { reason: 'Planned vacation' });
  seedLeave(1, 'SICK', -20, -19, 'Rejected', { reason: 'No medical report attached', decisionNote: 'Medical report required' });

  function mapLeaveRequest(r) {
    const nurse = (mockNurses || []).find((n) => n.id === r.nurseId);
    const type = mockLeaveTypes.find((t) => t.code === r.leaveTypeCode);
    const decider = r.decidedBy ? userById(r.decidedBy) : null;
    return {
      ...r,
      nurse: nurse
        ? { id: nurse.id, employeeNumber: nurse.employeeNumber, jobNo: nurse.jobNo, fullName: nurseName(nurse) }
        : undefined,
      leaveType: type ? { code: type.code, name: type.name, paid: type.paid } : undefined,
      decidedByUser: decider ? { id: decider.id, username: decider.username, fullName: decider.fullName } : null,
    };
  }

  /** Balances are DERIVED from requests so they can never drift. */
  function leaveBalances(nurseId) {
    return mockLeaveTypes.map((t) => {
      const mine = mockLeaveRequests.filter(
        (r) => r.nurseId === nurseId && r.leaveTypeCode === t.code,
      );
      const used = mine.filter((r) => r.status === 'Approved').reduce((s, r) => s + r.days, 0);
      const pending = mine.filter((r) => r.status === 'Submitted').reduce((s, r) => s + r.days, 0);
      return {
        nurseId,
        leaveTypeCode: t.code,
        leaveTypeName: t.name,
        paid: t.paid,
        entitled: t.annualEntitlement,
        used,
        pending,
        remaining: t.paid ? Math.max(0, t.annualEntitlement - used - pending) : null,
      };
    });
  }

  function rosterClashes(nurseId, startDate, endDate) {
    return (mockRoster || [])
      .filter(
        (a) =>
          a.nurseId === nurseId &&
          a.status !== 'Cancelled' &&
          a.assignmentDate >= startDate &&
          a.assignmentDate <= endDate,
      )
      .map((a) => {
        const unit = (mockUnits || []).find((u) => u.id === a.unitId);
        const shift = (mockShifts || []).find((s) => s.id === a.shiftId);
        return {
          assignmentId: a.id,
          date: a.assignmentDate,
          unitCode: unit ? unit.code : undefined,
          shiftCode: shift ? shift.code : undefined,
          status: a.status,
        };
      });
  }

  function leaveOverlap(nurseId, startDate, endDate, excludeId = null) {
    return (
      mockLeaveRequests.find(
        (r) =>
          r.id !== excludeId &&
          r.nurseId === nurseId &&
          ['Draft', 'Submitted', 'Approved'].includes(r.status) &&
          rangesOverlap(r.startDate, r.endDate, startDate, endDate),
      ) || null
    );
  }

  // -- Leave lookups ----------------------------------------------------------
  app.get('/api/v1/leave/types', (req, res) => {
    res.json({ success: true, data: mockLeaveTypes, timestamp: new Date().toISOString() });
  });

  app.get('/api/v1/leave/balances', (req, res) => {
    const { nurseId } = req.query;
    let nurses = activeNurses();
    if (nurseId) nurses = nurses.filter((n) => n.id === parseInt(nurseId, 10));
    const items = nurses.map((n) => ({
      nurse: { id: n.id, employeeNumber: n.employeeNumber, jobNo: n.jobNo, fullName: nurseName(n) },
      balances: leaveBalances(n.id),
    }));
    res.json({ success: true, data: { items }, timestamp: new Date().toISOString() });
  });

  // -- Leave requests ---------------------------------------------------------
  app.get('/api/v1/leave/requests', (req, res) => {
    let rows = mockLeaveRequests.slice().sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)));
    if (req.query.nurseId) rows = rows.filter((r) => r.nurseId === parseInt(req.query.nurseId, 10));
    if (req.query.status) rows = rows.filter((r) => r.status === req.query.status);
    if (req.query.type) rows = rows.filter((r) => r.leaveTypeCode === req.query.type);
    if (req.query.from) rows = rows.filter((r) => r.endDate >= String(req.query.from).slice(0, 10));
    if (req.query.to) rows = rows.filter((r) => r.startDate <= String(req.query.to).slice(0, 10));
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20', 10)));
    const total = rows.length;
    res.json({
      success: true,
      data: {
        items: rows.slice((page - 1) * limit, page * limit).map(mapLeaveRequest),
        pagination: {
          page, limit, total,
          totalPages: Math.max(1, Math.ceil(total / limit)),
          hasNextPage: page * limit < total,
          hasPreviousPage: page > 1,
        },
      },
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/v1/leave/requests/:id', (req, res) => {
    const r = mockLeaveRequests.find((x) => x.id === parseInt(req.params.id, 10));
    if (!r) return res.status(404).json({ success: false, message: 'Leave request not found', timestamp: new Date().toISOString() });
    res.json({
      success: true,
      data: { ...mapLeaveRequest(r), rosterClashes: rosterClashes(r.nurseId, r.startDate, r.endDate) },
      timestamp: new Date().toISOString(),
    });
  });

  app.post('/api/v1/leave/requests', (req, res) => {
    const b = req.body || {};
    if (!b.nurseId || !b.leaveTypeCode || !b.startDate || !b.endDate) {
      return res.status(400).json({ success: false, message: 'nurseId, leaveTypeCode, startDate, endDate are required', timestamp: new Date().toISOString() });
    }
    const nurse = (mockNurses || []).find((n) => n.id === b.nurseId && !n._deleted);
    if (!nurse) return res.status(404).json({ success: false, message: 'Nurse #' + b.nurseId + ' not found', timestamp: new Date().toISOString() });
    const type = mockLeaveTypes.find((t) => t.code === b.leaveTypeCode);
    if (!type) return res.status(400).json({ success: false, message: 'Unknown leave type', timestamp: new Date().toISOString() });
    const startDate = String(b.startDate).slice(0, 10);
    const endDate = String(b.endDate).slice(0, 10);
    if (endDate < startDate) {
      return res.status(400).json({ success: false, message: 'End date cannot precede start date', timestamp: new Date().toISOString() });
    }
    const days = daysBetweenInclusive(startDate, endDate);
    const clash = leaveOverlap(b.nurseId, startDate, endDate);
    if (clash) {
      return res.status(409).json({
        success: false,
        message: `Overlaps ${clash.status} ${clash.leaveTypeCode} request #${clash.id} (${clash.startDate} → ${clash.endDate})`,
        timestamp: new Date().toISOString(),
      });
    }
    if (type.paid) {
      const bal = leaveBalances(b.nurseId).find((x) => x.leaveTypeCode === type.code);
      if (days > bal.remaining) {
        return res.status(409).json({
          success: false,
          message: `Insufficient ${type.name} balance: needs ${days} day(s), only ${bal.remaining} remaining (entitled ${bal.entitled}, used ${bal.used}, pending ${bal.pending})`,
          timestamp: new Date().toISOString(),
        });
      }
    }
    mockLeaveSeq += 1;
    const created = {
      id: mockLeaveSeq,
      nurseId: b.nurseId,
      leaveTypeCode: type.code,
      startDate,
      endDate,
      days,
      reason: b.reason || null,
      contactInfo: b.contactInfo || null,
      status: 'Draft',
      submittedAt: null,
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockLeaveRequests.push(created);
    const warnings = rosterClashes(created.nurseId, startDate, endDate).map(
      (c) => `Rostered on ${c.date} (${c.unitCode || ''} ${c.shiftCode || ''}, ${c.status}) — assignment #${c.assignmentId} needs cover`,
    );
    res.status(201).json({
      success: true, statusCode: 201,
      data: { request: mapLeaveRequest(created), warnings },
      timestamp: new Date().toISOString(),
    });
  });

  app.patch('/api/v1/leave/requests/:id', (req, res) => {
    const r = mockLeaveRequests.find((x) => x.id === parseInt(req.params.id, 10));
    if (!r) return res.status(404).json({ success: false, message: 'Leave request not found', timestamp: new Date().toISOString() });
    if (r.status !== 'Draft') {
      return res.status(400).json({ success: false, message: 'Only Draft requests can be edited', timestamp: new Date().toISOString() });
    }
    const b = req.body || {};
    const nextType = b.leaveTypeCode !== undefined ? b.leaveTypeCode : r.leaveTypeCode;
    const type = mockLeaveTypes.find((t) => t.code === nextType);
    if (!type) return res.status(400).json({ success: false, message: 'Unknown leave type', timestamp: new Date().toISOString() });
    const nextStart = b.startDate ? String(b.startDate).slice(0, 10) : r.startDate;
    const nextEnd = b.endDate ? String(b.endDate).slice(0, 10) : r.endDate;
    if (nextEnd < nextStart) {
      return res.status(400).json({ success: false, message: 'End date cannot precede start date', timestamp: new Date().toISOString() });
    }
    const clash = leaveOverlap(r.nurseId, nextStart, nextEnd, r.id);
    if (clash) {
      return res.status(409).json({ success: false, message: `Overlaps ${clash.status} request #${clash.id} (${clash.startDate} → ${clash.endDate})`, timestamp: new Date().toISOString() });
    }
    r.leaveTypeCode = nextType;
    r.startDate = nextStart;
    r.endDate = nextEnd;
    r.days = daysBetweenInclusive(nextStart, nextEnd);
    if (b.reason !== undefined) r.reason = b.reason;
    if (b.contactInfo !== undefined) r.contactInfo = b.contactInfo;
    r.updatedAt = new Date().toISOString();
    res.json({ success: true, data: mapLeaveRequest(r), timestamp: new Date().toISOString() });
  });

  function leaveTransition(id, from, to, req, res, opts = {}) {
    const r = mockLeaveRequests.find((x) => x.id === id);
    if (!r) return res.status(404).json({ success: false, message: 'Leave request not found', timestamp: new Date().toISOString() });
    if (!from.includes(r.status)) {
      return res.status(400).json({ success: false, message: `Cannot ${opts.verb || to} a ${r.status} request`, timestamp: new Date().toISOString() });
    }
    if (opts.requireNote && !(req.body || {}).note) {
      return res.status(400).json({ success: false, message: 'A decision note is required', timestamp: new Date().toISOString() });
    }
    // Re-validate on approve: overlap + balance may have changed since submit
    if (to === 'Approved') {
      const clash = leaveOverlap(r.nurseId, r.startDate, r.endDate, r.id);
      if (clash) {
        return res.status(409).json({ success: false, message: `Overlaps ${clash.status} request #${clash.id} (${clash.startDate} → ${clash.endDate})`, timestamp: new Date().toISOString() });
      }
      const type = mockLeaveTypes.find((t) => t.code === r.leaveTypeCode);
      if (type && type.paid) {
        const bal = leaveBalances(r.nurseId).find((x) => x.leaveTypeCode === type.code);
        // pending includes this request, so available = remaining + this request's days
        if (r.days > bal.remaining + r.days) {
          return res.status(409).json({ success: false, message: `Insufficient ${type.name} balance`, timestamp: new Date().toISOString() });
        }
      }
    }
    r.status = to;
    if (to === 'Submitted') r.submittedAt = new Date().toISOString();
    if (['Approved', 'Rejected'].includes(to)) {
      r.decidedBy = authUserId(req) || 1;
      r.decidedAt = new Date().toISOString();
      r.decisionNote = (req.body || {}).note || null;
    }
    if (to === 'Cancelled') r.decisionNote = (req.body || {}).note || r.decisionNote;
    r.updatedAt = new Date().toISOString();
    return res.json({ success: true, data: mapLeaveRequest(r), timestamp: new Date().toISOString() });
  }

  app.post('/api/v1/leave/requests/:id/submit', (req, res) =>
    leaveTransition(parseInt(req.params.id, 10), ['Draft'], 'Submitted', req, res, { verb: 'submit' }));
  app.post('/api/v1/leave/requests/:id/approve', (req, res) =>
    leaveTransition(parseInt(req.params.id, 10), ['Submitted'], 'Approved', req, res, { verb: 'approve' }));
  app.post('/api/v1/leave/requests/:id/reject', (req, res) =>
    leaveTransition(parseInt(req.params.id, 10), ['Submitted'], 'Rejected', req, res, { verb: 'reject', requireNote: true }));
  app.post('/api/v1/leave/requests/:id/cancel', (req, res) =>
    leaveTransition(parseInt(req.params.id, 10), ['Draft', 'Submitted', 'Approved'], 'Cancelled', req, res, { verb: 'cancel' }));

  // ==========================================================================
  // WORKFORCE ANALYTICS (all computed live)
  // ==========================================================================
  const credentialWithExpiry = (c) => {
    const d = c.expiryDate ? Math.round((Date.parse(c.expiryDate) - Date.parse(todayStr())) / day) : null;
    const expired = c.status === 'Expired' || (d !== null && d < 0);
    return { ...c, daysUntilExpiry: d, expired };
  };

  app.get('/api/v1/analytics/summary', (req, res) => {
    const nurses = activeNurses();
    const byStatus = {};
    for (const n of (mockNurses || []).filter((x) => !x._deleted)) byStatus[n.status] = (byStatus[n.status] || 0) + 1;
    const byEmploymentType = {};
    const byRole = {};
    const byUnit = {};
    for (const n of nurses) {
      byEmploymentType[n.employmentType] = (byEmploymentType[n.employmentType] || 0) + 1;
      const rc = (n.primaryRole && n.primaryRole.code) || 'Unassigned';
      byRole[rc] = (byRole[rc] || 0) + 1;
      const uc = (n.homeUnit && (mockUnits || []).find((u) => u.id === n.homeUnit.id)?.code) || 'Unassigned';
      byUnit[uc] = (byUnit[uc] || 0) + 1;
    }

    const creds = (mockCredentials || []).map(credentialWithExpiry);
    const credActive = creds.filter((c) => !['Revoked', 'Suspended'].includes(c.status));
    const credExpired = credActive.filter((c) => c.expired).length;
    const credExpiring30 = credActive.filter((c) => !c.expired && c.daysUntilExpiry !== null && c.daysUntilExpiry <= 30).length;
    const credPending = credActive.filter((c) => c.status === 'PendingVerification').length;

    const allContracts = contracts();
    const activeContracts = allContracts.filter((c) => c.status === 'Active').length;
    const contractExpiring90 = allContracts.filter((c) => {
      if (c.status !== 'Active' || !c.endDate) return false;
      const d = Math.round((Date.parse(c.endDate) - Date.parse(todayStr())) / day);
      return d >= 0 && d <= 90;
    }).length;
    const withoutValidContract = nurses.filter((n) => !hasValidContract(n.id, todayStr())).length;

    const horizon = isoDay(7);
    const roster7 = (mockRoster || []).filter((a) => a.status !== 'Cancelled' && a.assignmentDate >= todayStr() && a.assignmentDate <= horizon);
    const rosterByStatus = {};
    for (const a of roster7) rosterByStatus[a.status] = (rosterByStatus[a.status] || 0) + 1;

    const pendingLeave = mockLeaveRequests.filter((r) => r.status === 'Submitted').length;
    const onLeaveToday = mockLeaveRequests.filter(
      (r) => r.status === 'Approved' && r.startDate <= todayStr() && r.endDate >= todayStr(),
    ).length;

    res.json({
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        headcount: { total: nurses.length, byStatus, byEmploymentType, byRole, byUnit },
        credentials: { total: credActive.length, expired: credExpired, expiring30: credExpiring30, pendingVerification: credPending },
        contracts: { active: activeContracts, expiring90: contractExpiring90, withoutValidContract },
        rosterNext7Days: { total: roster7.length, byStatus: rosterByStatus },
        leave: { pendingApprovals: pendingLeave, onLeaveToday },
      },
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/v1/analytics/credentials', (req, res) => {
    const creds = (mockCredentials || []).map(credentialWithExpiry).filter((c) => !['Revoked', 'Suspended'].includes(c.status));
    const byStatus = {};
    const byCategory = {};
    for (const c of creds) {
      const key = c.expired ? 'Expired' : c.status;
      byStatus[key] = (byStatus[key] || 0) + 1;
      byCategory[c.category || 'Uncategorized'] = (byCategory[c.category || 'Uncategorized'] || 0) + 1;
    }
    const withNurse = (c) => {
      const n = (mockNurses || []).find((x) => x.id === c.nurseId);
      return { ...c, nurse: n ? { id: n.id, employeeNumber: n.employeeNumber, fullName: nurseName(n) } : null };
    };
    res.json({
      success: true,
      data: {
        total: creds.length,
        byStatus,
        byCategory,
        expiring30: creds.filter((c) => !c.expired && c.daysUntilExpiry !== null && c.daysUntilExpiry <= 30)
          .sort((a, b) => (a.daysUntilExpiry ?? 9999) - (b.daysUntilExpiry ?? 9999)).slice(0, 20).map(withNurse),
        expired: creds.filter((c) => c.expired)
          .sort((a, b) => String(b.expiryDate || '').localeCompare(String(a.expiryDate || ''))).slice(0, 20).map(withNurse),
      },
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/v1/analytics/contracts', (req, res) => {
    const all = contracts();
    const byStatus = {};
    const byAgency = {};
    const byType = {};
    for (const c of all) {
      byStatus[c.status] = (byStatus[c.status] || 0) + 1;
      byAgency[c.agencyId] = (byAgency[c.agencyId] || 0) + 1;
      byType[c.contractType] = (byType[c.contractType] || 0) + 1;
    }
    const withNurse = (c) => {
      const n = (mockNurses || []).find((x) => x.id === c.nurseId);
      return { ...c, nurse: n ? { id: n.id, employeeNumber: n.employeeNumber, fullName: nurseName(n) } : null };
    };
    res.json({
      success: true,
      data: {
        total: all.length,
        byStatus,
        byAgency,
        byType,
        expiring90: all.filter((c) => {
          if (c.status !== 'Active' || !c.endDate) return false;
          const d = Math.round((Date.parse(c.endDate) - Date.parse(todayStr())) / day);
          return d >= 0 && d <= 90;
        }).sort((a, b) => String(a.endDate).localeCompare(String(b.endDate))).map(withNurse),
        uncoveredNurses: activeNurses().filter((n) => !hasValidContract(n.id, todayStr()))
          .map((n) => ({ id: n.id, employeeNumber: n.employeeNumber, jobNo: n.jobNo, fullName: nurseName(n) })),
      },
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/v1/analytics/roster', (req, res) => {
    const from = req.query.from ? String(req.query.from).slice(0, 10) : todayStr();
    const to = req.query.to ? String(req.query.to).slice(0, 10) : isoDay(13);
    let rows = (mockRoster || []).filter((a) => a.status !== 'Cancelled' && a.assignmentDate >= from && a.assignmentDate <= to);
    if (req.query.unitId) rows = rows.filter((a) => a.unitId === parseInt(req.query.unitId, 10));
    const daily = {};
    const perNurse = {};
    for (const a of rows) {
      daily[a.assignmentDate] = daily[a.assignmentDate] || { date: a.assignmentDate, total: 0, byShift: {}, byStatus: {} };
      const d = daily[a.assignmentDate];
      d.total += 1;
      const shift = (mockShifts || []).find((s) => s.id === a.shiftId);
      const sk = shift ? shift.code : 'Unknown';
      d.byShift[sk] = (d.byShift[sk] || 0) + 1;
      d.byStatus[a.status] = (d.byStatus[a.status] || 0) + 1;
      perNurse[a.nurseId] = (perNurse[a.nurseId] || 0) + 1;
    }
    const topNurses = Object.entries(perNurse)
      .map(([nurseId, count]) => {
        const n = (mockNurses || []).find((x) => x.id === parseInt(nurseId, 10));
        return { nurseId: parseInt(nurseId, 10), fullName: n ? nurseName(n) : '—', employeeNumber: n?.employeeNumber, assignments: count };
      })
      .sort((a, b) => b.assignments - a.assignments)
      .slice(0, 10);
    res.json({
      success: true,
      data: { from, to, total: rows.length, daily: Object.values(daily).sort((a, b) => a.date.localeCompare(b.date)), topNurses },
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/v1/analytics/leave', (req, res) => {
    const year = req.query.year ? String(req.query.year) : String(new Date().getFullYear());
    const inYear = mockLeaveRequests.filter((r) => r.startDate.startsWith(year) || r.endDate.startsWith(year));
    const daysByType = {};
    const byStatus = {};
    const byMonth = {};
    for (const r of inYear) {
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      if (r.status === 'Approved') {
        daysByType[r.leaveTypeCode] = (daysByType[r.leaveTypeCode] || 0) + r.days;
        const mk = r.startDate.slice(0, 7);
        byMonth[mk] = (byMonth[mk] || 0) + r.days;
      }
    }
    const lowBalances = [];
    for (const n of activeNurses()) {
      for (const b of leaveBalances(n.id)) {
        // Relative threshold: small entitlements (e.g. Paternity=3) must not
        // all show as "low" — flag only when ≤20% of entitlement remains.
        if (b.paid && b.entitled > 0 && b.remaining !== null && b.remaining <= b.entitled * 0.2) {
          lowBalances.push({ nurseId: n.id, fullName: nurseName(n), employeeNumber: n.employeeNumber, ...b });
        }
      }
    }
    res.json({
      success: true,
      data: {
        year,
        requestsByStatus: byStatus,
        approvedDaysByType: daysByType,
        approvedDaysByMonth: byMonth,
        pending: mockLeaveRequests.filter((r) => r.status === 'Submitted').map(mapLeaveRequest),
        lowBalances,
      },
      timestamp: new Date().toISOString(),
    });
  });

  // ==========================================================================
  // SYSTEM SETTINGS (in-memory; mirrors the knobs operators actually need)
  // ==========================================================================
  const mockSettings = {
    hospitalName: 'Demo General Hospital',
    hospitalNameAr: 'مستشفى تجريبي العام',
    hospitalCode: 'DGH-001',
    accessTokenTtlSec: 3600,
    refreshTokenTtlSec: 86400,
    maxSessionsPerUser: 3,
    passwordMinLength: 8,
    passwordRequireComplexity: true,
    passwordExpiryDays: 90,
    lockoutMaxAttempts: 5,
    lockoutMinutes: 10,
    rosterHorizonDays: 31,
    rosterRequiresValidContract: true,
    credentialAlertDays: 30,
    contractAlertDays: 90,
    maintenanceMode: false,
    updatedAt: new Date().toISOString(),
  };
  const SETTINGS_ALLOWLIST = Object.keys(mockSettings).filter((k) => k !== 'updatedAt');

  app.get('/api/v1/settings', (req, res) => {
    res.json({ success: true, data: { ...mockSettings }, timestamp: new Date().toISOString() });
  });

  app.patch('/api/v1/settings', (req, res) => {
    const b = req.body || {};
    const unknown = Object.keys(b).filter((k) => !SETTINGS_ALLOWLIST.includes(k));
    if (unknown.length) {
      return res.status(400).json({ success: false, message: 'Unknown setting(s): ' + unknown.join(', '), timestamp: new Date().toISOString() });
    }
    if (b.passwordMinLength !== undefined && (b.passwordMinLength < 6 || b.passwordMinLength > 64)) {
      return res.status(400).json({ success: false, message: 'passwordMinLength must be 6–64', timestamp: new Date().toISOString() });
    }
    if (b.lockoutMaxAttempts !== undefined && (b.lockoutMaxAttempts < 3 || b.lockoutMaxAttempts > 20)) {
      return res.status(400).json({ success: false, message: 'lockoutMaxAttempts must be 3–20', timestamp: new Date().toISOString() });
    }
    Object.assign(mockSettings, b, { updatedAt: new Date().toISOString() });
    res.json({ success: true, data: { ...mockSettings }, timestamp: new Date().toISOString() });
  });

  // ==========================================================================
  // RBAC ACCESS LEVELS (Nest parity: RbacService.getAccessLevels shape)
  // ==========================================================================
  let mockAccessLevelSeq = 5;
  const mockAccessLevels = [
    {
      id: 1, code: 'FULL_ACCESS', name: 'Full Access', priority: 1,
      description: 'Unrestricted system administration',
      auto_assign: false, override_allowed: true, status: 'Active',
      roles: ['SYSTEM_ADMIN'],
      default_menus: ['DASHBOARD', 'NURSE_MASTER', 'CREDENTIALS', 'CONTRACT', 'DOCUMENTS', 'NURSE_ROSTER', 'LEAVE_MANAGEMENT', 'WORKFORCE_ANALYTICS', 'USER_MANAGEMENT', 'ROLES_PERMISSIONS', 'EFFECTIVE_ACCESS', 'CACHE_STATS', 'ACCESS_LEVEL_MASTER', 'MENU_MASTER', 'AUDIT_LOGS', 'SYSTEM_SETTINGS'],
      created_at: '2025-01-01T00:00:00.000Z', updated_at: new Date().toISOString(),
    },
    {
      id: 2, code: 'MANAGERIAL', name: 'Managerial', priority: 10,
      description: 'Unit and workforce management (rosters, approvals, staff)',
      auto_assign: false, override_allowed: true, status: 'Active',
      roles: ['NURSE_MANAGER', 'HR_ADMIN'],
      default_menus: ['DASHBOARD', 'NURSE_MASTER', 'CREDENTIALS', 'CONTRACT', 'DOCUMENTS', 'NURSE_ROSTER', 'LEAVE_MANAGEMENT', 'WORKFORCE_ANALYTICS', 'USER_MANAGEMENT', 'EFFECTIVE_ACCESS', 'AUDIT_LOGS'],
      created_at: '2025-01-01T00:00:00.000Z', updated_at: new Date().toISOString(),
    },
    {
      id: 3, code: 'CLINICAL', name: 'Clinical', priority: 20,
      description: 'Bedside clinical staff (own roster, credentials, leave)',
      auto_assign: true, override_allowed: true, status: 'Active',
      roles: ['CHARGE_NURSE', 'RN', 'LPN', 'CNA'],
      default_menus: ['DASHBOARD', 'NURSE_MASTER', 'CREDENTIALS', 'CONTRACT', 'DOCUMENTS', 'NURSE_ROSTER', 'LEAVE_MANAGEMENT'],
      created_at: '2025-01-01T00:00:00.000Z', updated_at: new Date().toISOString(),
    },
    {
      id: 4, code: 'SCHEDULING', name: 'Scheduling', priority: 30,
      description: 'Roster building and leave coordination',
      auto_assign: false, override_allowed: true, status: 'Active',
      roles: ['SCHEDULER', 'COMPLIANCE_OFFICER'],
      default_menus: ['DASHBOARD', 'NURSE_MASTER', 'NURSE_ROSTER', 'LEAVE_MANAGEMENT', 'WORKFORCE_ANALYTICS'],
      created_at: '2025-01-01T00:00:00.000Z', updated_at: new Date().toISOString(),
    },
    {
      id: 5, code: 'READ_ONLY', name: 'Read Only', priority: 100,
      description: 'View-only dashboard access',
      auto_assign: false, override_allowed: false, status: 'Active',
      roles: ['READONLY_USER'],
      default_menus: ['DASHBOARD'],
      created_at: '2025-01-01T00:00:00.000Z', updated_at: new Date().toISOString(),
    },
  ];

  app.get('/api/v1/rbac/access-levels', (req, res) => {
    let rows = mockAccessLevels.slice().sort((a, b) => a.priority - b.priority);
    if (req.query.status) rows = rows.filter((l) => l.status === req.query.status);
    if (req.query.search) {
      const q = String(req.query.search).toLowerCase();
      rows = rows.filter((l) => l.code.toLowerCase().includes(q) || l.name.toLowerCase().includes(q));
    }
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20', 10)));
    const total = rows.length;
    res.json({
      success: true,
      data: {
        items: rows.slice((page - 1) * limit, page * limit),
        pagination: {
          page, limit, total,
          totalPages: Math.max(1, Math.ceil(total / limit)),
          hasNextPage: page * limit < total,
          hasPreviousPage: page > 1,
        },
      },
      timestamp: new Date().toISOString(),
    });
  });

  app.post('/api/v1/rbac/access-levels', (req, res) => {
    const b = req.body || {};
    if (!b.code || !b.name) {
      return res.status(400).json({ success: false, message: 'code and name are required', timestamp: new Date().toISOString() });
    }
    if (mockAccessLevels.some((l) => l.code === b.code || l.name === b.name)) {
      return res.status(409).json({ success: false, message: 'Access level code or name already exists', timestamp: new Date().toISOString() });
    }
    mockAccessLevelSeq += 1;
    const created = {
      id: mockAccessLevelSeq,
      code: b.code,
      name: b.name,
      description: b.description || null,
      priority: b.priority ?? 50,
      auto_assign: b.autoAssign ?? false,
      override_allowed: b.overrideAllowed ?? true,
      status: 'Active',
      roles: b.roles || [],
      default_menus: b.defaultMenus || [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockAccessLevels.push(created);
    res.status(201).json({ success: true, statusCode: 201, data: created, timestamp: new Date().toISOString() });
  });

  return { mockLeaveTypes, mockLeaveRequests, mockAccessLevels, mockSettings };
};
