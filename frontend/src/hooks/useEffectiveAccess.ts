import { useQuery, useMutation } from '@tanstack/react-query';
import { rbacApi } from '../api/client';
import { useAuth } from './useAuth';
import { Menu, EvaluateAccessResponse } from '../types';

/**
 * Core hook for RBAC effective access
 * Mirrors backend rbac.evaluate_access() logic on frontend for UI hiding
 * NOTE: Backend guard is authoritative - this is for UX only
 */

export const useAccessibleMenus = () => {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['accessibleMenus', user?.id],
    queryFn: async () => {
      const response = await rbacApi.getMenuHierarchy(true);
      return response.data.data.menus as Menu[];
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000, // 5 min - matches backend cache TTL for ALLOW
  });
};

export const useUserFullAccess = (userId?: number) => {
  const { user } = useAuth();
  const targetId = userId || user?.id;

  return useQuery({
    queryKey: ['fullAccess', targetId],
    queryFn: async () => {
      const response = await rbacApi.getEffectiveAccess(targetId!);
      return response.data.data;
    },
    enabled: !!targetId,
    staleTime: 5 * 60 * 1000,
  });
};

export const useEvaluateAccess = () => {
  return useMutation({
    mutationFn: async ({
      userId,
      menuCode,
      permissionCode,
      resourceId,
    }: {
      userId: number;
      menuCode: string;
      permissionCode: string;
      resourceId?: number;
    }) => {
      const response = await rbacApi.evaluateAccess(userId, {
        menuCode,
        permissionCode,
        resourceId,
      });
      return response.data.data as EvaluateAccessResponse;
    },
  });
};

/**
 * Hook to check if current user has specific permission
 * Usage:
 * const { canView, canEdit, isLoading } = usePermission('NURSE_MASTER', 'EDIT');
 * if (!canView) return <AccessDenied />
 */
export const usePermission = (menuCode: string, permissionCode: string, resourceId?: number) => {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ['evaluateAccess', user?.id, menuCode, permissionCode, resourceId],
    queryFn: async () => {
      if (!user) return null;
      const response = await rbacApi.evaluateAccess(user.id, {
        menuCode,
        permissionCode,
        resourceId,
      });
      return response.data.data as EvaluateAccessResponse;
    },
    enabled: !!user && !!menuCode && !!permissionCode,
    staleTime: 60 * 1000, // 1 min for permission checks
  });

  return {
    allowed: query.data?.decision.allowed ?? false,
    decision: query.data?.decision,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    // Shorthands
    canView: menuCode ? query.data?.decision.allowed : false,
  };
};

/**
 * Hook to check multiple permissions at once
 */
export const usePermissions = (
  checks: Array<{ menuCode: string; permissionCode: string; resourceId?: number }>
) => {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['evaluateMultiple', user?.id, checks],
    queryFn: async () => {
      if (!user) return [];
      const results = await Promise.all(
        checks.map(async (check) => {
          const response = await rbacApi.evaluateAccess(user.id, check);
          return {
            ...check,
            result: response.data.data as EvaluateAccessResponse,
          };
        })
      );
      return results;
    },
    enabled: !!user && checks.length > 0,
    staleTime: 60 * 1000,
  });
};

/**
 * Hook for previewing access change impact (admin only)
 */
export const usePreviewAccessChange = () => {
  return useMutation({
    mutationFn: async ({
      userId,
      changeType,
      menuId,
      permissionId,
      proposedAllowed,
    }: {
      userId: number;
      changeType: string;
      menuId: number;
      permissionId?: number;
      proposedAllowed?: boolean;
    }) => {
      const response = await rbacApi.previewAccessChange(userId, {
        changeType,
        menuId,
        permissionId,
        proposedAllowed,
      });
      return response.data.data;
    },
  });
};
