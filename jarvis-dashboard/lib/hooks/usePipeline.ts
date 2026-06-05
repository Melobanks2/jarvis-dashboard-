'use client';

// Pipeline data comes from GHL via the asaparv-agent server, not this dashboard.
// This hook returns empty data so pipeline sections render gracefully.

export interface Lead {
  id: string;
  contactId: string;
  name: string;
  phone: string;
  address: string;
  tags: string[];
  stage: string;
  createdAt: string;
  updatedAt: string;
  lastChange: string;
  daysInStage: number | null;
  value: number;
  lastNote: string | null;
}

export interface PipelineData {
  stages: Record<string, Lead[]>;
  total: number;
  stageOrder: string[];
}

export function usePipeline(_refreshKey: number) {
  return {
    data:    null as PipelineData | null,
    loading: false,
    error:   null as string | null,
  };
}
