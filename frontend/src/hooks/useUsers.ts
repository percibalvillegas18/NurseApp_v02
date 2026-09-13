import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import {
  ManagedUser,
  UserListParams,
  UserLookups,
  LoginHistoryItem,
  UserSession,
  CreateUserPayload,
} from '../types';

/** React Query hooks for User Management (Administration -> User Management). */

export function useUsers(params: UserListParams) {
  return useQuery<{ items: ManagedUser[]; total: number; page: number; limit: number }>({
    queryKey: ['managedUsers', params],
    queryFn: async () => (await apiClient.get('/users', { params })).data.data,
  });
}

export function useUserLookups() {
  return useQuery<UserLookups>({
    queryKey: ['userLookups'],
    queryFn: async () => (await apiClient.get('/users/lookups')).data.data,
    staleTime: 5 * 60 * 1000,
  });
}

export function useLoginHistory(userId: number | null) {
  return useQuery<{ userId: number; username: string; items: LoginHistoryItem[] }>({
    queryKey: ['userLoginHistory', userId],
    queryFn: async () => (await apiClient.get(`/users/${userId}/login-history`)).data.data,
    enabled: userId !== null,
  });
}

export function useUserSessions(userId: number | null) {
  return useQuery<{ userId: number; items: UserSession[] }>({
    queryKey: ['userSessions', userId],
    queryFn: async () => (await apiClient.get(`/users/${userId}/sessions`)).data.data,
    enabled: userId !== null,
  });
}

function useInvalidatingMutation(fn: (payload: any) => Promise<any>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['managedUsers'] }),
  });
}

export function useCreateUser() {
  return useInvalidatingMutation(async (payload: CreateUserPayload) =>
    (await apiClient.post('/users', payload)).data.data,
  );
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Record<string, unknown> }) =>
      (await apiClient.patch(`/users/${id}`, data)).data.data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['managedUsers'] }),
  });
}

export function useSetUserStatus() {
  return useInvalidatingMutation(async ({ id, status }: { id: number; status: string }) =>
    (await apiClient.post(`/users/${id}/status`, { status })).data.data,
  );
}

export function useResetUserPassword() {
  return useInvalidatingMutation(async ({ id, password }: { id: number; password: string }) =>
    (await apiClient.post(`/users/${id}/reset-password`, { password })).data.data,
  );
}

export function useUnlockUser() {
  return useInvalidatingMutation(async (id: number) =>
    (await apiClient.post(`/users/${id}/unlock`)).data.data,
  );
}
