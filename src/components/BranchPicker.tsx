'use client';
/**
 * Chooses which location the administration screens act on.
 *
 * Hidden entirely while only one branch exists: a dropdown with a single
 * option is noise on every screen, every day, for the restaurant that never
 * opens a second location.
 */
import {Building2} from 'lucide-react';
import {useBranchId, useBranches, setBranchId} from '@/lib/branch';

export default function BranchPicker() {
  const branchId = useBranchId();
  const {branches} = useBranches();

  if (!branches || branches.length < 2) return null;

  return (
    <label className="branch-picker">
      <span className="sr-only">Location</span>
      <Building2 size={15} aria-hidden />
      <select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
        {branches.map((branch) => (
          <option key={branch.id} value={branch.id}>
            {branch.name}
            {branch.enabled ? '' : ' (closed)'}
          </option>
        ))}
      </select>
    </label>
  );
}
