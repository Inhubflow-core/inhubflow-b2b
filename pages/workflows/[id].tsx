import Head from "next/head";
import { useState, useEffect, useCallback } from "react";
import { GetServerSideProps } from "next";
import { useRouter } from "next/router";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { toast } from "sonner";
import { OrModel } from "@/components/ui/ModelPicker";
import FilterBar, { ActiveFilter, filtersToParams, FILTER_FIELDS } from "@/components/ui/FilterBar";
import { StepAttachmentPicker } from "@/components/ui/StepAttachmentPicker";
import { useTranslation } from "@/lib/i18n/LanguageContext";
import {
  RiArrowLeftLine,
  RiAddLine,
  RiDeleteBinLine,
  RiPlayLine,
  RiPauseLine,
  RiStopLine,
  RiEyeLine,
  RiLinkedinBoxLine,
  RiMessage2Line,
  RiSendPlaneLine,
  RiTimeLine,
  RiArrowRightLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiMailSendLine,
  RiMailLine,
  RiEditLine,
  RiRobot2Line,
  RiSearchLine,
  RiLoader4Line,
  RiUser3Line,
  RiUserFollowLine,
  RiArrowDownSLine,
  RiRefreshLine,
  RiErrorWarningLine,
  RiFlashlightLine,
  RiCheckLine,
  RiCloseLine,
  RiRocketLine,
  RiGroupLine,
  RiSparklingLine,
} from "react-icons/ri";

// ─── Types ────────────────────────────────────────────────────────────────────

type StepType = "visit" | "follow" | "connect" | "message" | "sales_inmail" | "delay" | "email";
type Track = "linkedin" | "email";

interface Step {
  id: string;
  step_order: number;
  track: Track;
  step_type: StepType;
  template_id: string | null;
  template_name: string | null;
  template_ids: string[];
  template_names: string[];
  delay_seconds: number;
  connect_note: string | null;
  message_body: string | null;
  email_subject: string | null;
  email_body: string | null;
  attachment_url?: string | null;
  attachment_name?: string | null;
  attachment_type?: string | null;
  attachment_size?: number | null;
}

interface WorkflowData {
  id: string;
  name: string;
  description: string | null;
  prompt: string | null;
  steps: Step[];
  active_run: {
    id: string;
    status: string;
    list_id?: string;
    list_name: string;
    account_name: string;
  } | null;
}

interface Stats {
  total_prospects: number;
  active_prospects: number;
  completed_prospects: number;
  failed_prospects: number;
  connections_sent: number;
  connections_accepted: number;
  acceptance_rate: number;
  messages_sent: number;
  inmails_sent: number;
  emails_sent: number;
  active_run: {
    id: string;
    status: string;
    list_id?: string;
    list_name: string;
    account_name: string;
  } | null;
}

interface Prospect {
  id: string;
  run_id: string;
  target_id: string;
  full_name: string | null;
  title: string | null;
  company: string | null;
  linkedin_url: string;
  state: string;
  current_step: number;
  step_type: string | null;
  step_track: string | null;
  li_step_type: string | null;
  em_step_type: string | null;
  next_step_at: string | null;
  error_message: string | null;
  degree: number | null;
  connection_requested_at: string | null;
  connected_at: string | null;
  message_sent_at: string | null;
}

interface List {
  id: string;
  name: string;
  target_count?: number;
}

interface Account {
  id: string;
  name: string;
  is_authenticated: number;
  daily_connection_limit: number;
  daily_message_limit: number;
  daily_inmail_limit: number;
  connections_today: number;
  messages_today: number;
  inmails_today: number;
}

interface Template {
  id: string;
  name: string;
}

interface EmailAccount {
  id: string;
  name: string;
  from_email: string;
  is_verified: number;
  signature?: string | null;
  active_run_count: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STEP_ICONS: Record<string, React.ReactNode> = {
  visit: <RiEyeLine size={15} />,
  follow: <RiUserFollowLine size={15} />,
  connect: <RiLinkedinBoxLine size={15} />,
  message: <RiMessage2Line size={15} />,
  sales_inmail: <RiSendPlaneLine size={15} />,
  delay: <RiTimeLine size={15} />,
  email: <RiMailLine size={15} />,
};

// Static base labels fallback
const STEP_LABELS: Record<string, string> = {
  visit: "Visit Profile",
  follow: "Follow Profile",
  connect: "LinkedIn Connect",
  message: "LinkedIn Message",
  sales_inmail: "Sales Nav InMail",
  email: "Cold Email",
};

function getStepLabel(type: string, t?: (key: string, params?: any) => string): string {
  if (t) {
    if (type === "visit") return t("campaignWizard.steps.visit");
    if (type === "follow") return t("campaignWizard.steps.follow");
    if (type === "connect") return t("campaignWizard.steps.connect");
    if (type === "message") return t("campaignWizard.steps.message");
    if (type === "sales_inmail") return t("campaignWizard.steps.salesInmail");
    if (type === "email") return t("campaignWizard.steps.email");
  }
  return STEP_LABELS[type] ?? type;
}

// Returns dynamic label for an email step based on its position among all email steps
function getEmailStepLabel(wizardSteps: Array<{ type: string }>, idx: number, t?: (key: string, params?: any) => string): string {
  const emailIndices = wizardSteps.map((s, i) => s.type === "email" ? i : -1).filter(i => i !== -1);
  const emailPos = emailIndices.indexOf(idx);
  if (emailPos === 0) return t ? t("campaignWizard.steps.coldEmail") : "Cold Email";
  return t ? t("campaignWizard.steps.followUpNumber", { num: emailPos + 1 }) : `Follow-up #${emailPos + 1}`;
}

// Returns dynamic label for a message step based on its position among all message steps
function getMessageStepLabel(wizardSteps: Array<{ type: string }>, idx: number, t?: (key: string, params?: any) => string): string {
  const msgIndices = wizardSteps.map((s, i) => s.type === "message" ? i : -1).filter(i => i !== -1);
  const msgPos = msgIndices.indexOf(idx);
  if (msgPos === 0) return t ? t("campaignWizard.steps.message") : "LinkedIn Message";
  return t ? t("campaignWizard.steps.messageFollowUp", { num: msgPos + 1 }) : `LinkedIn Follow-up #${msgPos + 1}`;
}

const AI_LANGUAGES = [
  "English", "Agent decides", "German", "French", "Spanish", "Italian",
  "Portuguese", "Dutch", "Polish", "Swedish", "Danish", "Norwegian",
  "Finnish", "Arabic", "Japanese", "Chinese", "Korean",
];

const STEP_COLORS: Record<string, string> = {
  visit: "bg-info/10 text-info border-info/20",
  follow: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  connect: "bg-primary/10 text-primary border-primary/20",
  message: "bg-success/10 text-success border-success/20",
  sales_inmail: "bg-primary/10 text-primary border-primary/20",
  email: "bg-warning/10 text-warning border-warning/20",
};


const VARIABLES = ["{{first_name}}", "{{last_name}}", "{{company}}", "{{title}}"];

const STATE_PILL: Record<string, string> = {
  pending: "bg-base-300 text-base-content/50",
  in_progress: "bg-info/15 text-info",
  completed: "bg-success/15 text-success",
  failed: "bg-error/15 text-error",
  skipped: "bg-base-300/60 text-base-content/30",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseUtcDate(dateStr: string): Date {
  if (!dateStr) return new Date();
  const normalized = dateStr.includes("T")
    ? (dateStr.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(dateStr) ? dateStr : `${dateStr}Z`)
    : `${dateStr.replace(" ", "T")}Z`;
  return new Date(normalized);
}

function formatNextAction(next_step_at: string | null, state: string, t?: (key: string, params?: any) => string): string {
  if (state === "completed" || state === "failed" || state === "skipped") return "—";
  if (!next_step_at) return t ? t("campaignDetail.idle") : "Soon";
  const diff = parseUtcDate(next_step_at).getTime() - Date.now();
  if (diff <= 60_000) return "Ahora";
  const hours = diff / 3600_000;
  if (hours < 1) return `en ${Math.max(1, Math.round(diff / 60_000))}m`;
  if (hours < 24) return `en ${Math.round(hours)}h`;
  return `en ${Math.round(hours / 24)}d`;
}

// ─── Server-side ──────────────────────────────────────────────────────────────

export const getServerSideProps: GetServerSideProps = async ({ params, query }) => {
  const db = getDb();
  const id = params?.id as string;
  const workflow = db.prepare("SELECT * FROM workflows WHERE id = ?").get(id);
  if (!workflow) return { notFound: true };

  const rawSteps = db
    .prepare(
      `SELECT ws.*, t.name as template_name
       FROM workflow_steps ws
       LEFT JOIN templates t ON t.id = ws.template_id
       WHERE ws.workflow_id = ? ORDER BY ws.track, ws.step_order`
    )
    .all(id);

  const getStepTemplates = db.prepare(
    `SELECT wst.template_id, t.name FROM workflow_step_templates wst JOIN templates t ON t.id = wst.template_id WHERE wst.step_id = ?`
  );
  const steps = (rawSteps as Array<Record<string, unknown>>).map((s) => {
    const rows = getStepTemplates.all(s.id) as Array<{ template_id: string; name: string }>;
    return { ...s, template_ids: rows.map((r) => r.template_id), template_names: rows.map((r) => r.name) };
  });

  const activeRun = db
    .prepare(
      `SELECT r.id, r.status, r.list_id, l.name as list_name, a.name as account_name
       FROM runs r
       LEFT JOIN lists l ON l.id = r.list_id
       LEFT JOIN accounts a ON a.id = r.account_id
       WHERE r.workflow_id = ? AND r.status IN ('running','paused')
       LIMIT 1`
    )
    .get(id) as { id: string; status: string; list_id: string; list_name: string; account_name: string } | undefined;

  const lists = db
    .prepare(
      `SELECT l.id, l.name, COUNT(lt.target_id) as target_count
       FROM lists l LEFT JOIN list_targets lt ON lt.list_id = l.id
       GROUP BY l.id ORDER BY l.name`
    )
    .all();
  const accounts = db
    .prepare(
      `SELECT a.id, a.name, a.is_authenticated, a.daily_connection_limit, a.daily_message_limit, a.daily_inmail_limit,
         (SELECT COUNT(*) FROM logs l JOIN runs r ON r.id = l.run_id
          WHERE r.account_id = a.id AND l.message LIKE 'Connection request sent%' AND date(l.created_at) = date('now')) as connections_today,
         (SELECT COUNT(*) FROM logs l JOIN runs r ON r.id = l.run_id
          WHERE r.account_id = a.id AND l.message LIKE 'Message sent%' AND date(l.created_at) = date('now')) as messages_today,
         (SELECT COUNT(*) FROM logs l JOIN runs r ON r.id = l.run_id
          WHERE r.account_id = a.id AND l.message LIKE 'InMail sent%' AND date(l.created_at) = date('now')) as inmails_today
       FROM accounts a ORDER BY a.name`
    )
    .all();

  const templates = db.prepare("SELECT id, name FROM templates ORDER BY name").all();
  const emailAccounts = db.prepare(`
    SELECT ea.id, ea.name, ea.from_email, ea.is_verified, ea.signature,
           (SELECT COUNT(DISTINCT rp.run_id) FROM run_profiles rp
            JOIN runs r ON rp.run_id = r.id
            WHERE rp.email_account_id = ea.id
            AND r.status IN ('running', 'paused')) AS active_run_count
    FROM email_accounts ea ORDER BY ea.name
  `).all();

  // Email accounts currently assigned to the active run's profiles (locked during edit)
  const activeRunEmailAccountIds: string[] = activeRun
    ? (db.prepare(
        `SELECT DISTINCT email_account_id FROM run_profiles WHERE run_id = ? AND email_account_id IS NOT NULL`
      ).all(activeRun.id) as Array<{ email_account_id: string }>).map((r) => r.email_account_id)
    : [];

  return {
    props: {
      workflow: { ...(workflow as object), steps, active_run: activeRun ?? null },
      lists,
      accounts,
      templates,
      emailAccounts,
      activeRunEmailAccountIds,
      // auto-open wizard if ?setup=1 (redirected from create)
      autoSetup: query.setup === "1",
    },
  };
};

// ─── Wizard ───────────────────────────────────────────────────────────────────

type WizardPage = "prospects" | "prompt" | "linkedin-steps" | "email-steps" | "account" | "summary";

interface WizardStep {
  track: Track;
  type: "visit" | "follow" | "connect" | "message" | "sales_inmail" | "email";
  delayDaysBefore: number; // delay before this step (0 for first step within its track)
  connectNote: string;
  messageBody: string;
  templateId: string | null;       // legacy single-template (kept for backwards compat)
  templateIds: string[];            // multi-template pool for A/B
  emailSubject: string;
  emailBody: string;
  emailSignature: string | null; // null = use email account default
  // AI mode
  aiEnabled: boolean;
  aiModel: string;
  aiPrompt: string;
  aiMaxWordsEnabled: boolean;
  aiMaxWords: number;
  aiLanguage: string;
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  attachmentType?: string | null;
  attachmentSize?: number | null;
}

function buildWizardSteps(steps: Step[]): WizardStep[] {
  const result: WizardStep[] = [];
  // Track pending delays per track independently
  const pendingDelay: Record<string, number> = { linkedin: 0, email: 0 };
  for (const s of steps) {
    const track: Track = s.track ?? (s.step_type === "email" ? "email" : "linkedin");
    if (s.step_type === "delay") {
      pendingDelay[track] = Math.round(s.delay_seconds / 86400);
    } else {
      const raw = s as unknown as Record<string, unknown>;
      result.push({
        track,
        type: s.step_type as "visit" | "follow" | "connect" | "message" | "sales_inmail" | "email",
        delayDaysBefore: pendingDelay[track] ?? 0,
        connectNote: s.connect_note ?? "",
        messageBody: s.message_body ?? "",
        templateId: s.template_id ?? null,
        templateIds: s.template_ids ?? [],
        emailSubject: s.email_subject ?? "",
        emailBody: s.email_body ?? "",
        emailSignature: raw.email_signature != null ? (raw.email_signature as string) : null,
        aiEnabled: !!raw.ai_enabled,
        aiModel: (raw.ai_model as string) ?? "",
        aiPrompt: (raw.ai_prompt as string) ?? "",
        aiMaxWordsEnabled: !!(raw.ai_max_words),
        aiMaxWords: (raw.ai_max_words as number) ?? 100,
        aiLanguage: (raw.ai_language as string) ?? "English",
        attachmentUrl: (raw.attachment_url as string) || null,
        attachmentName: (raw.attachment_name as string) || null,
        attachmentType: (raw.attachment_type as string) || null,
        attachmentSize: (raw.attachment_size as number) || null,
      });
      pendingDelay[track] = 0;
    }
  }
  return result;
}

interface ListTarget {
  id: string;
  full_name: string | null;
  title: string | null;
  company: string | null;
  linkedin_url: string;
}

// ─── ModelPicker (wizard-local, controlled open state for single-dropdown behavior) ──

interface ModelPickerProps {
  models: OrModel[];
  value: string;
  open: boolean;
  search: string;
  collapsedProviders: Set<string>;
  onOpen: () => void;
  onClose: () => void;
  onSelect: (id: string) => void;
  onSearch: (q: string) => void;
  onToggleProvider: (provider: string) => void;
}

const PROVIDER_DISPLAY: Record<string, string> = {
  google: "Google",
  anthropic: "Anthropic",
  openai: "OpenAI",
  mistral: "Mistral",
  qwen: "Qwen (Alibaba)",
  alibaba: "Alibaba",
};

function ModelPicker({ models, value, open, search, collapsedProviders, onOpen, onClose, onSelect, onSearch, onToggleProvider }: ModelPickerProps) {
  const isSearching = search.trim().length > 0;

  const filtered = models.filter(m =>
    !isSearching || m.name.toLowerCase().includes(search.toLowerCase()) || m.id.toLowerCase().includes(search.toLowerCase())
  );

  const byProvider: Record<string, OrModel[]> = {};
  for (const m of filtered) {
    (byProvider[m.provider] ??= []).push(m);
  }

  const providerOrder = [
    "google", "anthropic", "openai", "mistral", "qwen", "alibaba",
    ...Object.keys(byProvider).filter(p => !["google","anthropic","openai","mistral","qwen","alibaba"].includes(p)).sort(),
  ].filter(p => byProvider[p]);

  const selectedModel = models.find(m => m.id === value);

  return (
    <div className="relative">
      <label className="text-xs text-base-content/40 mb-1 block">Model</label>
      <button
        type="button"
        onClick={onOpen}
        className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-base-300/50 border border-base-300/50 text-sm text-left hover:border-base-300 transition-colors"
      >
        <span className={value ? "text-base-content" : "text-base-content/30"}>
          {selectedModel ? (
            <span className="flex items-center gap-2">
              <span className="text-base-content/40 text-xs">{PROVIDER_DISPLAY[selectedModel.provider] ?? selectedModel.provider}</span>
              <span>{selectedModel.name}</span>
            </span>
          ) : "Select a model…"}
        </span>
        <RiSearchLine size={13} className="text-base-content/30 shrink-0" />
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={onClose} />
          <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-base-300 border border-base-300/80 rounded-xl shadow-xl overflow-hidden">
            {/* Search */}
            <div className="p-2 border-b border-gray-200 dark:border-gray-800">
              <input
                autoFocus
                type="text"
                placeholder="Search models…"
                value={search}
                onChange={(e) => onSearch(e.target.value)}
                className="w-full bg-base-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none placeholder:text-base-content/30"
              />
            </div>

            <div className="max-h-72 overflow-y-auto">
              {models.length === 0 ? (
                <p className="px-3 py-4 text-sm text-base-content/30 text-center">No OpenRouter key configured</p>
              ) : filtered.length === 0 ? (
                <p className="px-3 py-4 text-sm text-base-content/30 text-center">No models match</p>
              ) : (
                providerOrder.map(provider => {
                  const providerModels = byProvider[provider];
                  const isCollapsed = !isSearching && collapsedProviders.has(provider);
                  const displayName = PROVIDER_DISPLAY[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1);
                  return (
                    <div key={provider}>
                      {/* Provider header — clickable to collapse (only when not searching) */}
                      <button
                        type="button"
                        onClick={() => !isSearching && onToggleProvider(provider)}
                        className={`w-full flex items-center justify-between px-3 py-1.5 sticky top-0 bg-base-300/90 backdrop-blur-sm border-b border-gray-200 dark:border-gray-800 ${isSearching ? "cursor-default" : "hover:bg-base-300 cursor-pointer"}`}
                      >
                        <span className="text-[10px] uppercase tracking-wider text-base-content/40 font-semibold">{displayName}</span>
                        {!isSearching && (
                          <span className="text-base-content/30">
                            {isCollapsed ? <RiArrowRightSLine size={13} /> : <RiArrowDownSLine size={13} />}
                          </span>
                        )}
                        {isSearching && (
                          <span className="text-[10px] text-base-content/25">{providerModels.length}</span>
                        )}
                      </button>

                      {/* Models — hidden when collapsed */}
                      {!isCollapsed && providerModels.map(m => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => onSelect(m.id)}
                          className={`w-full text-left px-3 py-2 text-sm transition-colors hover:bg-base-200 ${value === m.id ? "text-primary font-medium" : "text-base-content/80"}`}
                        >
                          {m.name}
                        </button>
                      ))}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Wizard ───────────────────────────────────────────────────────────────────

// mode: "launch" = full new run wizard, "edit" = edit steps+account (no prospects), "steps" = steps only,
// "add-contacts" = prospect-selection only, enroll into existing active run
type WizardMode = "launch" | "edit" | "steps" | "add-contacts";

function Wizard({
  workflowId,
  workflowName: initialWorkflowName,
  initialPrompt,
  initialSteps,
  lists,
  accounts,
  emailAccounts,
  templates,
  editOnly = false,
  mode = "launch",
  activeRunId,
  activeRunListId,
  activeRunEmailAccountIds = [],
  onClose,
  onLaunched,
  onRenamed,
}: {
  workflowId: string;
  workflowName: string;
  initialPrompt: string;
  initialSteps: Step[];
  lists: List[];
  accounts: Account[];
  emailAccounts: EmailAccount[];
  templates: Template[];
  editOnly?: boolean;
  mode?: WizardMode;
  activeRunId?: string | null;
  activeRunListId?: string | null;
  activeRunEmailAccountIds?: string[];
  onClose: () => void;
  onLaunched: () => void;
  onRenamed: (name: string) => void;
}) {
  const { t } = useTranslation();
  const isEditMode = mode === "edit" || editOnly;
  const isStepsOnly = mode === "steps" || (editOnly && mode === "launch");
  const isAddContacts = mode === "add-contacts";
  const [page, setPage] = useState<WizardPage>(isEditMode ? "linkedin-steps" : "prospects");
  const [campaignPrompt, setCampaignPrompt] = useState(initialPrompt);
  const [listId, setListId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [emailAccountIds, setEmailAccountIds] = useState<Set<string>>(new Set(activeRunEmailAccountIds));
  const [conflicts, setConflicts] = useState<{ total: number; blocked: number } | null>(null);
  const [conflictsLoading, setConflictsLoading] = useState(false);
  const [wizardSteps, setWizardSteps] = useState<WizardStep[]>(() => buildWizardSteps(initialSteps));
  const [configIdx, setConfigIdx] = useState<number | null>(null); // which step is being configured
  const [launching, setLaunching] = useState(false);
  const [saving, setSaving] = useState(false);

  // Email preview modal
  const [emailPreviewIdx, setEmailPreviewIdx] = useState<number | null>(null);

  // Test email modal
  const [testEmailIdx, setTestEmailIdx] = useState<number | null>(null);
  const [testEmailTo, setTestEmailTo] = useState("");
  const [testEmailAccountId, setTestEmailAccountId] = useState("");
  const [testEmailSending, setTestEmailSending] = useState(false);

  const [listTargets, setListTargets] = useState<ListTarget[]>([]);
  const [selectedTargetIds, setSelectedTargetIds] = useState<Set<string>>(new Set());
  const [prospectMode, setProspectMode] = useState<"all" | "manual">("all");
  const [listSearch, setListSearch] = useState("");

  // Workflow name editing
  const [workflowName, setWorkflowName] = useState(initialWorkflowName);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(initialWorkflowName);
  const [nameSaving, setNameSaving] = useState(false);

  // AI / OpenRouter models
  const [orModels, setOrModels] = useState<OrModel[]>([]);
  const [orModelSearch, setOrModelSearch] = useState("");
  const [orModelOpen, setOrModelOpen] = useState<number | null>(null); // step idx with open picker
  const [collapsedProviders, setCollapsedProviders] = useState<Set<string>>(new Set()); // collapsed when not searching

  // AI preview modal
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  const [previewListId, setPreviewListId] = useState("");
  const [previewTargetId, setPreviewTargetId] = useState("");
  const [previewListTargets, setPreviewListTargets] = useState<ListTarget[]>([]);
  const [previewResult, setPreviewResult] = useState<{ subject?: string; body: string; input_tokens: number; output_tokens: number; cost_usd: number | null } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  // Stores last preview cost per wizard step index (for summary cost estimation)
  const [stepPreviewCosts, setStepPreviewCosts] = useState<Record<number, { input_tokens: number; output_tokens: number; cost_usd: number }>>({});

  // Open-core: is the AI writer (a premium/ee feature) available in this build?
  const [hasPremium, setHasPremium] = useState(true);
  useEffect(() => {
    fetch("/api/premium-status")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d) setHasPremium(!!d.hasPremium); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!hasPremium) return; // /api/openrouter/models is premium-only
    fetch("/api/openrouter/models")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.models) setOrModels(d.models); })
      .catch(() => {});
  }, [hasPremium]);

  // In add-contacts mode, auto-select the active run's list so the user only picks contacts.
  useEffect(() => {
    if (isAddContacts && activeRunListId && !listId) {
      selectList(activeRunListId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAddContacts, activeRunListId]);

  async function loadPreviewTargets(lId: string) {
    setPreviewListTargets([]);
    setPreviewTargetId("");
    if (!lId) return;
    const r = await fetch(`/api/lists/${lId}`);
    if (r.ok) {
      const d = await r.json();
      setPreviewListTargets(d.targets ?? []);
    }
  }

  async function runPreview() {
    if (previewIdx === null || !previewTargetId) return;
    const ws = wizardSteps[previewIdx];
    setPreviewLoading(true);
    setPreviewResult(null);
    try {
      const r = await fetch("/api/agent/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step_type: ws.type,
          ai_model: ws.aiModel,
          ai_prompt: ws.aiPrompt,
          ai_max_words: ws.aiMaxWordsEnabled ? ws.aiMaxWords : null,
          ai_language: ws.aiLanguage ?? null,
          target_id: previewTargetId,
          campaign_prompt: campaignPrompt || null,
        }),
      });
      const d = await r.json();
      if (!r.ok) { toast.error(d.error ?? "Preview failed"); return; }
      setPreviewResult(d);
      if (d.cost_usd != null && previewIdx !== null) {
        setStepPreviewCosts((prev) => ({
          ...prev,
          [previewIdx]: { input_tokens: d.input_tokens ?? 0, output_tokens: d.output_tokens ?? 0, cost_usd: d.cost_usd },
        }));
      }
    } catch {
      toast.error("Preview failed");
    } finally {
      setPreviewLoading(false);
    }
  }

  const selectedList = lists.find((l) => l.id === listId);
  const selectedAccount = accounts.find((a) => a.id === accountId);
  const selectedEmailAccounts = emailAccounts.filter((e) => emailAccountIds.has(e.id));
  // In add-contacts mode every contact in the list is "active" already (this run) — dedup happens server-side.
  const allBlocked = !isAddContacts && conflicts !== null && conflicts.blocked > 0 && conflicts.blocked >= conflicts.total;
  const hasEmailStep = wizardSteps.some((s) => s.type === "email");
  const hasLinkedInStep = wizardSteps.some((s) => s.type === "visit" || s.type === "follow" || s.type === "connect" || s.type === "message" || s.type === "sales_inmail");

  async function selectList(id: string) {
    setListId(id);
    setConflicts(null);
    setListTargets([]);
    setSelectedTargetIds(new Set());
    setProspectMode("all");
    if (!id) return;
    setConflictsLoading(true);
    const [conflictsRes, targetsRes] = await Promise.all([
      fetch(`/api/lists/${id}/conflicts`),
      fetch(`/api/lists/${id}`),
    ]);
    if (conflictsRes.ok) setConflicts(await conflictsRes.json());
    if (targetsRes.ok) {
      const data = await targetsRes.json();
      const ts: ListTarget[] = data.targets ?? [];
      setListTargets(ts);
      setSelectedTargetIds(new Set(ts.map((t) => t.id)));
    }
    setConflictsLoading(false);
  }

  async function saveWorkflowName() {
    const trimmed = nameValue.trim();
    if (!trimmed || trimmed === workflowName) { setEditingName(false); return; }
    setNameSaving(true);
    const res = await fetch(`/api/workflows/${workflowId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
    if (res.ok) {
      setWorkflowName(trimmed);
      onRenamed(trimmed);
      toast.success("Renamed");
    }
    setNameSaving(false);
    setEditingName(false);
  }

  function toggleTarget(id: string) {
    setSelectedTargetIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAllTargets() {
    if (selectedTargetIds.size === listTargets.length) {
      setSelectedTargetIds(new Set());
    } else {
      setSelectedTargetIds(new Set(listTargets.map((t) => t.id)));
    }
  }

  const hasConnect = wizardSteps.some((s) => s.type === "connect");
  const hasFollow = wizardSteps.some((s) => s.type === "follow");

  async function addWizardStep(type: "visit" | "follow" | "connect" | "message" | "sales_inmail" | "email") {
    const track: Track = type === "email" ? "email" : "linkedin";
    setWizardSteps((prev) => {
      const trackSteps = prev.filter((s) => s.track === track);
      const isFirstInTrack = trackSteps.length === 0;
      const newStep: WizardStep = { track, type, delayDaysBefore: isFirstInTrack ? 0 : 1, connectNote: "", messageBody: "", templateId: null, templateIds: [], emailSubject: "", emailBody: "", emailSignature: null, aiEnabled: false, aiModel: "", aiPrompt: "", aiMaxWordsEnabled: false, aiMaxWords: 100, aiLanguage: "English" };

      if (type === "connect") {
        // Insert before the first linkedin message step
        const firstMsgIdx = prev.findIndex((s) => s.type === "message");
        if (firstMsgIdx !== -1) {
          const inserted = [...prev];
          inserted.splice(firstMsgIdx, 0, newStep);
          return inserted;
        }
      }

      return [...prev, newStep];
    });
  }

  function removeWizardStep(idx: number) {
    setWizardSteps((prev) => prev.filter((_, i) => i !== idx));
    if (configIdx === idx) setConfigIdx(null);
  }

  function updateStep(idx: number, patch: Partial<WizardStep>) {
    setWizardSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }

  // Save steps to DB (replaces all existing steps for this workflow)
  async function saveStepsToDB() {
    setSaving(true);
    // Save campaign prompt alongside steps
    await fetch(`/api/workflows/${workflowId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: campaignPrompt }),
    });
    // Delete all existing steps
    const existing = await fetch(`/api/workflows/${workflowId}/steps`);
    const existingSteps: Step[] = existing.ok ? await existing.json() : [];
    await Promise.all(
      existingSteps.map((s) =>
        fetch(`/api/workflows/${workflowId}/steps/${s.id}`, { method: "DELETE" })
      )
    );
    // Save per-track: each track's steps saved in order with correct delays
    // We interleave all steps together (API auto-assigns track from step_type / track field)
    // Process linkedin steps then email steps (order within each track matters, cross-track order is irrelevant)
    const byTrack: Record<Track, WizardStep[]> = { linkedin: [], email: [] };
    for (const ws of wizardSteps) {
      byTrack[ws.track].push(ws);
    }
    let emailPosition = 1;
    let messagePosition = 1;
    // Save all steps flat — the track field tells the API which track each step belongs to
    // We must save them interleaved so positions increment correctly per type
    const allOrdered = [...byTrack.linkedin, ...byTrack.email];
    // Re-calculate positions independently
    emailPosition = 1; messagePosition = 1;
    for (const ws of allOrdered) {
      if (ws.delayDaysBefore > 0) {
        await fetch(`/api/workflows/${workflowId}/steps`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ step_type: "delay", track: ws.track, delay_seconds: ws.delayDaysBefore * 86400 }),
        });
      }
      const isEmail = ws.type === "email";
      const isInMail = ws.type === "sales_inmail";
      // sales_inmail behaves like message (body + optional AI + templates) plus a subject.
      const isMessage = ws.type === "message" || isInMail;
      const hasAI = isMessage || isEmail;
      await fetch(`/api/workflows/${workflowId}/steps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step_type: ws.type,
          track: ws.track,
          connect_note: ws.type === "connect" ? (ws.connectNote || null) : null,
          message_body: isMessage ? (ws.messageBody || null) : null,
          template_id: isMessage && ws.templateIds.length === 0 ? (ws.templateId ?? null) : null,
          template_ids: isMessage ? ws.templateIds : [],
          // InMail subject reuses the email_subject column (an InMail step never sends email).
          email_subject: isEmail ? (ws.emailSubject || null) : isInMail ? (ws.emailSubject || null) : null,
          email_body: isEmail ? (ws.emailBody || null) : null,
          email_signature: isEmail ? (ws.emailSignature) : null,
          email_position: isEmail ? emailPosition : null,
          message_position: isMessage ? messagePosition : null,
          ai_enabled: hasAI ? (ws.aiEnabled ? 1 : 0) : 0,
          ai_model: hasAI ? (ws.aiModel || null) : null,
          ai_prompt: hasAI ? (ws.aiPrompt || null) : null,
          ai_max_words: hasAI && ws.aiEnabled && ws.aiMaxWordsEnabled ? ws.aiMaxWords : null,
          ai_language: hasAI ? (ws.aiLanguage || "English") : null,
          attachment_url: isMessage ? (ws.attachmentUrl || null) : null,
          attachment_name: isMessage ? (ws.attachmentName || null) : null,
          attachment_type: isMessage ? (ws.attachmentType || null) : null,
          attachment_size: isMessage ? (ws.attachmentSize || null) : null,
        }),
      });
      if (isEmail) emailPosition++;
      if (isMessage) messagePosition++;
    }
    setSaving(false);
  }

  async function enrollContacts() {
    if (!activeRunId) { toast.error("No active run"); return; }
    if (selectedTargetIds.size === 0) { toast.error("Select at least one prospect"); return; }
    setLaunching(true);
    const res = await fetch(`/api/runs/${activeRunId}/enroll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_ids: Array.from(selectedTargetIds) }),
    });
    setLaunching(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.message ?? err.error ?? "Failed to enroll");
      return;
    }
    const data = await res.json();
    if (data.enrolled === 0) {
      toast.message("Nothing to enroll", {
        description: `All selected contacts are already enrolled or active elsewhere.`,
      });
    } else {
      const skipped = (data.skipped_already_enrolled ?? 0) + (data.skipped_active_elsewhere ?? 0);
      toast.success(
        skipped > 0
          ? `Enrolled ${data.enrolled} — ${skipped} skipped`
          : `Enrolled ${data.enrolled} contact${data.enrolled !== 1 ? "s" : ""}`
      );
    }
    onLaunched();
  }

  async function launch() {
    if (wizardSteps.length === 0) { toast.error("Add at least one step"); return; }
    if (selectedTargetIds.size === 0) { toast.error("Select at least one prospect"); return; }
    await saveStepsToDB();
    setLaunching(true);
    const body: Record<string, unknown> = {
      workflow_id: workflowId,
      list_id: listId,
      account_id: accountId,
      email_account_ids: Array.from(emailAccountIds),
    };
    if (prospectMode === "manual") body.target_ids = Array.from(selectedTargetIds);
    const runRes = await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!runRes.ok) {
      setLaunching(false);
      const err = await runRes.json();
      toast.error(err.message ?? "Failed to start");
      return;
    }
    const { id: runId } = await runRes.json();
    await fetch(`/api/runs/${runId}/start`, { method: "POST" });
    setLaunching(false);
    toast.success("Campaign launched!");
    onLaunched();
  }

  async function saveAndClose() {
    await saveStepsToDB();
    toast.success("Steps saved");
    onClose();
  }

  async function sendTestEmail() {
    const ws = testEmailIdx !== null ? wizardSteps[testEmailIdx] : null;
    if (!ws || !testEmailAccountId || !testEmailTo) return;
    setTestEmailSending(true);
    const res = await fetch(`/api/email-accounts/${testEmailAccountId}/send-test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: testEmailTo,
        subject: ws.emailSubject
          .replace(/\{\{first_name\}\}/g, "Alex")
          .replace(/\{\{last_name\}\}/g, "Johnson")
          .replace(/\{\{company\}\}/g, "Acme Corp")
          .replace(/\{\{title\}\}/g, "Head of Growth"),
        body: ws.emailBody
          .replace(/\{\{first_name\}\}/g, "Alex")
          .replace(/\{\{last_name\}\}/g, "Johnson")
          .replace(/\{\{company\}\}/g, "Acme Corp")
          .replace(/\{\{title\}\}/g, "Head of Growth"),
      }),
    });
    setTestEmailSending(false);
    if (!res.ok) {
      const err = await res.json();
      toast.error(`Failed to send: ${err.error}`);
    } else {
      toast.success(`Test email sent to ${testEmailTo}`);
      setTestEmailIdx(null);
      setTestEmailTo("");
    }
  }

  const basePages: WizardPage[] = isStepsOnly
    ? ["prompt", "linkedin-steps", "email-steps"]
    : isEditMode
    ? ["prompt", "linkedin-steps", "email-steps", "account"]
    : isAddContacts
    ? ["prospects"]
    : ["prospects", "prompt", "linkedin-steps", "email-steps", "account", "summary"];
  // Open-core: "Campaign Context" is AI-only (feeds the AI writer). Hide it entirely
  // in the free build — no page, no nav entry, no upgrade stub.
  const pages = hasPremium ? basePages : basePages.filter((p) => p !== "prompt");
  const pageIdx = pages.indexOf(page);

  const prospectsReady = !!listId && !allBlocked && selectedTargetIds.size > 0;
  const stepsReady = wizardSteps.length > 0;

  function canGoTo(p: WizardPage) {
    if (p === "prompt" && !hasPremium) return false; // AI-only page, hidden in free build
    if (isStepsOnly) return p === "prompt" || p === "linkedin-steps" || p === "email-steps";
    if (isEditMode) {
      if (p === "prompt" || p === "linkedin-steps" || p === "email-steps") return true;
      if (p === "account") return stepsReady;
      return false;
    }
    if (p === "prospects") return true;
    if (p === "prompt") return prospectsReady;
    if (p === "linkedin-steps") return prospectsReady;
    if (p === "email-steps") return prospectsReady;
    if (p === "account") return prospectsReady && stepsReady;
    if (p === "summary") return prospectsReady && stepsReady && !!accountId;
    return false;
  }

  const PAGE_LABELS: Record<WizardPage, string> = {
    prospects: t("campaignWizard.nav.prospects"),
    prompt: t("campaignWizard.nav.prompt"),
    "linkedin-steps": t("campaignWizard.nav.linkedinSteps"),
    "email-steps": t("campaignWizard.nav.emailSteps"),
    account: t("campaignWizard.nav.account"),
    summary: t("campaignWizard.nav.summary"),
  };

  const PAGE_ICONS: Record<WizardPage, React.ElementType> = {
    prospects: RiGroupLine,
    prompt: RiSparklingLine,
    "linkedin-steps": RiLinkedinBoxLine,
    "email-steps": RiMailLine,
    account: RiUser3Line,
    summary: RiRocketLine,
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-xs">
      <div className="w-full max-w-5xl xl:max-w-6xl h-[88vh] flex flex-col bg-white dark:bg-gray-900 rounded-3xl border border-gray-300 dark:border-gray-700 shadow-2xl overflow-hidden">
        {/* 1. Cabecera Principal del Modal */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-500/10 text-brand-600 dark:bg-brand-500/20 dark:text-brand-400 shrink-0">
              <RiRocketLine size={22} />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {editingName ? (
                  <input
                    autoFocus
                    className="rounded-lg px-2 py-0.5 border border-brand-500 bg-white dark:bg-gray-800 font-black text-base sm:text-lg text-gray-900 dark:text-white leading-tight focus:outline-none"
                    value={nameValue}
                    onChange={(e) => setNameValue(e.target.value)}
                    onBlur={saveWorkflowName}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveWorkflowName();
                      if (e.key === "Escape") {
                        setEditingName(false);
                        setNameValue(workflowName);
                      }
                    }}
                    disabled={nameSaving}
                  />
                ) : (
                  <button
                    type="button"
                    className="group flex items-center gap-1.5 font-black text-base sm:text-lg text-gray-900 dark:text-white leading-tight hover:text-brand-600 dark:hover:text-brand-400 transition-colors text-left truncate cursor-pointer"
                    onClick={() => {
                      setNameValue(workflowName);
                      setEditingName(true);
                    }}
                    title="Click para renombrar"
                  >
                    <span className="truncate">
                      {isEditMode
                        ? `Editar Campaña: ${workflowName}`
                        : isAddContacts
                        ? `Añadir Contactos: ${workflowName}`
                        : (workflowName || "Configurar Campaña")}
                    </span>
                    <RiEditLine size={15} className="text-gray-400 group-hover:text-brand-500 shrink-0 transition-colors" />
                  </button>
                )}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {isEditMode
                  ? "Modifica los pasos, mensajes, configuración y cuentas asociadas a la campaña"
                  : isAddContacts
                  ? "Selecciona los nuevos prospectos que deseas enrolar en esta campaña activa"
                  : "Asistente guiado de InHubFlow para prospección multicanal y secuencias automatizadas"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={launching || saving}
            className="p-2 rounded-xl text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors shrink-0 cursor-pointer"
            title="Cerrar"
          >
            <RiCloseLine size={22} />
          </button>
        </div>

        {/* 2. Cuerpo del Wizard (Pasos en vertical a la izquierda + Contenido a la derecha) */}
        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* Barra lateral vertical de pasos */}
          <div className="w-56 sm:w-64 shrink-0 border-r border-gray-200 dark:border-gray-800 p-3 sm:p-4 flex flex-col gap-1.5 overflow-y-auto bg-gray-50/70 dark:bg-gray-850/50">
            <div className="mb-1.5 px-2 pt-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                Pasos de la campaña
              </span>
            </div>
            {pages.map((p, idx) => {
              const isCurrent = page === p;
              const isPast = pageIdx > idx;
              const canNav = canGoTo(p);
              const StepIcon = PAGE_ICONS[p];
              return (
                <button
                  key={p}
                  type="button"
                  disabled={!canNav}
                  onClick={() => canNav && setPage(p)}
                  className={`w-full text-left flex items-center gap-3 p-2.5 rounded-2xl transition-all ${
                    isCurrent
                      ? "bg-brand-500/10 border border-brand-500/30 text-brand-600 dark:text-brand-400 font-bold shadow-2xs"
                      : isPast
                      ? "hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-800 dark:text-gray-200 cursor-pointer"
                      : "opacity-40 cursor-not-allowed text-gray-400 dark:text-gray-500"
                  }`}
                >
                  <span
                    className={`flex h-8 w-8 items-center justify-center rounded-xl text-xs font-bold transition-all shrink-0 ${
                      isCurrent
                        ? "bg-brand-500 text-white shadow-md shadow-brand-500/25 ring-2 ring-brand-500/30"
                        : isPast
                        ? "bg-emerald-500 text-white"
                        : "bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
                    }`}
                  >
                    {isPast ? <RiCheckLine size={15} /> : <StepIcon size={14} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider block leading-tight ${
                        isCurrent
                          ? "text-brand-600 dark:text-brand-400"
                          : isPast
                          ? "text-gray-500 dark:text-gray-400"
                          : "text-gray-400"
                      }`}
                    >
                      PASO {idx + 1}
                    </span>
                    <p className="text-xs font-semibold truncate leading-tight mt-0.5">
                      {PAGE_LABELS[p]}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Contenido del Wizard según el paso activo */}
          <div className={`flex-1 min-h-0 ${page === "prospects" ? "overflow-hidden" : "overflow-y-auto"} p-6 md:p-8 bg-white dark:bg-gray-900`}>
            <div className={`w-full mx-auto ${page === "prospects" ? "max-w-5xl h-full min-h-0" : "max-w-3xl"}`}>

            {/* ── Page: Prospects ── */}
            {page === "prospects" && (() => {
              const filteredLists = lists.filter((l) =>
                listSearch.trim() === ""
                  ? true
                  : l.name.toLowerCase().includes(listSearch.toLowerCase())
              );
              return (
                <div className="flex flex-col h-full min-h-0">
                  <div className="flex items-center justify-between border-b border-gray-300 dark:border-gray-700 pb-3 mb-3 shrink-0">
                    <h2 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                      <RiGroupLine className="text-brand-500" size={18} />
                      {isAddContacts ? t("campaignWizard.prospects.addTitle") : t("campaignWizard.prospects.title")}
                    </h2>
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      Paso {pageIdx + 1} de {pages.length}
                    </span>
                  </div>
                  <p className="text-gray-500 dark:text-gray-400 text-xs mb-3 shrink-0">
                    {isAddContacts
                      ? t("campaignWizard.prospects.addSubtitle")
                      : t("campaignWizard.prospects.subtitle")}
                  </p>

                    <div className="flex gap-6 flex-1 min-h-0">
                      {/* ── Left: Lists picker ── */}
                      <div className="w-72 shrink-0 flex flex-col min-h-0">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs text-base-content/40 uppercase tracking-wide">{t("campaignWizard.prospects.lists")}</p>
                          <span className="text-xs text-base-content/30">{lists.length}</span>
                        </div>
                        <div className="relative mb-2">
                          <RiSearchLine size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-base-content/30" />
                          <input
                            type="text"
                            value={listSearch}
                            onChange={(e) => setListSearch(e.target.value)}
                            placeholder={t("campaignWizard.prospects.searchLists")}
                            className="w-full pl-7 pr-2 py-1.5 text-xs rounded-lg bg-base-200 border border-base-300/50 focus:border-primary/40 focus:outline-none placeholder:text-base-content/30"
                          />
                        </div>
                        <div className="flex-1 overflow-y-auto rounded-lg border border-base-300/30 bg-base-200/30">
                          {lists.length === 0 ? (
                            <p className="text-xs text-base-content/40 p-4">
                              {t("campaignWizard.prospects.noLists")}{" "}
                              <Link href="/lists" className="text-primary underline">{t("campaignWizard.prospects.createOne")}</Link>
                            </p>
                          ) : filteredLists.length === 0 ? (
                            <p className="text-xs text-base-content/30 p-4">{t("campaignWizard.prospects.noListsMatch")}</p>
                          ) : (
                            filteredLists.map((l) => {
                              const active = listId === String(l.id);
                              return (
                                <button
                                  key={l.id}
                                  onClick={() => selectList(String(l.id))}
                                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm border-b border-base-300/20 last:border-0 transition-colors ${
                                    active
                                      ? "bg-primary/10 text-primary"
                                      : "hover:bg-base-200/60 text-base-content/80"
                                  }`}
                                >
                                  <span className="truncate">{l.name}</span>
                                  <span className={`text-xs shrink-0 ${active ? "text-primary/70" : "text-base-content/30"}`}>
                                    {l.target_count ?? 0}
                                  </span>
                                </button>
                              );
                            })
                          )}
                        </div>
                      </div>

                      {/* ── Right: Mode toggle + content ── */}
                      <div className="flex-1 min-w-0 flex flex-col min-h-0">
                        {!listId ? (
                          <div className="flex-1 flex items-center justify-center">
                            <p className="text-sm text-base-content/40">{t("campaignWizard.prospects.selectListPrompt")}</p>
                          </div>
                        ) : (
                          <>
                            {/* Mode toggle — always at top of right column */}
                            <div className="flex gap-2 mb-3">
                              <button
                                onClick={() => { setProspectMode("all"); setSelectedTargetIds(new Set(listTargets.map((t) => t.id))); }}
                                className={`flex-1 px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors ${prospectMode === "all" ? "bg-primary/10 border-primary/40 text-primary" : "bg-base-200 border-base-300/50 hover:border-base-300 text-base-content/60"}`}
                              >
                                {t("campaignWizard.prospects.allContacts")}
                                <span className="ml-1 text-xs opacity-60">({listTargets.length})</span>
                              </button>
                              <button
                                onClick={() => setProspectMode("manual")}
                                className={`flex-1 px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors ${prospectMode === "manual" ? "bg-primary/10 border-primary/40 text-primary" : "bg-base-200 border-base-300/50 hover:border-base-300 text-base-content/60"}`}
                              >
                                {t("campaignWizard.prospects.manualSelection")}
                                {prospectMode === "manual" && (
                                  <span className="ml-1 text-xs opacity-60">{t("campaignWizard.prospects.selectedCount", { count: selectedTargetIds.size })}</span>
                                )}
                              </button>
                            </div>

                            {/* Status / banner */}
                            {conflictsLoading && <p className="text-xs text-base-content/40 mb-2">{t("campaignWizard.prospects.checkingConflicts")}</p>}
                            {isAddContacts && (
                              <div className="px-3 py-2 rounded-lg text-xs mb-3 bg-base-200/50 border border-base-300/40 text-base-content/50">
                                {t("campaignWizard.prospects.alreadyEnrolledNotice")}
                              </div>
                            )}
                            {!isAddContacts && !conflictsLoading && conflicts && conflicts.blocked > 0 && (
                              <div className={`px-3 py-2 rounded-lg text-xs mb-3 ${allBlocked ? "bg-error/10 text-error" : "bg-warning/10 text-warning"}`}>
                                {allBlocked
                                  ? t("campaignWizard.prospects.allBlocked", { total: conflicts.total })
                                  : t("campaignWizard.prospects.someBlocked", { blocked: conflicts.blocked, total: conflicts.total })}
                              </div>
                            )}
                            {!isAddContacts && !conflictsLoading && conflicts && conflicts.blocked === 0 && listId && (
                              <p className="text-xs text-success mb-3">{t("campaignWizard.prospects.allAvailable", { total: conflicts.total })}</p>
                            )}

                            {/* Content */}
                            {prospectMode === "all" ? (
                              <div className="flex-1 flex items-center justify-center rounded-xl border border-base-300/30 bg-base-200/20">
                                <div className="text-center">
                                  <p className="text-3xl font-semibold text-base-content/80">
                                    {selectedTargetIds.size}
                                  </p>
                                  <p className="text-xs text-base-content/40 mt-1">
                                    {t("campaignWizard.prospects.willBeEnrolled")}
                                  </p>
                                </div>
                              </div>
                            ) : (
                              <div className="flex-1 min-h-0 border border-base-300/50 rounded-xl overflow-hidden flex flex-col">
                                <div className="px-4 py-2.5 bg-base-200 border-b border-gray-200 dark:border-gray-800 flex items-center gap-3 shrink-0">
                                  <input
                                    type="checkbox"
                                    className="w-3.5 h-3.5 rounded border border-base-300 bg-base-300/50 accent-primary cursor-pointer"
                                    checked={selectedTargetIds.size === listTargets.length && listTargets.length > 0}
                                    onChange={toggleAllTargets}
                                  />
                                  <span className="text-xs text-base-content/50">
                                    {selectedTargetIds.size === listTargets.length
                                      ? t("campaignWizard.prospects.allSelected", { count: listTargets.length })
                                      : t("campaignWizard.prospects.subsetSelected", { selected: selectedTargetIds.size, total: listTargets.length })}
                                  </span>
                                </div>
                                <div className="flex-1 overflow-y-auto">
                                  {listTargets.map((t) => (
                                    <label
                                      key={t.id}
                                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-base-200/60 cursor-pointer border-b border-gray-200 dark:border-gray-800 last:border-0"
                                    >
                                      <input
                                        type="checkbox"
                                        className="w-3.5 h-3.5 rounded border border-base-300 bg-base-300/50 accent-primary cursor-pointer shrink-0"
                                        checked={selectedTargetIds.has(t.id)}
                                        onChange={() => toggleTarget(t.id)}
                                      />
                                      <div className="min-w-0 flex-1">
                                        <p className="text-sm font-medium truncate">{t.full_name ?? "—"}</p>
                                        {(t.title || t.company) && (
                                          <p className="text-xs text-base-content/40 truncate">{[t.title, t.company].filter(Boolean).join(" · ")}</p>
                                        )}
                                      </div>
                                    </label>
                                  ))}
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* ── Page: Campaign Prompt ── */}
              {page === "prompt" && (
                <div>
                  <div className="flex items-center justify-between border-b border-gray-300 dark:border-gray-700 pb-3 mb-3">
                    <h2 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                      <RiSparklingLine className="text-brand-500" size={18} />
                      {t("campaignWizard.prompt.title")}
                    </h2>
                    <span className="text-xs text-gray-400 dark:text-gray-500">Paso {pageIdx + 1} de {pages.length}</span>
                  </div>
                  <p className="text-gray-500 dark:text-gray-400 text-xs mb-4">
                    {t("campaignWizard.prompt.desc")}
                  </p>
                  <textarea
                    value={campaignPrompt}
                    onChange={(e) => setCampaignPrompt(e.target.value)}
                    rows={10}
                    placeholder={t("campaignWizard.prompt.placeholder")}
                    className="w-full bg-base-300/40 border border-base-300/50 rounded-xl px-4 py-3 text-sm text-base-content placeholder:text-base-content/20 focus:outline-none focus:border-primary/40 resize-y leading-relaxed"
                  />
                  <p className="text-xs text-base-content/30 mt-2">{t("campaignWizard.prompt.chars", { count: campaignPrompt.length })}</p>
                </div>
              )}

              {/* ── Pages: LinkedIn Steps / Email Steps ── */}
              {(page === "linkedin-steps" || page === "email-steps") && (() => {
                const track: Track = page === "linkedin-steps" ? "linkedin" : "email";
                const trackSteps = wizardSteps.map((ws, idx) => ({ ws, idx })).filter(({ ws }) => ws.track === track);

                function StepCard({ ws, idx, isFirst }: { ws: WizardStep; idx: number; isFirst: boolean }) {
                  return (
                    <div>
                      {!isFirst && (
                        <div className="flex items-center gap-2 py-1 pl-3">
                          <div className="flex flex-col items-center gap-0.5">
                            <div className="w-px h-2 bg-base-300/60" />
                            <RiTimeLine size={11} className="text-base-content/30" />
                            <div className="w-px h-2 bg-base-300/60" />
                          </div>
                          <span className="text-xs text-base-content/30">
                            {ws.delayDaysBefore > 0 ? t("campaignWizard.steps.waitDays", { days: ws.delayDaysBefore }) : t("campaignWizard.steps.immediately")}
                          </span>
                        </div>
                      )}
                      <div
                        className="flex items-center gap-2 border rounded-xl px-3 py-2.5 cursor-pointer transition-colors bg-base-200 border-base-300/50 hover:border-primary/30 hover:bg-base-200/80 group"
                        onClick={() => setConfigIdx(idx)}
                      >
                        <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border ${STEP_COLORS[ws.type]}`}>
                          {STEP_ICONS[ws.type]}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">
                            {ws.type === "email" ? getEmailStepLabel(wizardSteps, idx, t) : ws.type === "message" ? getMessageStepLabel(wizardSteps, idx, t) : getStepLabel(ws.type, t)}
                          </p>
                          {ws.type === "connect" && ws.connectNote && (
                            <p className="text-[10px] text-base-content/40 truncate">{t("campaignWizard.steps.notePrefix")}{ws.connectNote}</p>
                          )}
                          {(ws.type === "message" || ws.type === "sales_inmail") && ws.templateIds.length > 0 && (
                            <p className="text-[10px] text-base-content/40">{t("campaignWizard.steps.templatesCount", { count: ws.templateIds.length })}</p>
                          )}
                          {ws.type === "sales_inmail" && hasPremium && ws.aiEnabled && (
                            <p className="text-[10px] text-base-content/40 italic">{t("campaignWizard.steps.aiWritesInMail")}</p>
                          )}
                          {ws.type === "sales_inmail" && !(hasPremium && ws.aiEnabled) && (
                            <p className={`text-[10px] truncate ${ws.emailSubject ? "text-base-content/40" : "text-error/50 italic"}`}>{ws.emailSubject || t("campaignWizard.steps.noSubjectRequired")}</p>
                          )}
                          {ws.type === "email" && ws.emailSubject && (
                            <p className="text-[10px] text-base-content/40 truncate">{ws.emailSubject}</p>
                          )}
                          {ws.type === "email" && !ws.emailSubject && (
                            <p className="text-[10px] text-base-content/25 italic">{t("campaignWizard.steps.noSubject")}</p>
                          )}
                          {ws.aiEnabled && (
                            <p className="text-[10px] text-primary/50 flex items-center gap-0.5 mt-0.5"><RiRobot2Line size={9} /> AI</p>
                          )}
                        </div>
                        <RiEditLine size={12} className="text-base-content/20 group-hover:text-base-content/40 transition-colors shrink-0 mr-0.5" />
                        <button
                          className="inline-flex items-center p-1 rounded-md bg-error/10 text-error border border-error/20 hover:bg-error/20 transition-colors shrink-0"
                          onClick={(e) => { e.stopPropagation(); removeWizardStep(idx); }}
                        >
                          <RiDeleteBinLine size={11} />
                        </button>
                      </div>
                    </div>
                  );
                }

                const otherTrack: Track = track === "linkedin" ? "email" : "linkedin";
                const otherCount = wizardSteps.filter((s) => s.track === otherTrack).length;

                return (
                  <div>
                    <div className="flex items-center justify-between border-b border-gray-300 dark:border-gray-700 pb-3 mb-3">
                      <h2 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                        {track === "linkedin" ? (
                          <RiLinkedinBoxLine size={18} className="text-brand-500" />
                        ) : (
                          <RiMailLine size={18} className="text-brand-500" />
                        )}
                        {track === "linkedin" ? t("campaignWizard.steps.linkedinTitle") : t("campaignWizard.steps.emailTitle")}
                      </h2>
                      <span className="text-xs text-gray-400 dark:text-gray-500">Paso {pageIdx + 1} de {pages.length}</span>
                    </div>
                    <p className="text-gray-500 dark:text-gray-400 text-xs mb-4">
                      {track === "linkedin"
                        ? t("campaignWizard.steps.linkedinDesc")
                        : t("campaignWizard.steps.emailDesc")}
                      {otherCount > 0 && (
                        <span className="text-base-content/35">{t("campaignWizard.steps.parallelNote")}</span>
                      )}
                    </p>

                    <div className="space-y-0 mb-5">
                      {trackSteps.length === 0 ? (
                        <div className="text-center py-10 border border-dashed border-base-300/60 rounded-xl text-base-content/30 text-sm">
                          {track === "linkedin" ? t("campaignWizard.steps.noLinkedinSteps") : t("campaignWizard.steps.noEmailSteps")}
                        </div>
                      ) : (
                        trackSteps.map(({ ws, idx }, pos) => <StepCard key={idx} ws={ws} idx={idx} isFirst={pos === 0} />)
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-base-content/30 mr-1">{t("campaignWizard.steps.addStep")}</span>
                      {track === "linkedin"
                        ? (["visit", "follow", "connect", "message", "sales_inmail"] as const)
                            // Sales Nav InMail is a premium feature — hide from the picker in the public build.
                            .filter((type) => type !== "sales_inmail" || hasPremium)
                            .map((type) => {
                            const disabled = (type === "connect" && hasConnect) || (type === "follow" && hasFollow);
                            const title = disabled
                              ? (type === "connect" ? t("campaignWizard.steps.connectOnce") : (t("campaignWizard.steps.followOnce") || "El paso de seguir perfil solo se puede agregar una vez"))
                              : undefined;
                            return (
                              <button key={type} onClick={() => !disabled && addWizardStep(type)} title={title}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-colors text-xs ${disabled ? "border-base-300/20 bg-base-200/40 text-base-content/20 cursor-not-allowed" : "border-primary/20 bg-primary/5 hover:bg-primary/10 text-primary/70 hover:text-primary"}`}>
                                <RiAddLine size={11} /> {getStepLabel(type, t)}
                              </button>
                            );
                          })
                        : (
                            <button onClick={() => addWizardStep("email")}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-colors text-xs border-warning/20 bg-warning/5 hover:bg-warning/10 text-warning/70 hover:text-warning">
                              <RiAddLine size={11} /> {trackSteps.length === 0 ? t("campaignWizard.steps.coldEmail") : t("campaignWizard.steps.followUpNumber", { num: trackSteps.length + 1 })}
                            </button>
                          )}
                    </div>
                  </div>
                );
              })()}

              {/* ── Page: Account ── */}
              {page === "account" && (
                <div>
                  <div className="flex items-center justify-between border-b border-gray-300 dark:border-gray-700 pb-3 mb-3">
                    <h2 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                      <RiUser3Line className="text-brand-500" size={18} />
                      {t("campaignWizard.account.title")}
                    </h2>
                    <span className="text-xs text-gray-400 dark:text-gray-500">Paso {pageIdx + 1} de {pages.length}</span>
                  </div>
                  <p className="text-gray-500 dark:text-gray-400 text-xs mb-4">
                    {t("campaignWizard.account.desc")}
                  </p>

                  <div className="mb-8">
                      <div className="mb-3">
                        <h3 className="text-base font-semibold">{t("campaignWizard.account.linkedinHeader")}</h3>
                        {!hasLinkedInStep && (
                          <p className="text-xs text-base-content/40 mt-0.5">{t("campaignWizard.account.linkedinRequiredNotice")}</p>
                        )}
                      </div>
                      <div className="flex flex-col gap-2">
                        {accounts.filter((a) => a.is_authenticated).length === 0 ? (
                          <p className="text-sm text-warning">
                            {t("campaignWizard.account.noAuthLinkedin")}{" "}
                            <Link href="/settings?tab=linkedin" className="underline">{t("campaignWizard.account.authFirst")}</Link>
                          </p>
                        ) : accounts.filter((a) => a.is_authenticated).map((a) => {
                          const connLeft = a.daily_connection_limit - a.connections_today;
                          const msgLeft = a.daily_message_limit - a.messages_today;
                          const inmailLeft = a.daily_inmail_limit - a.inmails_today;
                          return (
                            <button
                              key={a.id}
                              onClick={() => setAccountId(String(a.id))}
                              className={`flex items-center gap-4 px-4 py-3 rounded-xl border transition-colors text-left ${
                                accountId === String(a.id)
                                  ? "bg-primary/10 border-primary/40"
                                  : "bg-base-200 border-base-300/50 hover:border-base-300"
                              }`}
                            >
                              <span className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold shrink-0 ${accountId === String(a.id) ? "bg-primary text-primary-content" : "bg-base-300 text-base-content/60"}`}>
                                {a.name.charAt(0).toUpperCase()}
                              </span>
                              <div className="flex-1 min-w-0">
                                <p className={`font-medium text-sm ${accountId === String(a.id) ? "text-primary" : ""}`}>{a.name}</p>
                                <p className="text-xs text-base-content/40">{t("campaignWizard.account.limitsLeft", { conn: connLeft, msg: msgLeft, inmail: inmailLeft })}</p>
                              </div>
                              {accountId === String(a.id) && <span className="ml-auto text-primary text-xs font-semibold shrink-0">{t("campaignWizard.account.selected")}</span>}
                            </button>
                          );
                        })}
                      </div>
                  </div>

                  {hasEmailStep && (
                    <div>
                      <div className="mb-3">
                        <h3 className="text-base font-semibold">{t("campaignWizard.account.emailHeader")}</h3>
                        <p className="text-xs text-base-content/40 mt-0.5">{t("campaignWizard.account.emailDesc")}</p>
                      </div>
                      <div className="flex flex-col gap-2">
                        {emailAccounts.filter((e) => e.is_verified).length === 0 ? (
                          <p className="text-sm text-warning">
                            {t("campaignWizard.account.noVerifiedEmail")}{" "}
                            <Link href="/settings" className="underline">{t("campaignWizard.account.addInSettings")}</Link>
                          </p>
                        ) : emailAccounts.filter((e) => e.is_verified).map((e) => {
                          const selected = emailAccountIds.has(e.id);
                          const inUse = e.active_run_count > 0;
                          const locked = activeRunEmailAccountIds.includes(e.id);
                          return (
                            <button
                              key={e.id}
                              onClick={() => {
                                if (locked) return;
                                setEmailAccountIds(prev => {
                                  const next = new Set(prev);
                                  if (next.has(e.id)) next.delete(e.id); else next.add(e.id);
                                  return next;
                                });
                              }}
                              className={`flex items-center gap-4 px-4 py-3 rounded-xl border transition-colors text-left ${
                                locked
                                  ? "bg-warning/10 border-warning/30 cursor-not-allowed"
                                  : selected
                                  ? "bg-warning/10 border-warning/30"
                                  : "bg-base-200 border-base-300/50 hover:border-base-300"
                              }`}
                            >
                              <span className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold shrink-0 ${selected || locked ? "bg-warning/20 text-warning" : "bg-base-300 text-base-content/60"}`}>
                                {e.name.charAt(0).toUpperCase()}
                              </span>
                              <div className="flex-1 min-w-0">
                                <p className={`font-medium text-sm ${selected || locked ? "text-warning" : ""}`}>{e.name}</p>
                                <p className="text-xs text-base-content/40">{e.from_email}</p>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {locked ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-warning/20 text-warning border border-warning/30">
                                    <span className="w-1.5 h-1.5 rounded-full bg-warning" /> {t("campaignWizard.account.inUseLocked")}
                                  </span>
                                ) : inUse ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-warning/15 text-warning">
                                    <span className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse" /> {t("campaignWizard.account.inUse")}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-base-300/50 text-base-content/30">
                                    {t("campaignWizard.account.free")}
                                  </span>
                                )}
                                {selected && !locked && <span className="text-warning text-xs font-semibold">{t("campaignWizard.account.selected")}</span>}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Page: Summary ── */}
              {page === "summary" && (() => {
                const contactCount = selectedTargetIds.size;
                // Collect AI steps with their preview costs
                const aiSteps = wizardSteps.map((ws, i) => ({ ws, i })).filter(({ ws }) => ws.aiEnabled && (ws.type === "email" || ws.type === "message" || ws.type === "sales_inmail"));
                const hasCostData = aiSteps.some(({ i }) => stepPreviewCosts[i] != null);
                const totalAiCost = aiSteps.reduce((sum, { i }) => sum + (stepPreviewCosts[i]?.cost_usd ?? 0), 0) * contactCount;
                const totalTokens = aiSteps.reduce((sum, { i }) => {
                  const c = stepPreviewCosts[i];
                  return sum + (c ? c.input_tokens + c.output_tokens : 0);
                }, 0) * contactCount;

                return (
                  <div className="space-y-5">
                    <div className="flex items-center justify-between border-b border-gray-300 dark:border-gray-700 pb-3">
                      <h2 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                        <RiRocketLine className="text-brand-500" size={18} />
                        {t("campaignWizard.summary.title")}
                      </h2>
                      <span className="text-xs text-gray-400 dark:text-gray-500">Paso {pageIdx + 1} de {pages.length}</span>
                    </div>
                    <p className="text-gray-500 dark:text-gray-400 text-xs -mt-2">{t("campaignWizard.summary.desc")}</p>

                    {/* Campaign overview card */}
                    <div className="bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-2xl shadow-xs overflow-hidden">
                      {/* Header strip */}
                      <div className="bg-primary/10 border-b border-gray-200 dark:border-gray-800 px-5 py-3 flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                          <RiRobot2Line size={15} className="text-primary" />
                        </div>
                        <div>
                          <p className="font-semibold text-sm">{workflowName}</p>
                          <p className="text-xs text-base-content/40">{t("campaignWizard.summary.stepsAndContacts", { steps: wizardSteps.filter(s => (s.type as string) !== "delay").length, contacts: contactCount })}</p>
                        </div>
                      </div>

                      {/* Details grid */}
                      <div className="divide-y divide-base-300/40">
                        <div className="grid grid-cols-2 px-5 py-3 text-sm">
                          <span className="text-base-content/50">{t("campaignWizard.summary.list")}</span>
                          <div className="text-right">
                            <span className="font-medium">{selectedList?.name}</span>
                            <p className="text-xs text-base-content/35 mt-0.5">
                              {selectedTargetIds.size === listTargets.length
                                ? t("campaignWizard.summary.allContactsOf", { count: contactCount })
                                : t("campaignWizard.summary.subsetOf", { selected: contactCount, total: listTargets.length })}
                            </p>
                          </div>
                        </div>
                        {selectedAccount && (
                          <div className="grid grid-cols-2 px-5 py-3 text-sm">
                            <span className="text-base-content/50">{t("campaignWizard.summary.linkedin")}</span>
                            <span className="font-medium text-right">{selectedAccount.name}</span>
                          </div>
                        )}
                        {hasEmailStep && (
                          <div className="grid grid-cols-2 px-5 py-3 text-sm">
                            <span className="text-base-content/50">{t("campaignWizard.summary.emailFrom")}</span>
                            {selectedEmailAccounts.length > 0 ? (
                              <div className="text-right space-y-1">
                                {selectedEmailAccounts.map(e => (
                                  <div key={e.id}>
                                    <span className="font-medium">{e.name}</span>
                                    <p className="text-xs text-base-content/35">{e.from_email}</p>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="text-warning text-xs text-right">{t("campaignWizard.summary.emailSkipped")}</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Step sequence */}
                    {(() => {
                      const summaryLiSteps = wizardSteps.map((ws, i) => ({ ws, i })).filter(({ ws }) => ws.track === "linkedin");
                      const summaryEmSteps = wizardSteps.map((ws, i) => ({ ws, i })).filter(({ ws }) => ws.track === "email");
                      const isDualSummary = summaryLiSteps.length > 0 && summaryEmSteps.length > 0;

                      function SummaryTrack({ steps, trackLabel, trackColor }: { steps: { ws: WizardStep; i: number }[]; trackLabel: string; trackColor: string }) {
                        return (
                          <div>
                            <div className={`px-4 py-2 border-b border-gray-200 dark:border-gray-800 text-xs font-semibold ${trackColor}`}>{trackLabel}</div>
                            <div className="divide-y divide-base-300/20">
                              {steps.map(({ ws, i }) => {
                                const label = ws.type === "email" ? getEmailStepLabel(wizardSteps, i, t) : ws.type === "message" ? getMessageStepLabel(wizardSteps, i, t) : getStepLabel(ws.type, t);
                                const cost = stepPreviewCosts[i];
                                const colorClass = STEP_COLORS[ws.type] ?? "bg-base-300/30 text-base-content/50 border-base-300/30";
                                return (
                                  <div key={i}>
                                    {ws.delayDaysBefore > 0 && (
                                      <div className="flex items-center gap-1.5 text-xs text-base-content/25 px-5 py-1.5 bg-base-300/20">
                                        <RiTimeLine size={10} /> {t("campaignWizard.steps.waitDays", { days: ws.delayDaysBefore })}
                                      </div>
                                    )}
                                    <div className="px-5 py-2.5 flex items-center gap-3">
                                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs border font-medium ${colorClass}`}>
                                        {STEP_ICONS[ws.type]} {label}
                                      </span>
                                      <div className="flex-1" />
                                      {ws.aiEnabled && (
                                        <span className="inline-flex items-center gap-1.5 text-xs">
                                          <RiRobot2Line size={11} className="text-primary/50" />
                                          {cost ? <span className="text-base-content/40">${cost.cost_usd.toFixed(5)}</span> : <span className="text-base-content/25 italic">{t("campaignWizard.summary.previewToEstimate")}</span>}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div className="bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-2xl shadow-xs overflow-hidden">
                          <div className="px-5 py-3 border-b border-base-300/40 flex items-center justify-between">
                            <p className="text-xs font-medium text-base-content/40 uppercase tracking-widest">{t("campaignWizard.summary.sequence")}</p>
                            {isDualSummary && (
                              <span className="inline-flex items-center gap-1 text-xs text-primary/60 bg-primary/8 px-2 py-0.5 rounded-full border border-primary/15">
                                <RiArrowRightLine size={10} /> {t("campaignWizard.summary.parallelTracks")}
                              </span>
                            )}
                          </div>
                          {isDualSummary ? (
                            <div className="grid grid-cols-2 divide-x divide-base-300/30">
                              <SummaryTrack steps={summaryLiSteps} trackLabel="LinkedIn" trackColor="text-primary/60" />
                              <SummaryTrack steps={summaryEmSteps} trackLabel="Email" trackColor="text-warning/60" />
                            </div>
                          ) : (
                            <div className="divide-y divide-base-300/30">
                              {wizardSteps.map((ws, i) => {
                                const label = ws.type === "email" ? getEmailStepLabel(wizardSteps, i, t) : ws.type === "message" ? getMessageStepLabel(wizardSteps, i, t) : getStepLabel(ws.type, t);
                                const cost = stepPreviewCosts[i];
                                const colorClass = STEP_COLORS[ws.type] ?? "bg-base-300/30 text-base-content/50 border-base-300/30";
                                return (
                                  <div key={i}>
                                    {ws.delayDaysBefore > 0 && (
                                      <div className="flex items-center gap-1.5 text-xs text-base-content/25 px-5 py-2 bg-base-300/20">
                                        <RiTimeLine size={10} /> {t("campaignWizard.steps.waitDays", { days: ws.delayDaysBefore })}
                                      </div>
                                    )}
                                    <div className="px-5 py-3 flex items-center gap-3">
                                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs border font-medium ${colorClass}`}>
                                        {STEP_ICONS[ws.type]} {label}
                                      </span>
                                      <div className="flex-1" />
                                      {ws.aiEnabled && (
                                        <span className="inline-flex items-center gap-1.5 text-xs">
                                          <RiRobot2Line size={11} className="text-primary/50" />
                                          {cost ? <span className="text-base-content/40">${cost.cost_usd.toFixed(5)} · {(cost.input_tokens + cost.output_tokens).toLocaleString()} tok</span> : <span className="text-base-content/25 italic">{t("campaignWizard.summary.previewToEstimate")}</span>}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* AI Cost estimate */}
                    {aiSteps.length > 0 && (
                      <div className={`rounded-xl border overflow-hidden ${hasCostData ? "border-primary/20 bg-primary/5" : "border-base-300/50 bg-base-200"}`}>
                        <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center gap-2">
                          <RiRobot2Line size={13} className={hasCostData ? "text-primary" : "text-base-content/30"} />
                          <p className="text-xs font-medium text-base-content/40 uppercase tracking-widest">{t("campaignWizard.summary.aiCostEstimate")}</p>
                        </div>
                        {!hasCostData ? (
                          <div className="px-5 py-4 text-xs text-base-content/40">
                            {t("campaignWizard.summary.runAiPreviewPrompt")}
                          </div>
                        ) : (
                          <div className="divide-y divide-base-300/30">
                            {aiSteps.map(({ ws, i }) => {
                              const cost = stepPreviewCosts[i];
                              const label = ws.type === "email" ? getEmailStepLabel(wizardSteps, i, t) : getMessageStepLabel(wizardSteps, i, t);
                              if (!cost) return (
                                <div key={i} className="grid grid-cols-[1fr_auto] px-5 py-2.5 text-xs items-center gap-4">
                                  <span className="text-base-content/40">{label}</span>
                                  <span className="text-base-content/25 italic">{t("campaignWizard.summary.noPreview")}</span>
                                </div>
                              );
                              const stepTotal = cost.cost_usd * contactCount;
                              return (
                                <div key={i} className="grid grid-cols-[1fr_auto_auto] px-5 py-2.5 text-xs items-center gap-4">
                                  <span className="text-base-content/60 font-medium">{label}</span>
                                  <span className="text-base-content/35">${cost.cost_usd.toFixed(5)} × {contactCount}</span>
                                  <span className="font-semibold text-base-content tabular-nums">${stepTotal.toFixed(4)}</span>
                                </div>
                              );
                            })}
                            {aiSteps.filter(({ i }) => stepPreviewCosts[i]).length > 0 && (
                              <div className="grid grid-cols-[1fr_auto] px-5 py-3 text-sm items-center bg-primary/5">
                                <div>
                                  <span className="font-semibold text-base-content">{t("campaignWizard.summary.totalEstimatedCost")}</span>
                                  <p className="text-xs text-base-content/35 mt-0.5">{t("campaignWizard.summary.tokensAcrossContacts", { tokens: totalTokens.toLocaleString(), contacts: contactCount })}</p>
                                </div>
                                <span className="text-lg font-bold text-primary tabular-nums">${totalAiCost.toFixed(4)}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Warnings */}
                    {conflicts && conflicts.blocked > 0 && (
                      <p className="text-xs text-warning flex items-center gap-1.5">
                        <span className="w-1 h-1 rounded-full bg-warning inline-block" />
                        {t("campaignWizard.summary.activeElsewhereWarning", { count: conflicts.blocked })}
                      </p>
                    )}
                    <p className="text-xs text-base-content/35">{t("campaignWizard.summary.startsImmediately")}</p>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>

        {/* 3. Footer de Navegación del Wizard */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-gray-300 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-850/80 shrink-0">
            <div className="flex items-center gap-2">
              {pageIdx === 0 ? (
                <button
                  type="button"
                  onClick={onClose}
                  disabled={launching || saving}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors disabled:opacity-40 cursor-pointer"
                >
                  {t("campaignWizard.nav.cancel")}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setPage(pages[pageIdx - 1])}
                  disabled={launching || saving}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors disabled:opacity-40 cursor-pointer"
                >
                  <RiArrowLeftLine size={15} /> {t("campaignWizard.nav.back")}
                </button>
              )}
              {!isStepsOnly && !isEditMode && (page === "linkedin-steps" || page === "email-steps") && wizardSteps.length > 0 && (
                <button
                  type="button"
                  onClick={saveAndClose}
                  disabled={saving}
                  className="inline-flex items-center px-4 py-2 rounded-xl text-xs font-semibold text-gray-500 dark:text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors disabled:opacity-40 cursor-pointer"
                >
                  {saving ? <span className="loading loading-spinner loading-xs" /> : t("campaignWizard.nav.saveStepsOnly")}
                </button>
              )}
            </div>

            <div className="flex items-center gap-2.5">
              {isStepsOnly ? (
                <button
                  type="button"
                  onClick={saveAndClose}
                  disabled={saving || wizardSteps.length === 0}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-brand-500 hover:bg-brand-600 shadow-md hover:shadow-lg transition-all disabled:opacity-50 cursor-pointer"
                >
                  {saving ? <span className="loading loading-spinner loading-xs" /> : <RiCheckLine size={15} />}
                  {t("campaignWizard.nav.save")}
                </button>
              ) : isAddContacts ? (
                <button
                  type="button"
                  onClick={enrollContacts}
                  disabled={launching || !prospectsReady || selectedTargetIds.size === 0}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-brand-500 hover:bg-brand-600 shadow-md hover:shadow-lg transition-all disabled:opacity-50 cursor-pointer"
                >
                  {launching
                    ? <><span className="loading loading-spinner loading-xs" /> {t("campaignWizard.nav.enrolling")}</>
                    : <><RiUserFollowLine size={15} /> {t("campaignWizard.nav.enrollContacts", { count: selectedTargetIds.size })}</>}
                </button>
              ) : isEditMode && page === "account" ? (
                <button
                  type="button"
                  onClick={saveAndClose}
                  disabled={saving || wizardSteps.length === 0}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-brand-500 hover:bg-brand-600 shadow-md hover:shadow-lg transition-all disabled:opacity-50 cursor-pointer"
                >
                  {saving ? <span className="loading loading-spinner loading-xs" /> : <RiCheckLine size={15} />}
                  {t("campaignWizard.nav.saveChanges")}
                </button>
              ) : page !== "summary" ? (
                <button
                  type="button"
                  disabled={
                    (page === "prospects" && (!prospectsReady || conflictsLoading)) ||
                    (page === "email-steps" && wizardSteps.length === 0) ||
                    (page === "account" && !accountId)
                  }
                  onClick={() => setPage(pages[pageIdx + 1])}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-brand-500 hover:bg-brand-600 shadow-md hover:shadow-lg transition-all disabled:opacity-50 cursor-pointer"
                >
                  {t("campaignWizard.nav.next")} <RiArrowRightLine size={15} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={launch}
                  disabled={launching}
                  className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-bold text-white bg-brand-500 hover:bg-brand-600 shadow-lg hover:shadow-xl transition-all disabled:opacity-50 cursor-pointer"
                >
                  {launching
                    ? <><span className="loading loading-spinner loading-xs" /> {t("campaignWizard.nav.launching")}</>
                    : <><RiRocketLine size={15} /> {t("campaignWizard.nav.launchCampaign")}</>}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Step Config Modal ── */}
      {configIdx !== null && (() => {
        const ws = wizardSteps[configIdx]!;
        const idx = configIdx;
        const stepLabel = ws.type === "email" ? getEmailStepLabel(wizardSteps, idx, t) : ws.type === "message" ? getMessageStepLabel(wizardSteps, idx, t) : getStepLabel(ws.type, t);
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setConfigIdx(null)}>
            <div
              className="bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-2xl shadow-xl shadow-2xl w-full max-w-xl flex flex-col overflow-hidden"
              style={{ maxHeight: "85vh" }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal header */}
              <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-200 dark:border-gray-800 shrink-0">
                <span className={`w-8 h-8 rounded-lg flex items-center justify-center border ${STEP_COLORS[ws.type]}`}>
                  {STEP_ICONS[ws.type]}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm">{stepLabel}</p>
                  <p className="text-xs text-base-content/40 capitalize">{t("campaignWizard.config.track", { track: ws.track })}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setConfigIdx(null)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-base-content/40 hover:text-base-content hover:bg-base-300/50 transition-colors text-base"
                >✕</button>
              </div>

              {/* Modal body */}
              <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">

                {/* Delay field */}
                <div className="flex items-center gap-3 pb-4 border-b border-gray-200 dark:border-gray-800">
                  <RiTimeLine size={14} className="text-base-content/30 shrink-0" />
                  <span className="text-sm text-base-content/50">{t("campaignWizard.config.waitBefore")}</span>
                  <div className="flex items-center gap-2 ml-auto">
                    <input
                      type="number"
                      min={0}
                      className="input input-xs input-bordered w-16 bg-base-300/50 text-xs text-center"
                      value={ws.delayDaysBefore}
                      onChange={(e) => updateStep(idx, { delayDaysBefore: Number(e.target.value) })}
                    />
                    <span className="text-xs text-base-content/40">{t("campaignWizard.config.days")}</span>
                  </div>
                </div>

                {ws.type === "visit" && (
                  <p className="text-sm text-base-content/50">
                    {t("campaignWizard.config.visitDesc")}
                  </p>
                )}

                {ws.type === "follow" && (
                  <p className="text-sm text-base-content/50">
                    {t("campaignWizard.config.followDesc") || "Sigue automáticamente el perfil de LinkedIn del prospecto para generar una notificación cálida en su cuenta antes o después de conectar."}
                  </p>
                )}

                {ws.type === "connect" && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        id={`note-modal-${idx}`}
                        className="w-4 h-4 rounded border border-base-300 bg-base-300/50 accent-primary cursor-pointer"
                        checked={!!ws.connectNote}
                        onChange={(e) => updateStep(idx, { connectNote: e.target.checked ? " " : "" })}
                      />
                      <label htmlFor={`note-modal-${idx}`} className="text-sm cursor-pointer">
                        {t("campaignWizard.config.includeNote")}
                      </label>
                    </div>
                    {!!ws.connectNote && (
                      <div>
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {VARIABLES.map(v => (
                            <button key={v} type="button" onClick={() => updateStep(idx, { connectNote: ws.connectNote + v })} className="px-2 py-0.5 rounded bg-base-300/60 text-xs text-base-content/50 hover:text-base-content hover:bg-base-300 transition-colors font-mono">{v}</button>
                          ))}
                        </div>
                        <textarea
                          className="textarea textarea-bordered w-full bg-base-300/50 text-sm h-28 resize-none"
                          placeholder={t("campaignWizard.config.notePlaceholder")}
                          value={ws.connectNote.trimStart()}
                          onChange={(e) => updateStep(idx, { connectNote: e.target.value })}
                          maxLength={300}
                          autoFocus
                        />
                        <p className="text-xs text-base-content/30 mt-1">{ws.connectNote.length}/300</p>
                      </div>
                    )}
                  </div>
                )}

                {(ws.type === "message" || ws.type === "sales_inmail") && (
                  <div className="space-y-4">
                    {ws.type === "sales_inmail" && !(hasPremium && ws.aiEnabled) && (
                      <div>
                        <label className="text-xs text-base-content/40 mb-1.5 block">{t("campaignWizard.config.subject")} <span className="text-error/70">({t("campaignWizard.config.inmailSubjectRequired")})</span></label>
                        <input type="text" placeholder={t("campaignWizard.config.inmailSubjectPlaceholder")} value={ws.emailSubject} onChange={(e) => updateStep(idx, { emailSubject: e.target.value })} className="w-full bg-base-300/50 border border-base-300/50 rounded-xl px-3 py-2.5 text-sm text-base-content placeholder:text-base-content/20 focus:outline-none focus:border-primary/40" />
                      </div>
                    )}
                    {ws.type === "sales_inmail" && hasPremium && ws.aiEnabled && (
                      <p className="text-xs text-base-content/30 -mt-1">{t("campaignWizard.config.aiInmailNotice")}</p>
                    )}
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-base-300/40 border border-base-300/50">
                      <RiRobot2Line size={15} className="text-base-content/40 shrink-0" />
                      <div className="flex-1">
                        <p className="text-sm text-base-content/70">{t("campaignWizard.config.aiWritesTitle", { type: ws.type === "sales_inmail" ? "InMail" : t("campaignWizard.config.message") })}</p>
                        <p className="text-xs text-base-content/30 mt-0.5">{t("campaignWizard.config.aiWritesDesc", { type: ws.type === "sales_inmail" ? "InMail" : t("campaignWizard.config.message") })}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => updateStep(idx, { aiEnabled: !ws.aiEnabled })}
                        className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${ws.aiEnabled ? "bg-primary" : "bg-base-300"}`}
                      >
                        <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${ws.aiEnabled ? "translate-x-5" : "translate-x-0"}`} />
                      </button>
                    </div>
                    {ws.aiEnabled ? (
                      <div className="space-y-4">
                        <ModelPicker models={orModels} value={ws.aiModel} open={orModelOpen === idx} search={orModelSearch} collapsedProviders={collapsedProviders}
                          onOpen={() => { setOrModelOpen(orModelOpen === idx ? null : idx); setOrModelSearch(""); }}
                          onClose={() => { setOrModelOpen(null); setOrModelSearch(""); }}
                          onSelect={(id) => { updateStep(idx, { aiModel: id }); setOrModelOpen(null); setOrModelSearch(""); }}
                          onSearch={setOrModelSearch}
                          onToggleProvider={(p) => setCollapsedProviders(prev => { const n = new Set(prev); n.has(p) ? n.delete(p) : n.add(p); return n; })}
                        />
                        <div>
                          <label className="text-xs text-base-content/40 mb-1.5 block">{t("campaignWizard.config.stepInstruction")}</label>
                          <textarea rows={3} placeholder={t("campaignWizard.config.stepInstructionPlaceholder")} value={ws.aiPrompt} onChange={(e) => updateStep(idx, { aiPrompt: e.target.value })} className="w-full bg-base-300/50 border border-base-300/50 rounded-xl px-3 py-2.5 text-sm text-base-content placeholder:text-base-content/20 focus:outline-none focus:border-primary/40 resize-none" />
                        </div>
                        <div className="flex items-center gap-3">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" className="checkbox checkbox-xs" checked={ws.aiMaxWordsEnabled} onChange={(e) => updateStep(idx, { aiMaxWordsEnabled: e.target.checked })} />
                            <span className="text-xs text-base-content/50">{t("campaignWizard.config.maxWords")}</span>
                          </label>
                          {ws.aiMaxWordsEnabled && <input type="number" min={10} max={500} value={ws.aiMaxWords} onChange={(e) => updateStep(idx, { aiMaxWords: Number(e.target.value) })} className="w-20 bg-base-300/50 border border-base-300/50 rounded-lg px-2 py-1.5 text-sm text-base-content focus:outline-none focus:border-primary/40" />}
                          <select value={ws.aiLanguage} onChange={(e) => updateStep(idx, { aiLanguage: e.target.value })} className="flex-1 bg-base-300/50 border border-base-300/50 rounded-lg px-3 py-1.5 text-sm text-base-content focus:outline-none focus:border-primary/40">
                            {AI_LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
                          </select>
                        </div>
                        <button type="button" onClick={() => { setPreviewIdx(idx); setPreviewResult(null); setPreviewListId(""); setPreviewListTargets([]); setPreviewTargetId(""); setConfigIdx(null); }} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors">
                          <RiRobot2Line size={13} /> {t("campaignWizard.config.previewAiOutput")}
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {templates.length > 0 && (
                          <div>
                            <p className="text-xs text-base-content/40 mb-2">{t("campaignWizard.config.templates")}</p>
                            {ws.templateIds.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 mb-2">
                                {ws.templateIds.map((tid) => {
                                  const t = templates.find((t) => t.id === tid);
                                  return (
                                    <span key={tid} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-0.5 rounded-md text-xs font-medium bg-success/10 text-success border border-success/20">
                                      {t?.name ?? tid}
                                      <button type="button" onClick={() => updateStep(idx, { templateIds: ws.templateIds.filter((id) => id !== tid) })} className="ml-0.5 hover:text-error transition-colors">×</button>
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                            {templates.filter((t) => !ws.templateIds.includes(t.id)).length > 0 && (
                              <select className="select select-bordered select-sm bg-base-300/50 text-sm" value="" onChange={(e) => { const tid = e.target.value; if (tid && !ws.templateIds.includes(tid)) updateStep(idx, { templateIds: [...ws.templateIds, tid], messageBody: "" }); }}>
                                <option value="">{t("campaignWizard.config.addTemplate")}</option>
                                {templates.filter((t) => !ws.templateIds.includes(t.id)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                              </select>
                            )}
                          </div>
                        )}
                        <div>
                          <div className="flex flex-wrap gap-1.5 mb-2">
                            {VARIABLES.map(v => (
                              <button key={v} type="button" onClick={() => updateStep(idx, { messageBody: ws.messageBody + v })} className="px-2 py-0.5 rounded bg-base-300/60 text-xs text-base-content/50 hover:text-base-content hover:bg-base-300 transition-colors font-mono">{v}</button>
                            ))}
                          </div>
                          <textarea className={`textarea textarea-bordered w-full bg-base-300/50 text-sm h-32 resize-none font-mono ${ws.templateIds.length > 0 ? "opacity-40 pointer-events-none" : ""}`} placeholder={t("campaignWizard.config.messagePlaceholder")} value={ws.messageBody} onChange={(e) => updateStep(idx, { messageBody: e.target.value })} disabled={ws.templateIds.length > 0} />
                          <p className="text-xs text-base-content/30 mt-1">{ws.messageBody.length}</p>
                        </div>
                      </div>
                    )}

                    {/* LinkedIn Voice Note & Attachment Picker */}
                    <StepAttachmentPicker
                      attachmentUrl={ws.attachmentUrl}
                      attachmentName={ws.attachmentName}
                      attachmentType={ws.attachmentType}
                      attachmentSize={ws.attachmentSize}
                      onChange={(att) => {
                        updateStep(idx, {
                          attachmentUrl: att.url,
                          attachmentName: att.name,
                          attachmentType: att.type,
                          attachmentSize: att.size,
                        });
                      }}
                    />
                  </div>
                )}

                {ws.type === "email" && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-base-300/40 border border-base-300/50">
                      <RiRobot2Line size={15} className="text-base-content/40 shrink-0" />
                      <div className="flex-1">
                        <p className="text-sm text-base-content/70">{t("campaignWizard.config.aiWritesTitle", { type: "email" })}</p>
                        <p className="text-xs text-base-content/30 mt-0.5">{t("campaignWizard.config.aiWritesDesc", { type: "email" })}</p>
                      </div>
                      <button type="button" onClick={() => updateStep(idx, { aiEnabled: !ws.aiEnabled })} className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${ws.aiEnabled ? "bg-primary" : "bg-base-300"}`}>
                        <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${ws.aiEnabled ? "translate-x-5" : "translate-x-0"}`} />
                      </button>
                    </div>
                    {ws.aiEnabled ? (
                      <div className="space-y-4">
                        <ModelPicker models={orModels} value={ws.aiModel} open={orModelOpen === idx} search={orModelSearch} collapsedProviders={collapsedProviders}
                          onOpen={() => { setOrModelOpen(orModelOpen === idx ? null : idx); setOrModelSearch(""); }}
                          onClose={() => { setOrModelOpen(null); setOrModelSearch(""); }}
                          onSelect={(id) => { updateStep(idx, { aiModel: id }); setOrModelOpen(null); setOrModelSearch(""); }}
                          onSearch={setOrModelSearch}
                          onToggleProvider={(p) => setCollapsedProviders(prev => { const n = new Set(prev); n.has(p) ? n.delete(p) : n.add(p); return n; })}
                        />
                        <div>
                          <label className="text-xs text-base-content/40 mb-1.5 block">{t("campaignWizard.config.stepInstruction")}</label>
                          <textarea rows={3} placeholder={t("campaignWizard.config.stepInstructionPlaceholder")} value={ws.aiPrompt} onChange={(e) => updateStep(idx, { aiPrompt: e.target.value })} className="w-full bg-base-300/50 border border-base-300/50 rounded-xl px-3 py-2.5 text-sm text-base-content placeholder:text-base-content/20 focus:outline-none focus:border-primary/40 resize-none" />
                        </div>
                        <div className="flex items-center gap-3">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" className="checkbox checkbox-xs" checked={ws.aiMaxWordsEnabled} onChange={(e) => updateStep(idx, { aiMaxWordsEnabled: e.target.checked })} />
                            <span className="text-xs text-base-content/50">{t("campaignWizard.config.maxWords")}</span>
                          </label>
                          {ws.aiMaxWordsEnabled && <input type="number" min={10} max={1000} value={ws.aiMaxWords} onChange={(e) => updateStep(idx, { aiMaxWords: Number(e.target.value) })} className="w-20 bg-base-300/50 border border-base-300/50 rounded-lg px-2 py-1.5 text-sm text-base-content focus:outline-none focus:border-primary/40" />}
                          <select value={ws.aiLanguage} onChange={(e) => updateStep(idx, { aiLanguage: e.target.value })} className="flex-1 bg-base-300/50 border border-base-300/50 rounded-lg px-3 py-1.5 text-sm text-base-content focus:outline-none focus:border-primary/40">
                            {AI_LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
                          </select>
                        </div>
                        <button type="button" onClick={() => { setPreviewIdx(idx); setPreviewResult(null); setPreviewListId(""); setPreviewListTargets([]); setPreviewTargetId(""); setConfigIdx(null); }} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors">
                          <RiRobot2Line size={13} /> {t("campaignWizard.config.previewAiOutput")}
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div>
                          <label className="text-sm text-base-content/50 block mb-1.5">{t("campaignWizard.config.subject")}</label>
                          <div className="flex flex-wrap gap-1.5 mb-2">
                            {VARIABLES.map(v => (
                              <button key={v} type="button" onClick={() => updateStep(idx, { emailSubject: ws.emailSubject + v })} className="px-2 py-0.5 rounded bg-base-300/60 text-xs text-base-content/50 hover:text-base-content hover:bg-base-300 transition-colors font-mono">{v}</button>
                            ))}
                          </div>
                          <input className="input input-bordered w-full bg-base-300/50 font-mono text-sm" placeholder={t("campaignWizard.config.subjectPlaceholder")} value={ws.emailSubject} onChange={(e) => updateStep(idx, { emailSubject: e.target.value })} />
                        </div>
                        <div>
                          <label className="text-sm text-base-content/50 block mb-1.5">{t("campaignWizard.config.body")}</label>
                          <div className="flex flex-wrap gap-1.5 mb-2">
                            {VARIABLES.map(v => (
                              <button key={v} type="button" onClick={() => updateStep(idx, { emailBody: ws.emailBody + v })} className="px-2 py-0.5 rounded bg-base-300/60 text-xs text-base-content/50 hover:text-base-content hover:bg-base-300 transition-colors font-mono">{v}</button>
                            ))}
                          </div>
                          <textarea className="textarea textarea-bordered w-full bg-base-300/50 text-sm resize-none font-mono" rows={7} placeholder={t("campaignWizard.config.bodyPlaceholder")} value={ws.emailBody} onChange={(e) => updateStep(idx, { emailBody: e.target.value })} />
                          <p className="text-xs text-base-content/30 mt-1">{ws.emailBody.length}</p>
                        </div>
                      </div>
                    )}

                    {/* Signature — always visible for email steps regardless of AI mode */}
                    <div className="border-t border-gray-200 dark:border-gray-800 pt-4">
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-sm text-base-content/50">{t("campaignWizard.config.signature")}</label>
                        <button
                          type="button"
                          onClick={() => updateStep(idx, { emailSignature: ws.emailSignature === null ? "" : null })}
                          className="text-xs text-base-content/40 hover:text-base-content/70 transition-colors"
                        >
                          {ws.emailSignature === null ? t("campaignWizard.config.overrideDefault") : t("campaignWizard.config.useAccountDefault")}
                        </button>
                      </div>
                      {ws.emailSignature === null ? (
                        <p className="text-xs text-base-content/30 italic px-1">{t("campaignWizard.config.usingAccountSig")}</p>
                      ) : (
                        <textarea
                          className="textarea textarea-bordered w-full bg-base-300/50 text-sm resize-none font-mono h-20"
                          placeholder={t("campaignWizard.config.sigPlaceholder")}
                          value={ws.emailSignature}
                          onChange={(e) => updateStep(idx, { emailSignature: e.target.value })}
                        />
                      )}
                    </div>

                    {/* Preview / Send-test — only meaningful for manual (non-AI) mode */}
                    {!ws.aiEnabled && (
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => { setEmailPreviewIdx(idx); setConfigIdx(null); }} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-base-300/60 text-base-content/70 hover:bg-base-300 transition-colors border border-base-300/50">
                          <RiEyeLine size={14} /> {t("campaignWizard.config.preview")}
                        </button>
                        <button type="button" onClick={() => { setTestEmailIdx(idx); setTestEmailAccountId(emailAccounts.find((e) => e.is_verified)?.id ?? ""); setConfigIdx(null); }} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-warning/10 text-warning border border-warning/20 hover:bg-warning/20 transition-colors">
                          <RiMailSendLine size={14} /> {t("campaignWizard.config.sendTest")}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Modal footer */}
              <div className="flex items-center justify-between px-5 py-3.5 border-t border-gray-200 dark:border-gray-800 shrink-0">
                <button
                  type="button"
                  onClick={() => { removeWizardStep(idx); setConfigIdx(null); }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-error/10 text-error border border-error/20 hover:bg-error/20 transition-colors"
                >
                  <RiDeleteBinLine size={13} /> {t("campaignWizard.config.removeStep")}
                </button>
                <button
                  type="button"
                  onClick={() => setConfigIdx(null)}
                  className="inline-flex items-center px-5 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors"
                >
                  {t("campaignWizard.config.done")}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Email Preview Modal ── */}
      {emailPreviewIdx !== null && (() => {
        const ws = wizardSteps[emailPreviewIdx];
        const previewSubject = ws.emailSubject
          .replace(/\{\{first_name\}\}/g, "Alex")
          .replace(/\{\{last_name\}\}/g, "Johnson")
          .replace(/\{\{company\}\}/g, "Acme Corp")
          .replace(/\{\{title\}\}/g, "Head of Growth");
        const previewBody = ws.emailBody
          .replace(/\{\{first_name\}\}/g, "Alex")
          .replace(/\{\{last_name\}\}/g, "Johnson")
          .replace(/\{\{company\}\}/g, "Acme Corp")
          .replace(/\{\{title\}\}/g, "Head of Growth");
        const senderAccount = emailAccounts.find((e) => e.is_verified);
        const fromName = senderAccount?.name ?? "You";
        const fromEmail = senderAccount?.from_email ?? "you@example.com";
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
              {/* Email client chrome */}
              <div className="bg-[#f5f5f5] border-b border-gray-200 px-6 py-4 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-400" />
                  <div className="w-3 h-3 rounded-full bg-yellow-400" />
                  <div className="w-3 h-3 rounded-full bg-green-400" />
                </div>
                <p className="text-xs text-gray-500 font-medium">{t("campaignWizard.config.emailPreviewTitle")}</p>
                <button
                  onClick={() => setEmailPreviewIdx(null)}
                  className="text-gray-400 hover:text-gray-600 transition-colors w-6 h-6 flex items-center justify-center rounded"
                >✕</button>
              </div>
              {/* Email header */}
              <div className="bg-white border-b border-gray-100 px-6 py-4 shrink-0">
                <h2 className="text-lg font-semibold text-gray-900 mb-3">{previewSubject || <span className="text-gray-300 italic">({t("campaignWizard.steps.noSubject")})</span>}</h2>
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-sm font-semibold text-blue-600 shrink-0">
                    {fromName.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-900">{fromName}</span>
                      <span className="text-xs text-gray-400">&lt;{fromEmail}&gt;</span>
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      To: <span className="text-gray-600">Alex Johnson &lt;alex@acmecorp.com&gt;</span>
                    </div>
                  </div>
                  <span className="text-xs text-gray-400 shrink-0">Just now</span>
                </div>
              </div>
              {/* Email body */}
              <div className="flex-1 overflow-y-auto bg-white px-8 py-6">
                <div className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap font-[Georgia,serif] max-w-none">
                  {previewBody || <span className="text-gray-300 italic">...</span>}
                </div>
                {(() => {
                  const sig = ws.emailSignature !== null
                    ? ws.emailSignature.trim()
                    : senderAccount?.signature?.trim() ?? "";
                  return sig ? (
                    <div className="mt-8 pt-6 border-t border-gray-100 text-xs text-gray-400 whitespace-pre-wrap font-mono">
                      --{"\n"}
                      {sig}
                    </div>
                  ) : null;
                })()}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── AI Preview Modal ── */}
      {previewIdx !== null && (() => {
        const ws = wizardSteps[previewIdx];
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-2xl shadow-xl shadow-2xl w-full max-w-lg p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <RiRobot2Line size={16} className="text-primary" />
                  <h3 className="font-semibold text-base">{t("campaignWizard.config.previewAiOutput")}</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setPreviewIdx(null)}
                  className="text-base-content/40 hover:text-base-content transition-colors text-lg leading-none"
                >×</button>
              </div>

              <p className="text-xs text-base-content/40">
                {t("campaignWizard.config.previewAiDesc")}
              </p>

              {/* List selector */}
              <div>
                <label className="text-xs text-base-content/50 block mb-1">{t("campaignWizard.summary.list")}</label>
                <select
                  className="select select-sm w-full"
                  value={previewListId}
                  onChange={(e) => { setPreviewListId(e.target.value); loadPreviewTargets(e.target.value); }}
                >
                  <option value="">{t("campaignWizard.config.chooseList")}</option>
                  {lists.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>

              {/* Lead selector */}
              {previewListTargets.length > 0 && (
                <div>
                  <label className="text-xs text-base-content/50 block mb-1">Lead</label>
                  <select
                    className="select select-sm w-full"
                    value={previewTargetId}
                    onChange={(e) => setPreviewTargetId(e.target.value)}
                  >
                    <option value="">{t("campaignWizard.config.chooseLead")}</option>
                    {previewListTargets.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.full_name ?? t.linkedin_url}{t.title ? ` — ${t.title}` : ""}{t.company ? ` @ ${t.company}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Generate button */}
              <button
                type="button"
                onClick={runPreview}
                disabled={previewLoading || !previewTargetId || !ws.aiModel}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-white disabled:opacity-40 hover:bg-primary/90 transition-colors"
              >
                {previewLoading
                  ? <><RiLoader4Line size={14} className="animate-spin" /> {t("campaignWizard.config.generating")}</>
                  : <><RiRobot2Line size={14} /> {t("campaignWizard.config.generate")}</>}
              </button>

              {!ws.aiModel && (
                <p className="text-xs text-warning">{t("campaignWizard.config.noModelSelected")}</p>
              )}

              {/* Result */}
              {previewResult && (
                <div className="space-y-3">
                  {previewResult.subject && (
                    <div>
                      <p className="text-xs text-base-content/40 mb-1">{t("campaignWizard.config.subject")}</p>
                      <div className="bg-base-300/50 rounded-lg px-3 py-2 text-sm font-medium">{previewResult.subject}</div>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-base-content/40 mb-1">
                      {t("campaignWizard.config.body")}
                      <span className="ml-2 text-base-content/25">{previewResult.body.trim().split(/\s+/).filter(Boolean).length} {t("campaignWizard.config.days") === "días" ? "palabras" : "words"}</span>
                    </p>
                    <div className="bg-base-300/50 rounded-lg px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">{previewResult.body}</div>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-base-content/30 pt-1">
                    {(previewResult.input_tokens || previewResult.output_tokens) ? (
                      <span>{(previewResult.input_tokens ?? 0) + (previewResult.output_tokens ?? 0)} tokens ({previewResult.input_tokens ?? 0} in / {previewResult.output_tokens ?? 0} out)</span>
                    ) : null}
                    {previewResult.cost_usd != null && previewResult.cost_usd > 0 && (
                      <span>${previewResult.cost_usd.toFixed(5)}</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── Test Email Modal ── */}
      {testEmailIdx !== null && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-2xl shadow-xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="font-semibold text-base mb-1">{t("campaignWizard.config.sendTestTitle")}</h3>
            <p className="text-xs text-base-content/50 mb-5">
              {t("campaignWizard.config.sendTestDesc")}
            </p>
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-xs text-base-content/50 block mb-1">{t("campaignWizard.config.sendFrom")}</label>
                {emailAccounts.filter((e) => e.is_verified).length === 0 ? (
                  <p className="text-xs text-warning">{t("campaignWizard.account.noVerifiedEmail")} <Link href="/settings?tab=email" className="underline">{t("campaignWizard.account.addInSettings")}</Link></p>
                ) : (
                  <select
                    className="select select-bordered select-sm w-full bg-base-300/50 text-sm"
                    value={testEmailAccountId}
                    onChange={(e) => setTestEmailAccountId(e.target.value)}
                  >
                    <option value="">{t("campaignWizard.config.chooseAccount")}</option>
                    {emailAccounts.filter((e) => e.is_verified).map((e) => (
                      <option key={e.id} value={e.id}>{e.name} ({e.from_email})</option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label className="text-xs text-base-content/50 block mb-1">{t("campaignWizard.config.sendTo")}</label>
                <input
                  type="email"
                  className="input input-bordered input-sm w-full bg-base-300/50"
                  placeholder="your@email.com"
                  value={testEmailTo}
                  onChange={(e) => setTestEmailTo(e.target.value)}
                  autoFocus
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => { setTestEmailIdx(null); setTestEmailTo(""); }}
                className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm text-base-content/60 hover:text-base-content hover:bg-base-300/50 transition-colors"
              >
                {t("campaignWizard.nav.cancel")}
              </button>
              <button
                type="button"
                onClick={sendTestEmail}
                disabled={testEmailSending || !testEmailAccountId || !testEmailTo}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-warning text-warning-content hover:bg-warning/90 transition-colors disabled:opacity-40"
              >
                {testEmailSending ? <span className="loading loading-spinner loading-xs" /> : <RiMailSendLine size={14} />}
                {t("campaignWizard.config.sendTest")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Analytics Panel ──────────────────────────────────────────────────────────

interface AnalyticsData {
  funnel: {
    total: number; connections_sent: number; connected: number;
    messages_sent: number; inmails_sent: number; li_replies: number;
    emails_sent: number; email_replies: number; completed: number;
  };
  activity: { day: string; visits: number; connections: number; messages: number; inmails: number; emails: number }[];
  aiDaily: { day: string; cost_usd: number; input_tokens: number; output_tokens: number }[];
  aiByStep: { step_order: number; step_type: string; call_count: number; input_tokens: number; output_tokens: number; cost_usd: number; models: string }[];
}

const ANALYTICS_SERIES = [
  { key: "connections" as const, color: "#32d583", label: "Connects" },
  { key: "messages" as const,    color: "#f4b740", label: "Messages" },
  { key: "inmails" as const,     color: "#e879f9", label: "InMails" },
  { key: "emails" as const,      color: "#fb923c", label: "Emails" },
];

const DAY_OPTS = [7, 14, 30, 90];

const STEP_TYPE_LABEL: Record<string, string> = {
  visit: "Visit", follow: "Follow", connect: "Connect", message: "LI Message", sales_inmail: "InMail", email: "Email",
};

function AnalyticsPanel({ workflowId, days: initialDays }: { workflowId: string; days: number }) {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [days, setDays] = useState(initialDays);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/workflows/${workflowId}/analytics?days=${days}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [workflowId, days]);

  if (loading || !data) {
    return (
      <div className="flex items-center gap-2 text-base-content/40 text-sm py-16 justify-center">
        <span className="loading loading-spinner loading-xs" /> Loading analytics…
      </div>
    );
  }

  const { funnel, activity, aiDaily, aiByStep } = data;
  const maxFunnel = funnel.total || 1;
  const maxActivity = Math.max(...activity.flatMap(d => ANALYTICS_SERIES.map(s => d[s.key])), 1);
  const maxAiCost = Math.max(...aiDaily.map(d => d.cost_usd ?? 0), 0.000001);
  const totalAiCost = aiDaily.reduce((s, d) => s + (d.cost_usd ?? 0), 0);
  const totalAiTokens = aiDaily.reduce((s, d) => s + (d.input_tokens ?? 0) + (d.output_tokens ?? 0), 0);
  const hasAiData = totalAiCost > 0;
  const labelEvery = days <= 7 ? 1 : days <= 14 ? 2 : days <= 30 ? 5 : 15;

  function FunnelBar({ label, value, color }: { label: string; value: number; color: string }) {
    const pct = Math.max(2, (value / maxFunnel) * 100);
    const rate = funnel.total > 0 ? Math.round((value / funnel.total) * 100) : 0;
    return (
      <div className="flex items-center gap-3 py-2">
        <span className="text-xs text-base-content/50 w-28 shrink-0">{label}</span>
        <div className="flex-1 h-1.5 bg-base-300/30 rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: color }} />
        </div>
        <span className="text-sm font-semibold tabular-nums w-12 text-right" style={{ color }}>{value.toLocaleString()}</span>
        <span className="text-xs text-base-content/30 w-8 text-right">{rate}%</span>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-8">
      {/* Day picker */}
      <div className="flex items-center justify-between pl-11">
        <p className="text-sm text-base-content/40">Campaign performance over time</p>
        <div className="flex items-center gap-0.5 bg-base-300/50 rounded-lg p-0.5">
          {DAY_OPTS.map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${days === d ? "bg-base-100 text-base-content shadow-sm" : "text-base-content/35 hover:text-base-content/60"}`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Rate cards row */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: "Acceptance rate", value: funnel.connections_sent > 0 ? Math.round((funnel.connected / funnel.connections_sent) * 100) : 0, color: "#32d583" },
          { label: "LI reply rate",   value: (funnel.messages_sent + funnel.inmails_sent) > 0 ? Math.round((funnel.li_replies / (funnel.messages_sent + funnel.inmails_sent)) * 100) : 0, color: "#c084fc" },
          { label: "Email reply rate",value: funnel.emails_sent > 0     ? Math.round((funnel.email_replies / funnel.emails_sent) * 100)   : 0, color: "#fb923c" },
          { label: "Completion rate", value: funnel.total > 0           ? Math.round((funnel.completed / funnel.total) * 100)             : 0, color: "#5aa2ff" },
        ].map(card => (
          <div key={card.label} className="bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-2xl shadow-xs p-3">
            <div className="text-xl font-bold tabular-nums" style={{ color: card.color }}>{card.value}%</div>
            <div className="text-[10px] text-base-content/40 mt-1 leading-tight">{card.label}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 280px" }}>
        {/* Left: activity chart + AI cost */}
        <div className="space-y-4">
          {/* Activity chart */}
          <div className="bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-2xl shadow-xs p-5">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-medium text-base-content">Daily activity</span>
              <div className="flex items-center gap-3">
                {ANALYTICS_SERIES.map(s => (
                  <span key={s.key} className="flex items-center gap-1.5 text-xs" style={{ color: s.color }}>
                    <span className="w-2 h-2 rounded-sm inline-block" style={{ background: s.color }} />
                    {s.label}
                  </span>
                ))}
              </div>
            </div>
            <div className="relative" style={{ height: 120 }}>
              {[0.25, 0.5, 0.75, 1].map(g => (
                <div key={g} className="absolute left-0 right-0 border-t border-base-300/20" style={{ bottom: `${g * 100}%` }} />
              ))}
              <div className="absolute inset-0 flex items-end gap-0.5">
                {activity.map((d, i) => {
                  const showLabel = i % labelEvery === 0;
                  return (
                    <div key={d.day} className="flex flex-col items-center flex-1 group relative h-full justify-end">
                      <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-base-300 border border-base-300 rounded-lg px-2.5 py-2 text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-10 shadow-xl">
                        <div className="text-base-content/40 mb-1 font-medium">{d.day}</div>
                        {ANALYTICS_SERIES.map(s => (
                          <div key={s.key} className="flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.color }} />
                            <span style={{ color: s.color }}>{d[s.key]} {s.label.toLowerCase()}</span>
                          </div>
                        ))}
                      </div>
                      <div className="flex items-end gap-px w-full">
                        {ANALYTICS_SERIES.map(s => (
                          <div
                            key={s.key}
                            className="flex-1 rounded-t-sm transition-all"
                            style={{
                              height: `${Math.max(2, (d[s.key] / maxActivity) * 100)}px`,
                              background: s.color,
                              opacity: d[s.key] === 0 ? 0.08 : 0.75,
                            }}
                          />
                        ))}
                      </div>
                      {showLabel && (
                        <span className="text-[9px] text-base-content/20 mt-1 leading-none shrink-0">{d.day.slice(5)}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* AI cost card */}
          <div className="bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-2xl shadow-xs p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <RiRobot2Line size={13} className="text-base-content/30" />
                <span className="text-sm font-medium text-base-content">AI cost</span>
              </div>
              {hasAiData && (
                <div className="flex items-center gap-4 text-xs">
                  <span className="text-base-content/30 tabular-nums">{totalAiTokens.toLocaleString()} tokens</span>
                  <span className="font-semibold tabular-nums" style={{ color: "#a78bfa" }}>${totalAiCost.toFixed(4)}</span>
                </div>
              )}
            </div>

            {!hasAiData ? (
              <p className="text-xs text-base-content/20 py-2">No AI usage for this campaign.</p>
            ) : (
              <>
                {/* Daily bar chart */}
                <div className="flex items-end gap-0.5 mb-5" style={{ height: 56 }}>
                  {aiDaily.map((d, i) => {
                    const showLabel = i % labelEvery === 0;
                    const height = Math.max(2, ((d.cost_usd ?? 0) / maxAiCost) * 48);
                    return (
                      <div key={d.day} className="flex flex-col items-center flex-1 group relative justify-end" style={{ height: "100%" }}>
                        <div className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 bg-base-300 border border-base-300 rounded-lg px-2.5 py-1.5 text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-10 shadow-xl">
                          <div className="text-base-content/40 mb-1">{d.day}</div>
                          <div style={{ color: "#a78bfa" }}>${(d.cost_usd ?? 0).toFixed(5)}</div>
                          <div className="text-base-content/40">{((d.input_tokens ?? 0) + (d.output_tokens ?? 0)).toLocaleString()} tok</div>
                        </div>
                        <div className="w-full rounded-t-sm" style={{ height, background: "#a78bfa", opacity: (d.cost_usd ?? 0) === 0 ? 0.08 : 0.65 }} />
                        {showLabel && (
                          <span className="text-[9px] text-base-content/20 mt-1 leading-none">{d.day.slice(5)}</span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Per-step breakdown */}
                {aiByStep.length > 0 && (
                  <div className="border-t border-gray-200 dark:border-gray-800 pt-4">
                    <p className="text-xs text-base-content/30 uppercase tracking-widest mb-3">By step</p>
                    <div className="space-y-2">
                      {aiByStep.map(step => {
                        const stepPct = totalAiCost > 0 ? (step.cost_usd / totalAiCost) * 100 : 0;
                        const stepLabel = `Step ${step.step_order} — ${STEP_TYPE_LABEL[step.step_type] ?? step.step_type}`;
                        const model = step.models?.split(",")[0] ?? "";
                        const shortModel = model.includes("/") ? model.split("/").pop() ?? model : model;
                        return (
                          <div key={step.step_order} className="group">
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-xs font-medium text-base-content/70 truncate">{stepLabel}</span>
                                {shortModel && (
                                  <span className="text-[10px] text-base-content/25 truncate hidden group-hover:inline">{shortModel}</span>
                                )}
                              </div>
                              <div className="flex items-center gap-3 shrink-0 ml-3">
                                <span className="text-[10px] text-base-content/30 tabular-nums">{step.call_count} calls</span>
                                <span className="text-[10px] text-base-content/30 tabular-nums">{(step.input_tokens + step.output_tokens).toLocaleString()} tok</span>
                                <span className="text-xs font-semibold tabular-nums" style={{ color: "#a78bfa" }}>${step.cost_usd.toFixed(4)}</span>
                              </div>
                            </div>
                            <div className="h-1 bg-base-300/30 rounded-full overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${stepPct}%`, background: "#a78bfa", opacity: 0.6 }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Right: funnel + rate cards */}
        <div className="space-y-3">
          <div className="bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-2xl shadow-xs p-4">
            <div className="mb-4">
              <span className="text-xs font-medium text-base-content/30 uppercase tracking-widest">Funnel</span>
            </div>
            <div className="space-y-0.5">
              <FunnelBar label="Prospects" value={funnel.total} color="#808080" />
              <FunnelBar label="Connections sent" value={funnel.connections_sent} color="#32d583" />
              <FunnelBar label="Connected" value={funnel.connected} color="#32d583" />
              <FunnelBar label="LI Messages" value={funnel.messages_sent} color="#f4b740" />
              <FunnelBar label="InMails sent" value={funnel.inmails_sent} color="#e879f9" />
              <FunnelBar label="LI Replies" value={funnel.li_replies} color="#c084fc" />
              <FunnelBar label="Emails sent" value={funnel.emails_sent} color="#fb923c" />
              <FunnelBar label="Email replies" value={funnel.email_replies} color="#32d583" />
              <div className="pt-2 border-t border-gray-200 dark:border-gray-800 mt-2">
                <FunnelBar label="Completed" value={funnel.completed} color="#5aa2ff" />
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

interface LogRow {
  id: string;
  run_id: string;
  target_id: string | null;
  level: "info" | "warn" | "error";
  message: string;
  created_at: string;
  target_name: string | null;
  target_url: string | null;
}

function LogsPanel({ workflowId }: { workflowId: string }) {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch(`/api/workflows/${workflowId}/logs`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs);
      }
    } finally {
      setLoading(false);
    }
  }, [workflowId]);

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 4000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  return (
    <div className="space-y-4 pb-8 pl-11 pr-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Registro de Actividad en Vivo</h2>
          <p className="text-xs text-base-content/50">Historial detallado de todas las acciones ejecutadas por el bot en LinkedIn y Email</p>
        </div>
        <button
          onClick={() => { setLoading(true); fetchLogs(); }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-base-200 text-base-content/70 hover:bg-base-300 transition-colors"
        >
          <RiRefreshLine size={13} className={loading ? "animate-spin" : ""} /> Actualizar logs
        </button>
      </div>

      <div className="bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-2xl shadow-xs overflow-hidden shadow-xs">
        <div className="overflow-x-auto max-h-[calc(100vh-230px)]">
          <table className="table table-sm w-full">
            <thead className="sticky top-0 bg-base-200 z-10">
              <tr className="border-b border-base-300/60 text-[11px] text-base-content/40 uppercase tracking-wider">
                <th className="w-36">Hora</th>
                <th className="w-24">Nivel</th>
                <th className="w-56">Prospecto</th>
                <th>Acción / Mensaje del Bot</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-base-300/30 text-xs">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center py-16 text-base-content/30">
                    No hay registros de actividad aún en esta campaña.
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const levelColors = {
                    info: "bg-blue-500/10 text-blue-500 border-blue-500/20",
                    warn: "bg-amber-500/10 text-amber-500 border-amber-500/20",
                    error: "bg-red-500/10 text-red-500 border-red-500/20",
                  };
                  const date = new Date(log.created_at);
                  const timeStr = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
                  const dateStr = date.toLocaleDateString([], { month: "short", day: "numeric" });

                  return (
                    <tr key={log.id} className="hover:bg-base-300/40 transition-colors">
                      <td className="text-base-content/40 whitespace-nowrap text-[11px] font-mono">
                        {dateStr} {timeStr}
                      </td>
                      <td>
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase border ${levelColors[log.level] ?? levelColors.info}`}>
                          {log.level}
                        </span>
                      </td>
                      <td className="font-medium text-base-content/90 whitespace-nowrap">
                        {log.target_name ? (
                          <a
                            href={log.target_url || "#"}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:underline text-primary inline-flex items-center gap-1"
                          >
                            {log.target_name}
                          </a>
                        ) : (
                          <span className="text-base-content/30">—</span>
                        )}
                      </td>
                      <td className="text-base-content/80 font-mono text-[11px]">
                        {log.message}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function WorkflowDetailPage({
  workflow: initial,
  lists,
  accounts,
  emailAccounts,
  templates,
  activeRunEmailAccountIds,
  autoSetup,
}: {
  workflow: WorkflowData;
  lists: List[];
  accounts: Account[];
  emailAccounts: EmailAccount[];
  templates: Template[];
  activeRunEmailAccountIds: string[];
  autoSetup: boolean;
}) {
  const { t } = useTranslation();
  const [workflowName, setWorkflowName] = useState(initial.name);
  const [steps, setSteps] = useState<Step[]>(initial.steps);
  const [stats, setStats] = useState<Stats | null>(null);
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [prospectsTotal, setProspectsTotal] = useState(0);
  const [prospectsPage, setProspectsPage] = useState(0);
  const PROSPECTS_PAGE_SIZE = 25;
  // selectedStep: { track, step_order } for a specific step, or a string sentinel for outcome filters
  const [selectedStep, setSelectedStep] = useState<{ track: string; step_order: number } | "completed" | "failed" | null>(null);
  const [showWizard, setShowWizard] = useState(autoSetup || initial.steps.length === 0);
  const [wizardMode, setWizardMode] = useState<WizardMode>("launch");
  const [showStop, setShowStop] = useState(false);
  const [activeTab, setActiveTab] = useState<"prospects" | "analytics" | "logs">("prospects");
  const [days] = useState(30);
  const [errorModal, setErrorModal] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [prospectFilters, setProspectFilters] = useState<ActiveFilter[]>([]);
  const router = useRouter();

  // Strip ?setup=1 from URL so refreshing doesn't re-open the wizard
  useEffect(() => {
    if (autoSetup) router.replace(`/workflows/${initial.id}`, undefined, { shallow: true });
  }, []);

  const activeRun = stats?.active_run ?? initial.active_run;
  const isRunning = activeRun?.status === "running";
  const isPaused = activeRun?.status === "paused";
  const isActive = isRunning || isPaused;

  const actionSteps = steps.filter((s) => s.step_type !== "delay");

  const refreshStats = useCallback(async () => {
    const res = await fetch(`/api/workflows/${initial.id}/stats`);
    if (res.ok) setStats(await res.json());
  }, [initial.id]);

  const refreshProspects = useCallback(async () => {
    const params = new URLSearchParams();
    if (selectedStep !== null && selectedStep !== "completed" && selectedStep !== "failed") {
      params.set("step", String(selectedStep.step_order));
      params.set("track", selectedStep.track);
    }
    if (selectedStep === "completed") params.set("state", "completed");
    if (selectedStep === "failed") params.set("state", "failed,skipped");
    params.set("page", String(prospectsPage));
    if (search.trim()) params.set("search", search.trim());
    filtersToParams(prospectFilters).forEach((v, k) => params.set(k, v));
    const res = await fetch(`/api/workflows/${initial.id}/prospects?${params}`);
    if (res.ok) {
      const data = await res.json();
      setProspects(data.prospects);
      setProspectsTotal(data.total);
    }
  }, [initial.id, selectedStep, prospectsPage, search, prospectFilters]);

  const refreshSteps = useCallback(async () => {
    const res = await fetch(`/api/workflows/${initial.id}/steps`);
    if (res.ok) setSteps(await res.json());
  }, [initial.id]);

  // Reset to page 0 when filter/search changes
  useEffect(() => { setProspectsPage(0); }, [selectedStep, search, prospectFilters]);

  useEffect(() => {
    refreshStats();
    refreshProspects();
  }, [refreshStats, refreshProspects]);

  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(() => {
      refreshStats();
      refreshProspects();
    }, 5000);
    return () => clearInterval(interval);
  }, [isActive, refreshStats, refreshProspects]);

  async function pauseRun() {
    if (!activeRun) return;
    await fetch(`/api/runs/${activeRun.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "paused" }),
    });
    toast.success("Paused");
    refreshStats();
  }

  async function resumeRun() {
    if (!activeRun) return;
    await fetch(`/api/runs/${activeRun.id}/start`, { method: "POST" });
    toast.success("Resumed");
    refreshStats();
  }

  async function stopRun() {
    if (!activeRun) return;
    await fetch(`/api/runs/${activeRun.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "completed" }),
    });
    toast.success("Campaign stopped");
    setShowStop(false);
    refreshStats();
    refreshProspects();
  }

  async function unenrollProspect(runId: string, targetId: string) {
    const res = await fetch(`/api/runs/${runId}/unenroll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_id: targetId }),
    });
    if (res.ok) {
      toast.success("Unenrolled");
      setProspects((prev) => prev.filter((p) => p.target_id !== targetId));
      setProspectsTotal((prev) => prev - 1);
      refreshStats();
    } else {
      const err = await res.json();
      toast.error(err.error ?? "Failed to unenroll");
    }
  }

  async function retryProspect(runId: string, targetId: string) {
    const res = await fetch(`/api/runs/${runId}/retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_ids: [targetId] }),
    });
    if (res.ok) {
      toast.success("Retrying");
      setProspects((prev) =>
        prev.map((p) => p.target_id === targetId ? { ...p, state: "in_progress", error_message: null } : p)
      );
      refreshStats();
    } else {
      const err = await res.json();
      toast.error(err.error ?? "Failed to retry");
    }
  }

  async function removeProspect(runId: string, targetId: string) {
    const res = await fetch(`/api/runs/${runId}/remove`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_ids: [targetId] }),
    });
    if (res.ok) {
      toast.success("Removed from campaign");
      setProspects((prev) => prev.filter((p) => p.target_id !== targetId));
      setProspectsTotal((prev) => prev - 1);
      refreshStats();
    } else {
      const err = await res.json();
      toast.error(err.error ?? "Failed to remove");
    }
  }

  async function forceStep(runId: string, targetId?: string) {
    const res = await fetch(`/api/runs/${runId}/force-step`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(targetId ? { target_id: targetId } : { all: true }),
    });
    if (res.ok) {
      toast.success(targetId ? "⚡ Disparando acción ahora..." : "⚡ Disparando acción para todos ahora...");
      [1000, 5000, 15000, 30000].forEach((delay) => {
        setTimeout(() => {
          refreshStats();
          refreshProspects();
        }, delay);
      });
    } else {
      const err = await res.json();
      toast.error(err.error ?? "Error al forzar acción");
    }
  }

  // Group target_ids by run_id, then fire one request per run
  async function bulkAction(action: "retry" | "remove" | "unenroll", targetIds: string[]) {
    const grouped: Record<string, string[]> = {};
    for (const tid of targetIds) {
      const p = prospects.find((x) => x.target_id === tid);
      if (!p) continue;
      if (!grouped[p.run_id]) grouped[p.run_id] = [];
      grouped[p.run_id].push(tid);
    }
    let results: Response[];
    if (action === "unenroll") {
      // unenroll API takes one target_id at a time
      results = await Promise.all(
        Object.entries(grouped).flatMap(([runId, ids]) =>
          ids.map((tid) =>
            fetch(`/api/runs/${runId}/unenroll`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ target_id: tid }),
            })
          )
        )
      );
    } else {
      results = await Promise.all(
        Object.entries(grouped).map(([runId, ids]) =>
          fetch(`/api/runs/${runId}/${action}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ target_ids: ids }),
          })
        )
      );
    }
    if (!results.every((r) => r.ok)) { toast.error("Some actions failed"); return; }
    if (action === "retry") {
      toast.success(`Retried ${targetIds.length} prospect${targetIds.length !== 1 ? "s" : ""}`);
      setProspects((prev) => prev.map((p) => targetIds.includes(p.target_id) ? { ...p, state: "in_progress", error_message: null } : p));
    } else {
      toast.success(`${action === "remove" ? "Removed" : "Unenrolled"} ${targetIds.length} prospect${targetIds.length !== 1 ? "s" : ""}`);
      setProspects((prev) => prev.filter((p) => !targetIds.includes(p.target_id)));
      setProspectsTotal((prev) => prev - targetIds.length);
    }
    setSelected(new Set());
    refreshStats();
  }

  const displayStats = stats ?? {
    total_prospects: 0,
    active_prospects: 0,
    completed_prospects: 0,
    failed_prospects: 0,
    connections_sent: 0,
    connections_accepted: 0,
    acceptance_rate: 0,
    messages_sent: 0,
    inmails_sent: 0,
    emails_sent: 0,
    active_run: initial.active_run,
  };

  return (
    <>
    <Head>
      <title>{workflowName} — Campaigns — Dashboard B2B</title>
      <meta name="robots" content="noindex, nofollow" />
    </Head>
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <Link href="/workflows" className="w-8 h-8 rounded-lg flex items-center justify-center text-base-content/50 hover:bg-base-200 hover:text-base-content transition-colors shrink-0">
          <RiArrowLeftLine size={16} />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-semibold">{workflowName}</h1>
            {isRunning && (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium bg-primary/15 text-primary">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse inline-block" />
                {t("campaignDetail.running")}
              </span>
            )}
            {isPaused && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-warning/15 text-warning">
                {t("campaignDetail.paused")}
              </span>
            )}
            {!isActive && displayStats.total_prospects > 0 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-base-300 text-base-content/40">
                {t("campaignDetail.idle")}
              </span>
            )}
            {/* Inline stats — shown only when there's data */}
            {displayStats.total_prospects > 0 && (
              <div className="flex items-center gap-3 ml-1">
                <span className="text-base-content/30 text-xs">·</span>
                <span className="text-xs text-base-content/50">
                  <span className="font-semibold text-base-content/80">{displayStats.total_prospects}</span> {t("campaignDetail.statsProspects")}
                </span>
                {displayStats.completed_prospects > 0 && (
                  <span className="text-xs text-base-content/50">
                    <span className="font-semibold text-success">{displayStats.completed_prospects}</span> {t("campaignDetail.statsDone")}
                  </span>
                )}
                {displayStats.connections_sent > 0 && (
                  <span className="text-xs text-base-content/50">
                    <span className="font-semibold text-primary">{displayStats.connections_sent}</span> {t("campaignDetail.statsReqsSent")}
                  </span>
                )}
                {displayStats.connections_accepted > 0 && (
                  <span className="text-xs text-base-content/50">
                    <span className="font-semibold text-success">{displayStats.connections_accepted}</span> {t("campaignDetail.statsConnected")}
                  </span>
                )}
                {displayStats.messages_sent > 0 && (
                  <span className="text-xs text-base-content/50">
                    <span className="font-semibold text-info">{displayStats.messages_sent}</span> {t("campaignDetail.statsMessaged")}
                  </span>
                )}
                {displayStats.inmails_sent > 0 && (
                  <span className="text-xs text-base-content/50">
                    <span className="font-semibold text-info">{displayStats.inmails_sent}</span> {t("campaignDetail.statsInmailed")}
                  </span>
                )}
                {displayStats.connections_sent > 0 && displayStats.acceptance_rate > 0 && (
                  <span className="text-xs text-base-content/40">{t("campaignDetail.statsAccepted", { rate: displayStats.acceptance_rate })}</span>
                )}
              </div>
            )}
          </div>
          {activeRun && (
            <p className="text-xs text-base-content/40 mt-0.5 pl-0">
              {activeRun.list_name} · {activeRun.account_name}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isRunning && activeRun && (
            <>
              <button
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 transition-colors"
                onClick={() => forceStep(activeRun.id)}
                title={t("campaignDetail.runAllNowTitle")}
              >
                <RiFlashlightLine size={14} className="text-amber-500" /> {t("campaignDetail.runAllNow")}
              </button>
              <button
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-warning/15 text-warning border border-warning/25 hover:bg-warning/25 transition-colors"
                onClick={pauseRun}
              >
                <RiPauseLine size={14} /> {t("campaignDetail.pause")}
              </button>
              <button
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-error/10 text-error border border-error/20 hover:bg-error/20 transition-colors"
                onClick={() => setShowStop(true)}
              >
                <RiStopLine size={14} /> {t("campaignDetail.stop")}
              </button>
              <button
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-base-200 text-base-content/70 border border-base-300/60 hover:border-base-300 hover:text-base-content transition-colors"
                onClick={() => { setWizardMode("add-contacts"); setShowWizard(true); }}
              >
                <RiAddLine size={14} /> {t("campaignDetail.addContacts")}
              </button>
            </>
          )}
          {isPaused && (
            <>
              <button
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-primary/15 text-primary border border-primary/25 hover:bg-primary/25 transition-colors"
                onClick={resumeRun}
              >
                <RiPlayLine size={14} /> {t("campaignDetail.resume")}
              </button>
              <button
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-error/10 text-error border border-error/20 hover:bg-error/20 transition-colors"
                onClick={() => setShowStop(true)}
              >
                <RiStopLine size={14} /> {t("campaignDetail.stop")}
              </button>
              <button
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-base-200 text-base-content/70 border border-base-300/60 hover:border-base-300 hover:text-base-content transition-colors"
                onClick={() => { setWizardMode("add-contacts"); setShowWizard(true); }}
              >
                <RiAddLine size={14} /> {t("campaignDetail.addContacts")}
              </button>
            </>
          )}
          {steps.length > 0 && (
            <button
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-base-200 text-base-content/70 border border-base-300/60 hover:border-base-300 hover:text-base-content transition-colors"
              onClick={() => { setWizardMode("edit"); setShowWizard(true); }}
            >
              <RiEditLine size={14} /> {t("campaignDetail.edit")}
            </button>
          )}
          {!isActive && (
            <>
              {(activeRun?.id || displayStats.active_run?.id) && (
                <button
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 transition-colors"
                  onClick={() => forceStep((activeRun?.id || displayStats.active_run?.id)!)}
                  title={t("campaignDetail.runAllNowTitle")}
                >
                  <RiFlashlightLine size={14} className="text-amber-500" /> {t("campaignDetail.runAllNow")}
                </button>
              )}
              <button
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-content hover:bg-primary/90 transition-colors"
                onClick={() => { setWizardMode(displayStats.total_prospects > 0 ? "add-contacts" : "launch"); setShowWizard(true); }}
              >
                <RiAddLine size={14} /> {displayStats.total_prospects > 0 ? t("campaignDetail.addContacts") : t("campaignDetail.addProspects")}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex items-center gap-1 border-b border-gray-200 dark:border-gray-800 mb-0 -mb-px pl-11">
        {[
          { id: "prospects", label: t("campaignDetail.tabProspects") },
          { id: "analytics", label: t("campaignDetail.tabAnalytics") },
          { id: "logs", label: t("campaignDetail.tabLogs") },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as "prospects" | "analytics" | "logs")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-base-content/40 hover:text-base-content/70"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Main layout */}
      {activeTab === "prospects" && <div className="flex gap-8" style={{ height: "calc(100vh - 148px)" }}>
        {/* Sidebar */}
        <div className="w-52 shrink-0 overflow-y-auto">
          {/* All prospects */}
          <button
            onClick={() => setSelectedStep(null)}
            className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors mb-4 flex items-center justify-between ${selectedStep === null ? "bg-primary/10 border border-primary/30 text-primary" : "hover:bg-base-200 text-base-content/60 border border-transparent"}`}
          >
            <span className="font-medium">{t("campaignDetail.allProspects")}</span>
            {displayStats.total_prospects > 0 && (
              <span className={`text-xs px-1.5 py-0.5 rounded-md ${selectedStep === null ? "bg-primary/20 text-primary" : "bg-base-300 text-base-content/40"}`}>
                {displayStats.total_prospects}
              </span>
            )}
          </button>

          {actionSteps.length > 0 && (
            <div>
              <p className="text-xs text-base-content/30 uppercase tracking-widest px-1 mb-3">{t("campaignDetail.pipeline")}</p>

              {/* Render each track independently, delays shown inline before their step */}
              {(["linkedin", "email"] as Track[]).map((track) => {
                const trackSteps = steps.filter((s) => (s.track ?? (s.step_type === "email" ? "email" : "linkedin")) === track);
                if (trackSteps.length === 0) return null;
                const trackActionSteps = trackSteps.filter((s) => s.step_type !== "delay");
                if (trackActionSteps.length === 0) return null;

                const isStepSelected = (s: Step) =>
                  typeof selectedStep === "object" && selectedStep !== null &&
                  selectedStep.track === track && selectedStep.step_order === s.step_order;

                const rendered: React.ReactNode[] = [];
                let prevDelay: Step | null = null;
                for (let i = 0; i < trackSteps.length; i++) {
                  const s = trackSteps[i];
                  if (s.step_type === "delay") { prevDelay = s; continue; }
                  const sel = isStepSelected(s);
                  const delayStep = prevDelay;
                  const delayDays = delayStep ? Math.round(delayStep.delay_seconds / 86400) : 0;
                  prevDelay = null;

                  rendered.push(
                    <div key={s.id} className="flex flex-col items-stretch">
                      {delayDays > 0 ? (
                        <>
                          <div className="flex justify-center"><div className="w-px h-3 bg-base-content/20" /></div>
                          <button
                            onClick={() => {
                              const delayKey = { track, step_order: delayStep!.step_order };
                              const isSel = typeof selectedStep === "object" && selectedStep !== null && selectedStep.track === track && selectedStep.step_order === delayStep!.step_order;
                              setSelectedStep(isSel ? null : delayKey);
                            }}
                            className={`w-full flex items-center gap-2 py-1 px-3 rounded-lg transition-colors ${typeof selectedStep === "object" && selectedStep !== null && selectedStep.track === track && selectedStep.step_order === delayStep?.step_order ? "bg-base-300/60 text-base-content/70" : "text-base-content/40 hover:text-base-content/70 hover:bg-base-200/60"}`}
                          >
                            <RiTimeLine size={11} className="shrink-0" />
                            <span className="text-xs">{t("campaignDetail.wait", { days: delayDays })}</span>
                          </button>
                          <div className="flex justify-center"><div className="w-px h-3 bg-base-content/20" /></div>
                        </>
                      ) : rendered.length > 0 ? (
                        <div className="flex justify-center"><div className="w-px h-4 bg-base-content/20" /></div>
                      ) : null}
                      <button
                        onClick={() => setSelectedStep(sel ? null : { track, step_order: s.step_order })}
                        className={`w-full text-left px-3 py-3 rounded-xl transition-all flex items-center gap-3 border ${sel ? "bg-primary/10 border-primary/30" : "bg-base-200 border-base-300/40 hover:border-base-300/80"}`}
                      >
                        <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-xs border ${sel ? "bg-primary/20 border-primary/40 text-primary" : `${STEP_COLORS[s.step_type]}`}`}>
                          {STEP_ICONS[s.step_type]}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs font-medium leading-tight truncate ${sel ? "text-primary" : "text-base-content"}`}>
                            {getStepLabel(s.step_type, t)}
                          </p>
                          {s.attachment_name && (
                            <p className="text-[10px] text-purple-400 font-normal truncate mt-0.5">
                              📎 {s.attachment_name}
                            </p>
                          )}
                        </div>
                      </button>
                    </div>
                  );
                }

                return (
                  <div key={track} className="mb-4">
                    {trackSteps.some(s => s.track) && (
                      <p className="text-xs text-base-content/20 uppercase tracking-widest px-1 mb-2">{track}</p>
                    )}
                    <div className="flex flex-col">{rendered}</div>
                  </div>
                );
              })}

              {/* Outcome filters */}
              {displayStats.total_prospects > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-800 flex flex-col gap-1.5">
                  <button
                    onClick={() => setSelectedStep(selectedStep === "completed" ? null : "completed")}
                    className={`w-full text-left px-3 py-2.5 rounded-xl text-xs transition-all flex items-center gap-2.5 border ${selectedStep === "completed" ? "text-success bg-success/10 border-success/20" : "text-base-content/50 hover:text-success bg-base-200 border-base-300/40 hover:border-success/20"}`}
                  >
                    <span className="w-2 h-2 rounded-full bg-success shrink-0" />
                    <span className="font-medium">{t("campaignDetail.completed", { count: displayStats.completed_prospects })}</span>
                  </button>
                  {displayStats.failed_prospects > 0 && (
                    <button
                      onClick={() => setSelectedStep(selectedStep === "failed" ? null : "failed")}
                      className={`w-full text-left px-3 py-2.5 rounded-xl text-xs transition-all flex items-center gap-2.5 border ${selectedStep === "failed" ? "text-error bg-error/10 border-error/20" : "text-base-content/50 hover:text-error bg-base-200 border-base-300/40 hover:border-error/20"}`}
                    >
                      <span className="w-2 h-2 rounded-full bg-error shrink-0" />
                      <span className="font-medium">{t("campaignDetail.failed", { count: displayStats.failed_prospects })}</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Prospects table */}
        <div className="flex-1 min-w-0 overflow-y-auto">
          {displayStats.total_prospects === 0 ? (
            <div className="text-center py-20 text-base-content/40 text-sm border border-base-300/50 rounded-lg">
              {steps.length === 0
                ? <span>{t("campaignDetail.noStepsYet")} <button className="text-primary underline" onClick={() => setShowWizard(true)}>{t("campaignDetail.setupCampaign")}</button></span>
                : <span>{t("campaignDetail.noProspectsYet")} <button className="text-primary underline" onClick={() => setShowWizard(true)}>{t("campaignDetail.addProspectsToStart")}</button></span>}
            </div>
          ) : (
            <div>
              {/* Search + filter + bulk action bar */}
              <div className="relative mb-2">
                {selected.size === 0 ? (
                  <div className="flex items-center gap-2.5 flex-wrap py-0.5">
                    <div className="relative shrink-0">
                      <RiSearchLine size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-base-content/30 pointer-events-none" />
                      <input
                        type="text"
                        placeholder={t("campaignDetail.searchProspects")}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-48 pl-7 pr-3 py-1.5 text-xs bg-base-200 border border-base-300/50 rounded-lg outline-none focus:border-primary/50 placeholder:text-base-content/30"
                      />
                    </div>
                    <div className="w-px h-4 bg-base-300/60 shrink-0" />
                    <FilterBar
                      filters={prospectFilters}
                      onChange={(f) => { setProspectFilters(f); setProspectsPage(0); }}
                      fieldSubset={["connection_status", "degree", "connection_requested_at", "connected_at", "message_sent_at", "seniority", "country", "company"]}
                    />
                  </div>
                ) : (() => {
                  const sel = prospects.filter((p) => selected.has(p.target_id));
                  const failedSel = sel.filter((p) => p.state === "failed");
                  const unenrollSel = sel.filter((p) => isActive && (p.state === "pending" || p.state === "in_progress"));
                  const removeSel = sel.filter((p) => p.state !== "completed");
                  return (
                    <div className="absolute inset-0 flex items-center gap-2 px-3 bg-base-200 border border-base-300/50 rounded-lg z-10">
                      <span className="text-xs text-base-content/50 flex-1">{t("campaignDetail.selectedCount", { count: selected.size })}</span>
                      {failedSel.length > 0 && (
                        <button
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium bg-info/10 text-info border border-info/20 hover:bg-info/20 transition-colors"
                          onClick={() => bulkAction("retry", failedSel.map((p) => p.target_id))}
                        >
                          <RiRefreshLine size={12} /> {t("campaignDetail.retryFailed", { count: failedSel.length })}
                        </button>
                      )}
                      {unenrollSel.length > 0 && (
                        <button
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium bg-warning/10 text-warning border border-warning/20 hover:bg-warning/20 transition-colors"
                          onClick={() => bulkAction("unenroll", unenrollSel.map((p) => p.target_id))}
                        >
                          <RiDeleteBinLine size={12} /> {t("campaignDetail.unenrollCount", { count: unenrollSel.length })}
                        </button>
                      )}
                      {removeSel.length > 0 && (
                        <button
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium bg-error/10 text-error border border-error/20 hover:bg-error/20 transition-colors"
                          onClick={() => bulkAction("remove", removeSel.map((p) => p.target_id))}
                        >
                          <RiDeleteBinLine size={12} /> {t("campaignDetail.removeCount", { count: removeSel.length })}
                        </button>
                      )}
                      <button
                        className="text-xs text-base-content/30 hover:text-base-content/60 transition-colors px-1"
                        onClick={() => setSelected(new Set())}
                      >
                        {t("campaignDetail.cancel")}
                      </button>
                    </div>
                  );
                })()}
              </div>

              <div className="overflow-x-auto rounded-xl border border-gray-300 dark:border-gray-700 shadow-xs">
                <table className="table w-full text-sm">
                  <thead>
                    <tr className="border-base-300/50 text-base-content/50 text-xs uppercase tracking-wide">
                      <th className="w-8">
                        <input
                          type="checkbox"
                          className="checkbox checkbox-xs"
                          checked={prospects.length > 0 && prospects.every((p) => selected.has(p.target_id))}
                          onChange={() => {
                            if (prospects.every((p) => selected.has(p.target_id))) {
                              setSelected((prev) => { const n = new Set(prev); prospects.forEach((p) => n.delete(p.target_id)); return n; });
                            } else {
                              setSelected((prev) => { const n = new Set(prev); prospects.forEach((p) => n.add(p.target_id)); return n; });
                            }
                          }}
                        />
                      </th>
                      <th>{t("campaignDetail.colName")}</th>
                      <th>{t("campaignDetail.colCompany")}</th>
                      <th>{t("campaignDetail.colStep")}</th>
                      <th>{t("campaignDetail.colStatus")}</th>
                      <th>{t("campaignDetail.colNextAction")}</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {prospects.length === 0 && (
                      <tr>
                        <td colSpan={7} className="text-center text-base-content/30 py-8 text-xs">
                          {t("campaignDetail.noProspectsMatch")}
                        </td>
                      </tr>
                    )}
                    {prospects.map((p) => (
                      <tr
                        key={p.id}
                        className={`border-base-300/30 hover:bg-base-200/50 cursor-pointer ${selected.has(p.target_id) ? "bg-base-200/30" : ""}`}
                        onClick={() => router.push(`/contacts/${p.target_id}`)}
                      >
                        <td onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            className="checkbox checkbox-xs"
                            checked={selected.has(p.target_id)}
                            onChange={() => setSelected((prev) => { const n = new Set(prev); n.has(p.target_id) ? n.delete(p.target_id) : n.add(p.target_id); return n; })}
                          />
                        </td>
                        <td>
                          <p className="font-medium text-sm">{p.full_name ?? "—"}</p>
                          {p.title && <p className="text-xs text-base-content/40 truncate max-w-40">{p.title}</p>}
                        </td>
                        <td className="text-xs text-base-content/60">{p.company ?? "—"}</td>
                        <td className="text-xs text-base-content/60">
                          {(() => {
                            const activeTrack = typeof selectedStep === "object" && selectedStep !== null ? selectedStep.track : null;
                            const st = activeTrack === "email" ? p.em_step_type : activeTrack === "linkedin" ? p.li_step_type : p.step_type;
                            return st === "connect" && p.connection_requested_at
                              ? t("campaignDetail.awaitingAcceptance")
                              : st === "email"
                              ? <span className="text-warning/80">{t("campaignWizard.steps.coldEmail")}</span>
                              : st ? getStepLabel(st, t) : "—";
                          })()}
                        </td>
                        <td>
                          <div className="flex items-center gap-1.5">
                            {(() => {
                              const isEmailBounce = p.state === "skipped" && !!p.error_message && (p.error_message.includes("bounced") || p.error_message.includes("domain invalid"));
                              const pillClass = isEmailBounce
                                ? "bg-warning/15 text-warning"
                                : (STATE_PILL[p.state] ?? "bg-base-300 text-base-content/50");
                              const label = isEmailBounce ? "email invalid" : p.state.replace("_", " ");
                              return (
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${pillClass}`}>
                                  {label}
                                </span>
                              );
                            })()}
                            {(p.state === "failed" || (p.state === "skipped" && p.error_message && (p.error_message.includes("bounced") || p.error_message.includes("domain invalid")))) && p.error_message && (
                              <button
                                className="text-warning/60 hover:text-warning transition-colors"
                                onClick={(e) => { e.stopPropagation(); setErrorModal(p.error_message!); }}
                              >
                                <RiErrorWarningLine size={13} />
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="text-xs text-base-content/50">
                          {formatNextAction(p.next_step_at, p.state, t)}
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1">
                            {p.state !== "completed" && (
                              <button
                                title={t("campaignDetail.runNowTitle")}
                                onClick={() => forceStep(p.run_id, p.target_id)}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 hover:bg-amber-500/25 border border-amber-500/30 transition-all shrink-0"
                              >
                                <RiFlashlightLine size={11} className="text-amber-500" /> {t("campaignDetail.runNow")}
                              </button>
                            )}
                            {p.state === "failed" && (
                              <button
                                title="Retry"
                                onClick={() => retryProspect(p.run_id, p.target_id)}
                                className="inline-flex items-center p-1 rounded text-base-content/20 hover:text-info hover:bg-info/10 transition-colors"
                              >
                                <RiRefreshLine size={13} />
                              </button>
                            )}
                            {p.state !== "completed" && (
                              <button
                                title={isActive && p.state !== "failed" ? "Unenroll from campaign" : "Remove from campaign"}
                                onClick={() => isActive && p.state !== "failed"
                                  ? unenrollProspect(p.run_id, p.target_id)
                                  : removeProspect(p.run_id, p.target_id)
                                }
                                className="inline-flex items-center p-1 rounded text-base-content/20 hover:text-error hover:bg-error/10 transition-colors"
                              >
                                <RiDeleteBinLine size={13} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {prospectsTotal > PROSPECTS_PAGE_SIZE && (
                <div className="flex items-center justify-between mt-3 text-sm text-base-content/50">
                  <span className="text-xs">{prospectsPage * PROSPECTS_PAGE_SIZE + 1}–{Math.min((prospectsPage + 1) * PROSPECTS_PAGE_SIZE, prospectsTotal)} of {prospectsTotal}</span>
                  <div className="flex items-center gap-1">
                    <button
                      className="inline-flex items-center justify-center w-6 h-6 rounded text-base-content/50 hover:text-base-content hover:bg-base-300/50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      onClick={() => setProspectsPage((p) => p - 1)}
                      disabled={prospectsPage === 0}
                    >
                      <RiArrowLeftSLine size={15} />
                    </button>
                    <span className="px-2 text-xs">{prospectsPage + 1} / {Math.ceil(prospectsTotal / PROSPECTS_PAGE_SIZE)}</span>
                    <button
                      className="inline-flex items-center justify-center w-6 h-6 rounded text-base-content/50 hover:text-base-content hover:bg-base-300/50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      onClick={() => setProspectsPage((p) => p + 1)}
                      disabled={prospectsPage >= Math.ceil(prospectsTotal / PROSPECTS_PAGE_SIZE) - 1}
                    >
                      <RiArrowRightSLine size={15} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>}

      {/* ── Analytics tab ── */}
      {activeTab === "analytics" && (
        <AnalyticsPanel workflowId={initial.id} days={days} />
      )}

      {/* ── Activity Logs tab ── */}
      {activeTab === "logs" && (
        <LogsPanel workflowId={initial.id} />
      )}

      {/* Wizard */}
      {showWizard && (
        <Wizard
          workflowId={initial.id}
          workflowName={workflowName}
          initialPrompt={initial.prompt ?? ""}
          initialSteps={steps}
          lists={lists}
          accounts={accounts}
          emailAccounts={emailAccounts}
          templates={templates}
          mode={wizardMode}
          activeRunId={activeRun?.id ?? null}
          activeRunListId={activeRun?.list_id ?? null}
          activeRunEmailAccountIds={activeRunEmailAccountIds}
          onClose={() => { setShowWizard(false); setWizardMode("launch"); refreshSteps(); }}
          onLaunched={() => { setShowWizard(false); setWizardMode("launch"); refreshSteps(); refreshStats(); refreshProspects(); }}
          onRenamed={setWorkflowName}
        />
      )}

      {/* Error details modal */}
      {errorModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setErrorModal(null)}>
          <div className="bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-2xl shadow-xs p-5 max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-3">
              <RiErrorWarningLine className="text-error" size={16} />
              <span className="text-sm font-semibold">Error details</span>
            </div>
            <pre className="text-xs text-base-content/70 bg-base-300 rounded-lg p-3 overflow-auto max-h-64 whitespace-pre-wrap break-all">
              {errorModal}
            </pre>
            <button className="mt-4 btn btn-sm btn-ghost w-full" onClick={() => setErrorModal(null)}>Close</button>
          </div>
        </div>
      )}

      {/* Stop confirm */}
      {showStop && (
        <div className="modal modal-open">
          <div className="modal-box bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-2xl shadow-xl max-w-sm">
            <h3 className="font-semibold text-base mb-2">{t("campaignDetail.stopCampaignTitle")}</h3>
            <p className="text-sm text-base-content/60 mb-4">
              {t("campaignDetail.stopCampaignDesc")}
            </p>
            <div className="modal-action mt-2">
              <button className="px-4 py-2 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" onClick={() => setShowStop(false)}>{t("campaignDetail.cancel")}</button>
              <button className="px-4 py-2 rounded-xl text-sm font-semibold bg-rose-500 hover:bg-rose-600 !text-white transition-colors shadow-xs" onClick={stopRun}>{t("campaignDetail.stopCampaignConfirm")}</button>
            </div>
          </div>
          <div className="modal-backdrop" onClick={() => setShowStop(false)} />
        </div>
      )}
    </div>
    </>
  );
}
