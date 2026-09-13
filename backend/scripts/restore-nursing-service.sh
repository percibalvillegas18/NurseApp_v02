#!/usr/bin/env bash
# Restore nursing.service.ts from last good commit and apply contract guard.
# Run from repo root: bash backend/scripts/restore-nursing-service.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

echo "Checking out nursing.service.ts from c903bc8..."
git checkout c903bc8 -- backend/src/modules/nursing/nursing.service.ts

python3 << 'PY'
from pathlib import Path

path = Path("backend/src/modules/nursing/nursing.service.ts")
text = path.read_text()

old_create = """  async createRosterAssignment(dto: CreateRosterAssignmentDto, actorId: number) {
    await this.validateRosterAssignmentScope(dto, actorId);
    try {
      const created = await this.prisma.nursing_roster_assignments.create({"""

new_create = """  async createRosterAssignment(dto: CreateRosterAssignmentDto, actorId: number) {
    await this.validateRosterAssignmentScope(dto, actorId);
    await this.assertNurseHasValidContract(dto.nurse_id, dto.assignment_date);
    try {
      const created = await this.prisma.nursing_roster_assignments.create({"""

if old_create not in text:
    raise SystemExit("createRosterAssignment pattern not found — already patched or unexpected file")
text = text.replace(old_create, new_create, 1)

old_update = """  async updateRosterAssignment(id: number, dto: UpdateRosterAssignmentDto, actorId: number) {
    const existing = await this.assertRosterScope(id, actorId);
    await this.validateRosterAssignmentScope({ ...existing, ...dto }, actorId);
    try {
      const updated = await this.prisma.nursing_roster_assignments.update({"""

new_update = """  async updateRosterAssignment(id: number, dto: UpdateRosterAssignmentDto, actorId: number) {
    const existing = await this.assertRosterScope(id, actorId);
    await this.validateRosterAssignmentScope({ ...existing, ...dto }, actorId);
    const nurseId = dto.nurse_id !== undefined ? dto.nurse_id : Number(existing.nurse_id);
    const onDate =
      dto.assignment_date !== undefined
        ? dto.assignment_date
        : existing.assignment_date;
    await this.assertNurseHasValidContract(nurseId, onDate);
    try {
      const updated = await this.prisma.nursing_roster_assignments.update({"""

text = text.replace(old_update, new_update, 1)

helper = """  /**
   * Blocks roster create/update when the nurse has no Active employment contract
   * covering the assignment date (nursing.nurse_has_valid_contract).
   */
  private async assertNurseHasValidContract(
    nurseId: number,
    assignmentDate: Date | string,
  ): Promise<void> {
    const onDate = this.toDateOnly(assignmentDate);
    try {
      const rows = await this.prisma.$queryRawUnsafe<Array<{ ok: boolean }>>(
        `SELECT nursing.nurse_has_valid_contract($1::bigint, $2::date) AS ok`,
        nurseId,
        onDate,
      );
      if (!rows?.[0]?.ok) {
        throw new ConflictException(
          `Nurse #${nurseId} has no valid Active employment contract covering ${onDate}. Update Contract Master before rostering.`,
        );
      }
    } catch (e: any) {
      if (e instanceof ConflictException) throw e;
      this.logger.warn(
        `Contract validity check skipped (nurse #${nurseId}, ${onDate}): ${e?.message || e}`,
      );
    }
  }

  private toDateOnly"""

if "private async assertNurseHasValidContract" not in text:
    text = text.replace("  private toDateOnly", helper, 1)

path.write_text(text)
print("Patched", path, "->", path.stat().st_size, "bytes")
PY

git add backend/src/modules/nursing/nursing.service.ts
echo ""
echo "Done. Review and push:"
echo "  git commit -m 'fix(nursing): restore service + nurse_has_valid_contract on roster'"
echo "  git push origin main"
