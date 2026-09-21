/**
 * InHubFlow standalone version state.
 * External polling has been removed for full independence.
 */

export interface UpdateState {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  checkedAt: string | null;
}

const state: UpdateState = {
  current: process.env.APP_VERSION ?? "1.0.0",
  latest: null,
  updateAvailable: false,
  checkedAt: null,
};

export function getUpdateState(): UpdateState {
  return { ...state };
}

export function scheduleUpdateCheck() {
  // Standalone: no upstream checks.
}
