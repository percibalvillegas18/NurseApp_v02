import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { leaveApi } from '../api/client';
import { LeaveType, LeaveNurseBalance, LeaveRequest, LeaveListParams } from '../types';

/**
 * Hooks for leave management (types, balances, request lifecycle).
 * Server validates overlap, balances and transitions; mutations surface
 * 400/404/409 messages to the page via onError.
 */

export const useLeaveTypes = (enabled = true) =>
  useQuery({
    queryKey: ['leaveTypes'],
    queryFn: async () => {
      const response = await leaveApi.getTypes();
      return response.data.data as LeaveType[];
    },
    staleTime: 10 * 60 * 1000,
    enabled,
  });

export const useLeaveBalances = (nurseId?: number, enabled = true) =>
  useQuery({
    queryKey: ['leaveBalances', nurseId ?? 'all'],
    queryFn: async () => {
      const response = await leaveApi.getBalances(nurseId);
      return response.data.data.items as LeaveNurseBalance[];
    },
    enabled,
  });

export const useLeaveRequests = (params: LeaveListParams, enabled = true) =>
  useQuery({
    queryKey: ['leaveRequests', params],
    queryFn: async () => {
      const response = await leaveApi.getRequests(params);
      return response.data.data as { items: LeaveRequest[]; pagination: any };
    },
    placeholderData: (prev) => prev,
    enabled,
  });

export const useLeaveRequest = (id?: number | null) =>
  useQuery({
    queryKey: ['leaveRequest', id],
    queryFn: async () => {
      const response = await leaveApi.getRequest(id!);
      return response.data.data as LeaveRequest;
    },
    enabled: !!id,
  });

const invalidateLeave = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ['leaveRequests'] });
  qc.invalidateQueries({ queryKey: ['leaveRequest'] });
  qc.invalidateQueries({ queryKey: ['leaveBalances'] });
  qc.invalidateQueries({ queryKey: ['analyticsLeave'] });
  qc.invalidateQueries({ queryKey: ['analyticsSummary'] });
};

export const useCreateLeaveRequest = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: any) => {
      const res = await leaveApi.createRequest(data);
      return res.data.data as { request: LeaveRequest; warnings: string[] };
    },
    onSuccess: () => invalidateLeave(qc),
  });
};

export const useUpdateLeaveRequest = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) =>
      (await leaveApi.updateRequest(id, data)).data.data as LeaveRequest,
    onSuccess: () => invalidateLeave(qc),
  });
};

export const useLeaveAction = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, action, note }: { id: number; action: 'submit' | 'approve' | 'reject' | 'cancel'; note?: string }) => {
      const calls = {
        submit: () => leaveApi.submitRequest(id),
        approve: () => leaveApi.approveRequest(id, note),
        reject: () => leaveApi.rejectRequest(id, note || ''),
        cancel: () => leaveApi.cancelRequest(id, note),
      };
      const res = await calls[action]();
      return { action, request: res.data.data as LeaveRequest };
    },
    onSuccess: () => invalidateLeave(qc),
  });
};

export const leaveStatusColor: Record<string, string> = {
  Draft: 'default',
  Submitted: 'processing',
  Approved: 'success',
  Rejected: 'error',
  Cancelled: 'warning',
};
