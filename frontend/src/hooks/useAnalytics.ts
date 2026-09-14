import { useQuery } from '@tanstack/react-query';
import { analyticsApi } from '../api/client';
import {
  AnalyticsSummary,
  AnalyticsCredentials,
  AnalyticsContracts,
  AnalyticsRoster,
  AnalyticsLeave,
} from '../types';

/**
 * Hooks for workforce analytics. The mock computes everything live from the
 * in-memory roster/leave/credential/contract arrays, so a short staleTime
 * keeps the dashboard honest without refetching on every render.
 */

const STALE = 60 * 1000;

export const useAnalyticsSummary = (enabled = true) =>
  useQuery({
    queryKey: ['analyticsSummary'],
    queryFn: async () => {
      const response = await analyticsApi.getSummary();
      return response.data.data as AnalyticsSummary;
    },
    staleTime: STALE,
    enabled,
  });

export const useAnalyticsCredentials = (enabled = true) =>
  useQuery({
    queryKey: ['analyticsCredentials'],
    queryFn: async () => {
      const response = await analyticsApi.getCredentials();
      return response.data.data as AnalyticsCredentials;
    },
    staleTime: STALE,
    enabled,
  });

export const useAnalyticsContracts = (enabled = true) =>
  useQuery({
    queryKey: ['analyticsContracts'],
    queryFn: async () => {
      const response = await analyticsApi.getContracts();
      return response.data.data as AnalyticsContracts;
    },
    staleTime: STALE,
    enabled,
  });

export const useAnalyticsRoster = (params: { from?: string; to?: string; unitId?: number } = {}, enabled = true) =>
  useQuery({
    queryKey: ['analyticsRoster', params],
    queryFn: async () => {
      const response = await analyticsApi.getRoster(params);
      return response.data.data as AnalyticsRoster;
    },
    staleTime: STALE,
    enabled,
  });

export const useAnalyticsLeave = (year?: string, enabled = true) =>
  useQuery({
    queryKey: ['analyticsLeave', year ?? 'current'],
    queryFn: async () => {
      const response = await analyticsApi.getLeave(year);
      return response.data.data as AnalyticsLeave;
    },
    staleTime: STALE,
    enabled,
  });

/** Render helper: { label: count } rows sorted by count desc for small tables. */
export const breakdownRows = (obj?: Record<string, number>) =>
  Object.entries(obj || {})
    .map(([label, count]) => ({ key: label, label, count }))
    .sort((a, b) => b.count - a.count);
