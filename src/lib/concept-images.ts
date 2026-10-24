export const conceptImageMaxInput = 2 * 1024 * 1024;
export const conceptImageMaxOutput = 3 * 1024 * 1024;
export type ConceptImage = {
  id: string;
  workspaceId: string;
  studyId: string;
  createdAt: string;
  bytes: number;
  width: number;
  height: number;
  digest: string;
  sourceAssetId?: string;
  watermarkAssetId?: string;
  watermarkVersion?: string;
};
