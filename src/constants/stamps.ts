import { StampType } from '../types';

export interface StampTemplate {
  type: StampType;
  label: string;
  color: string;
  defaultStyle: 'classic' | 'solid' | 'outline';
  defaultRotation: number;
}

export const STAMP_TEMPLATES: StampTemplate[] = [
  { type: 'APPROVED', label: 'APPROVED', color: '#10b981', defaultStyle: 'classic', defaultRotation: 0 },
  { type: 'CONFIDENTIAL', label: 'CONFIDENTIAL', color: '#ef4444', defaultStyle: 'classic', defaultRotation: -8 },
  { type: 'DRAFT', label: 'DRAFT', color: '#f59e0b', defaultStyle: 'outline', defaultRotation: 0 },
  { type: 'FINAL', label: 'FINAL', color: '#3b82f6', defaultStyle: 'solid', defaultRotation: 0 },
  { type: 'REVISED', label: 'REVISED', color: '#8b5cf6', defaultStyle: 'classic', defaultRotation: 0 },
  { type: 'SIGN_HERE', label: 'SIGN HERE', color: '#06b6d4', defaultStyle: 'solid', defaultRotation: 0 },
  { type: 'VOID', label: 'VOID', color: '#64748b', defaultStyle: 'outline', defaultRotation: -10 },
  { type: 'CUSTOM', label: 'PAID', color: '#059669', defaultStyle: 'classic', defaultRotation: -6 },
];

export function calculateStampDimensions(label: string, hasMeta: boolean = true): { width: number; height: number } {
  const clean = (label || 'STAMP').trim();
  const estimatedWidth = Math.max(128, Math.min(280, Math.round(clean.length * 10.5 + 36)));
  const height = hasMeta ? 50 : 40;
  return { width: estimatedWidth, height };
}
