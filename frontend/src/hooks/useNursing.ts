import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { nursingApi } from '../api/client';
import {
  Nurse,
  NurseDetail,
  NurseCredential,
  RosterAssignment,
  NursingLookups,
  NurseListParams,
  RosterListParams,
} from '../types';

/**
 * Hooks for the nursing domain (nurses, credentials, roster).
 * All endpoints are enforced server-side by RbacGuard; these are for data,
 * usePermission() remains responsible for UI gating.
 */

export const useNursingLookups = () =>
  useQuery({
    queryKey: ['nursingLookups'],
    queryFn: async () => {
      const response = await nursingApi.getLookups();
      return response.data.data as NursingLookups;
    },
    staleTime: 10 * 60 * 1000,
  });

// ---------------------------------------------------------------------------
// Nurses
// ---------------------------------------------------------------------------

export const useNurses = (params: NurseListParams) =>
  useQuery({
    queryKey: ['nurses', params],
    queryFn: async () => {
      const response = await nursingApi.getNurses(params);
      return response.data.data as { items: Nurse[]; pagination: any };
    },
    placeholderData: (prev) => prev,
  });

export const useNurse = (id?: number) =>
  useQuery({
    queryKey: ['nurse', id],
    queryFn: async () => {
      const response = await nursingApi.getNurse(id!);
      return response.data.data.nurse as NurseDetail;
    },
    enabled: !!id,
  });

export const useCreateNurse = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: any) => (await nursingApi.createNurse(data)).data.data.nurse as Nurse,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nurses'] });
    },
  });
};

export const useUpdateNurse = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) =>
      (await nursingApi.updateNurse(id, data)).data.data.nurse as Nurse,
    onSuccess: (nurse) => {
      qc.invalidateQueries({ queryKey: ['nurses'] });
      qc.invalidateQueries({ queryKey: ['nurse', nurse.id] });
    },
  });
};

export const useDeleteNurse = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => (await nursingApi.deleteNurse(id)).data.data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nurses'] });
      qc.invalidateQueries({ queryKey: ['roster'] });
      qc.invalidateQueries({ queryKey: ['expiringCredentials'] });
    },
  });
};

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export const useNurseCredentials = (nurseId?: number) =>
  useQuery({
    queryKey: ['nurseCredentials', nurseId],
    queryFn: async () => {
      const response = await nursingApi.getNurseCredentials(nurseId!);
      return response.data.data.items as NurseCredential[];
    },
    enabled: !!nurseId,
  });

export const useExpiringCredentials = (days = 30) =>
  useQuery({
    queryKey: ['expiringCredentials', days],
    queryFn: async () => {
      const response = await nursingApi.getExpiringCredentials(days);
      return response.data.data as { days: number; items: NurseCredential[] };
    },
  });

export const useCreateCredential = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: any) =>
      (await nursingApi.createCredential(data)).data.data.credential as NurseCredential,
    onSuccess: (cred) => {
      qc.invalidateQueries({ queryKey: ['nurseCredentials', cred.nurseId] });
      qc.invalidateQueries({ queryKey: ['nurses'] });
      qc.invalidateQueries({ queryKey: ['expiringCredentials'] });
    },
  });
};

export const useVerifyCredential = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status = 'Valid' }: { id: number; status?: string }) =>
      (await nursingApi.verifyCredential(id, status)).data.data.credential as NurseCredential,
    onSuccess: (cred) => {
      qc.invalidateQueries({ queryKey: ['nurseCredentials', cred.nurseId] });
      qc.invalidateQueries({ queryKey: ['nurses'] });
      qc.invalidateQueries({ queryKey: ['expiringCredentials'] });
    },
  });
};

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

export const useRoster = (params: RosterListParams) =>
  useQuery({
    queryKey: ['roster', params],
    queryFn: async () => {
      const response = await nursingApi.getRoster(params);
      return response.data.data as { from: string; to: string; items: RosterAssignment[] };
    },
  });

export const useCreateAssignment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: any) =>
      (await nursingApi.createAssignment(data)).data.data.assignment as RosterAssignment,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roster'] });
      qc.invalidateQueries({ queryKey: ['nurse'] });
    },
  });
};

export const useUpdateAssignment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) =>
      (await nursingApi.updateAssignment(id, data)).data.data.assignment as RosterAssignment,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roster'] });
      qc.invalidateQueries({ queryKey: ['nurse'] });
    },
  });
};

export const useDeleteAssignment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => (await nursingApi.deleteAssignment(id)).data.data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roster'] });
      qc.invalidateQueries({ queryKey: ['nurse'] });
    },
  });
};

// ---------------------------------------------------------------------------
// Shared UI helpers
// ---------------------------------------------------------------------------

export const credentialSummaryMeta: Record<
  string,
  { color: string; label: string }
> = {
  Valid: { color: 'green', label: 'Valid' },
  ExpiringSoon: { color: 'orange', label: 'Expiring Soon' },
  Expired: { color: 'red', label: 'Expired' },
  None: { color: 'default', label: 'None' },
};

export const rosterStatusColor: Record<string, string> = {
  Scheduled: 'blue',
  Confirmed: 'green',
  Completed: 'default',
  Cancelled: 'red',
  Swapped: 'purple',
  NoShow: 'volcano',
};
