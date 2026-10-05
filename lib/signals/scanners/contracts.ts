import type { SignalIcpFilters, SignalMonitor, SignalType } from "../schema";

export interface SignalEvidence {
  fingerprint: string;
  sourceType: string;
  sourceId?: string | null;
  sourceUrl?: string | null;
  occurredAt?: string | null;
  snippet?: string | null;
  metadata?: Record<string, unknown>;
}

export interface DiscoveredSignalLead {
  linkedinUrl: string;
  providerId?: string | null;
  fullName: string;
  firstName?: string | null;
  lastName?: string | null;
  headline?: string | null;
  company?: string | null;
  location?: string | null;
  companySize?: string | number | null;
  profileImageUrl?: string | null;
  signalType: SignalType | string;
  evidence: SignalEvidence;
}

export interface SignalScanCursor {
  cursor?: string | null;
  [key: string]: unknown;
}

export interface SignalScanDiagnostics {
  candidatesSeen: number;
  candidatesEmitted: number;
  articlesSeen?: number;
  articlesAccepted?: number;
  rejected?: Record<string, number>;
  query?: string;
}

export interface SignalScanResult {
  leads: DiscoveredSignalLead[];
  cursor?: SignalScanCursor | null;
  capability?: string;
  diagnostics?: SignalScanDiagnostics;
}

export interface SignalScannerContext {
  monitor: SignalMonitor;
  remoteAccountId: string;
  userIdentifier?: string | null;
  icp: SignalIcpFilters;
  keywords: string[];
  cursor: SignalScanCursor | null;
  limit: number;
  hasSalesNavigator: boolean;
  /** Cooperative cancellation for one-off Ask AI research. */
  shouldAbort?: () => boolean;
}

export class SignalScanError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_configuration" | "unsupported_capability" | "provider_error" | "no_results",
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "SignalScanError";
  }
}
