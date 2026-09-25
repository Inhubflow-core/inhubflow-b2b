import { useState, useEffect, useId, useRef } from "react";
import Head from "next/head";
import { useSession } from "next-auth/react";
import { useRouter } from "next/router";

import {
  RiShieldCheckLine,
  RiUserFollowLine,
  RiCpuLine,
  RiLinkedinBoxFill,
  RiSearchLine,
  RiEditLine,
  RiUserAddLine,
  RiCheckLine,
  RiCloseLine,
  RiRefreshLine,
  RiVipCrownLine,
  RiInformationLine,
  RiHandHeartLine,
  RiFileCopyLine,
  RiMoneyDollarCircleLine,
  RiExternalLinkLine,
  RiBankCardLine,
  RiMailSendLine,
  RiCustomerService2Line,
  RiMessage3Line,
  RiSendPlaneFill,
  RiTimeLine,
  RiCheckboxCircleLine,
  RiChat1Line,
  RiFireFill,
  RiRobot3Line,
  RiUser3Line,
  RiBrainLine,
  RiWhatsappLine,
} from "react-icons/ri";
import { toast } from "sonner";
import { useTranslation } from "@/lib/i18n/LanguageContext";

interface Subscriber {
  id: string;
  email: string;
  role: string;
  company_name?: string;
  slots_limit: number;
  subscription_status: "active" | "trial" | "past_due" | "canceled";
  plan_tier: "starter" | "growth" | "business" | "custom";
  paddle_customer_id?: string;
  paddle_subscription_id?: string;
  lemon_customer_id?: string;
  lemon_subscription_id?: string;
  partner_id?: string;
  created_at: string;
  updated_at: string;
}

interface Stats {
  totalSubscribers: number;
  activeSubscriptions: number;
  totalSlotsAllocated: number;
  totalConnectedAccounts: number;
}

interface Partner {
  id: string;
  code: string;
  name: string;
  email: string;
  phone?: string;
  payout_method: string;
  payout_account?: string;
  commission_pct: number;
  balance: number;
  total_paid: number;
  status: "active" | "paused" | "archived";
  notes?: string;
  created_at: string;
  discount_link: string;
  total_referrals?: number;
  active_referrals?: number;
  total_revenue_generated?: number;
  total_commission_accumulated?: number;
}

interface PartnerSummary {
  total_partners: number;
  active_partners: number;
  total_referrals: number;
  total_balance_due: number;
  total_paid_out: number;
}

interface AdminTicket {
  id: string;
  ticket_number: number;
  user_id: string;
  user_email: string;
  user_name?: string;
  company_name?: string;
  subject: string;
  category: string;
  priority: string;
  status: "open" | "in_progress" | "waiting_client" | "resolved" | "closed";
  message_count?: number;
  created_at: string;
  updated_at: string;
  last_reply_at: string;
}

interface AdminTicketMessage {
  id: string;
  ticket_id: string;
  sender_id: string;
  sender_email: string;
  sender_role: "user" | "admin";
  sender_name?: string;
  message: string;
  created_at: string;
}

interface AdminLiveChatSession {
  id: string;
  visitor_name?: string;
  visitor_email?: string;
  visitor_phone?: string;
  company_name?: string;
  language: string;
  status: "ai_active" | "human_takeover" | "resolved" | "closed";
  needs_human: number;
  total_messages: number;
  last_message?: string;
  last_sender_type?: string;
  last_message_at?: string;
  page_url?: string;
  created_at: string;
  updated_at: string;
}

interface AdminLiveChatMessage {
  id: string;
  session_id: string;
  sender_type: "visitor" | "ai" | "human_agent";
  sender_name?: string;
  message: string;
  created_at: string;
}

export default function AdminSubscribersPage() {
  const { t, locale } = useTranslation();
  const { data: session, status } = useSession();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [stats, setStats] = useState<Stats>({
    totalSubscribers: 0,
    activeSubscriptions: 0,
    totalSlotsAllocated: 0,
    totalConnectedAccounts: 0,
  });

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedSub, setSelectedSub] = useState<Subscriber | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // Edit Form State
  const [editSlots, setEditSlots] = useState(1);
  const [editPlan, setEditPlan] = useState<"starter" | "growth" | "business" | "custom">("starter");
  const [editStatus, setEditStatus] = useState<"active" | "trial" | "past_due" | "canceled">("active");
  const [editCompany, setEditCompany] = useState("");
  const [saving, setSaving] = useState(false);

  // Create Form State
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newCompany, setNewCompany] = useState("");
  const [newSlots, setNewSlots] = useState(1);
  const [newPlan, setNewPlan] = useState<"starter" | "growth" | "business" | "custom">("starter");
  const [creating, setCreating] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [formError, setFormError] = useState("");

  const editSlotsInputId = useId();
  const editPlanSelectId = useId();
  const editStatusSelectId = useId();
  const editCompanyInputId = useId();
  const newEmailInputId = useId();
  const newPasswordInputId = useId();
  const newCompanyInputId = useId();
  const newSlotsInputId = useId();
  const newPlanSelectId = useId();

  // Navigation section switcher
  const [adminSection, setAdminSection] = useState<"subscribers" | "partners" | "tickets" | "live_chat">("subscribers");

  // Support Tickets State
  const [adminTickets, setAdminTickets] = useState<AdminTicket[]>([]);
  const [adminTicketCounts, setAdminTicketCounts] = useState<{
    total: number;
    open: number;
    in_progress: number;
    waiting_client: number;
    resolved: number;
    closed: number;
  }>({ total: 0, open: 0, in_progress: 0, waiting_client: 0, resolved: 0, closed: 0 });
  const [adminTicketsLoading, setAdminTicketsLoading] = useState(false);
  const [ticketSearch, setTicketSearch] = useState("");
  const [ticketStatusFilter, setTicketStatusFilter] = useState("all");

  // Selected Ticket for Admin Details Modal
  const [selectedAdminTicket, setSelectedAdminTicket] = useState<AdminTicket | null>(null);
  const [selectedTicketMessages, setSelectedTicketMessages] = useState<AdminTicketMessage[]>([]);
  const [selectedTicketCustomer, setSelectedTicketCustomer] = useState<any>(null);
  const [isAdminTicketModalOpen, setIsAdminTicketModalOpen] = useState(false);
  const [adminTicketLoadingDetail, setAdminTicketLoadingDetail] = useState(false);
  const [adminReplyText, setAdminReplyText] = useState("");
  const [adminSendingReply, setAdminSendingReply] = useState(false);
  const [adminUpdatingStatus, setAdminUpdatingStatus] = useState(false);

  // Live Chat State
  const [adminLiveChatSessions, setAdminLiveChatSessions] = useState<AdminLiveChatSession[]>([]);
  const [adminLiveChatCounts, setAdminLiveChatCounts] = useState<{ total: number; needs_human: number; active: number }>({
    total: 0,
    needs_human: 0,
    active: 0,
  });
  const [adminLiveChatLoading, setAdminLiveChatLoading] = useState(false);
  const [selectedLiveChatSession, setSelectedLiveChatSession] = useState<AdminLiveChatSession | null>(null);
  const [selectedLiveChatMessages, setSelectedLiveChatMessages] = useState<AdminLiveChatMessage[]>([]);
  const [liveChatLoadingThread, setLiveChatLoadingThread] = useState(false);
  const [liveChatReplyText, setLiveChatReplyText] = useState("");
  const [liveChatSendingReply, setLiveChatSendingReply] = useState(false);
  const [liveChatActionLoading, setLiveChatActionLoading] = useState(false);
  const [liveChatFilter, setLiveChatFilter] = useState<"all" | "needs_human" | "active" | "resolved">("all");
  const [liveChatSearch, setLiveChatSearch] = useState("");

  // Live Chat Knowledge & AI SDR Training
  const [isKnowledgeModalOpen, setIsKnowledgeModalOpen] = useState(false);
  const [knowledgePrompt, setKnowledgePrompt] = useState("");
  const [loadingKnowledge, setLoadingKnowledge] = useState(false);
  const [savingKnowledge, setSavingKnowledge] = useState(false);
  const lastOperatorTypingPingRef = useRef<number>(0);

  // Partners State
  const [partners, setPartners] = useState<Partner[]>([]);
  const [partnerSummary, setPartnerSummary] = useState<PartnerSummary>({
    total_partners: 0,
    active_partners: 0,
    total_referrals: 0,
    total_balance_due: 0,
    total_paid_out: 0,
  });
  const [partnersLoading, setPartnersLoading] = useState(false);
  const [partnerSearch, setPartnerSearch] = useState("");
  const [isCreatePartnerModalOpen, setIsCreatePartnerModalOpen] = useState(false);
  const [isPayoutModalOpen, setIsPayoutModalOpen] = useState(false);
  const [selectedPartnerForPayout, setSelectedPartnerForPayout] = useState<Partner | null>(null);
  const [payoutAmount, setPayoutAmount] = useState<number>(0);
  const [payoutRef, setPayoutRef] = useState("");
  const [payoutNotes, setPayoutNotes] = useState("");
  const [payoutSaving, setPayoutSaving] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // New Partner Form State
  const [newPartnerName, setNewPartnerName] = useState("");
  const [newPartnerEmail, setNewPartnerEmail] = useState("");
  const [newPartnerPhone, setNewPartnerPhone] = useState("");
  const [newPartnerPayoutMethod, setNewPartnerPayoutMethod] = useState("PayPal");
  const [newPartnerPayoutAccount, setNewPartnerPayoutAccount] = useState("");
  const [newPartnerCommission, setNewPartnerCommission] = useState(50);
  const [newPartnerCustomCode, setNewPartnerCustomCode] = useState("");
  const [newPartnerNotes, setNewPartnerNotes] = useState("");
  const [partnerCreating, setPartnerCreating] = useState(false);
  const [partnerFormError, setPartnerFormError] = useState("");

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    } else if (status === "authenticated") {
      loadData();
      loadPartners();
      loadAdminTickets();
      loadLiveChatSessions();
    }
  }, [status]);

  // Periodic polling for Live Chat
  useEffect(() => {
    if (status !== "authenticated") return;
    const interval = setInterval(() => {
      loadLiveChatSessions(true);
      if (selectedLiveChatSession?.id) {
        loadLiveChatThread(selectedLiveChatSession.id, true);
      }
    }, adminSection === "live_chat" ? 4000 : 15000);

    return () => clearInterval(interval);
  }, [status, adminSection, selectedLiveChatSession?.id]);

  async function loadLiveChatSessions(silent = false) {
    if (!silent) setAdminLiveChatLoading(true);
    try {
      const res = await fetch("/api/live-chat/admin");
      if (res.ok) {
        const data = await res.json();
        setAdminLiveChatSessions(data.sessions || []);
        if (data.counts) setAdminLiveChatCounts(data.counts);
      }
    } catch (err) {
      console.error("Error al cargar Live Chat en admin:", err);
    } finally {
      if (!silent) setAdminLiveChatLoading(false);
    }
  }

  async function loadLiveChatThread(sessionId: string, silent = false) {
    if (!silent) setLiveChatLoadingThread(true);
    try {
      const res = await fetch(`/api/live-chat/admin?sessionId=${sessionId}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedLiveChatSession(data.session);
        setSelectedLiveChatMessages(data.messages || []);
      }
    } catch (err) {
      console.error("Error al cargar hilo de Live Chat:", err);
    } finally {
      if (!silent) setLiveChatLoadingThread(false);
    }
  }

  async function handleLiveChatTakeover(sessionId: string) {
    setLiveChatActionLoading(true);
    try {
      const res = await fetch("/api/live-chat/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "takeover", sessionId }),
      });
      if (res.ok) {
        toast.success("Has tomado el control del chat. La IA está pausada.");
        loadLiveChatThread(sessionId);
        loadLiveChatSessions(true);
      }
    } catch {
      toast.error("Error al tomar control");
    } finally {
      setLiveChatActionLoading(false);
    }
  }

  async function handleLiveChatResumeAI(sessionId: string) {
    setLiveChatActionLoading(true);
    try {
      const res = await fetch("/api/live-chat/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resume_ai", sessionId }),
      });
      if (res.ok) {
        toast.success("IA reactivada para esta conversación.");
        loadLiveChatThread(sessionId);
        loadLiveChatSessions(true);
      }
    } catch {
      toast.error("Error al reactivar IA");
    } finally {
      setLiveChatActionLoading(false);
    }
  }

  async function handleLiveChatResolve(sessionId: string) {
    setLiveChatActionLoading(true);
    try {
      const res = await fetch("/api/live-chat/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resolve", sessionId }),
      });
      if (res.ok) {
        toast.success("Chat marcado como resuelto.");
        loadLiveChatThread(sessionId);
        loadLiveChatSessions(true);
      }
    } catch {
      toast.error("Error al marcar como resuelto");
    } finally {
      setLiveChatActionLoading(false);
    }
  }

  async function handleLiveChatSendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!liveChatReplyText.trim() || !selectedLiveChatSession) return;
    const textToSend = liveChatReplyText.trim();
    setLiveChatSendingReply(true);

    try {
      const res = await fetch("/api/live-chat/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reply",
          sessionId: selectedLiveChatSession.id,
          message: textToSend,
        }),
      });

      if (res.ok) {
        setLiveChatReplyText("");
        toast.success("Mensaje enviado al visitante en la web");
        loadLiveChatThread(selectedLiveChatSession.id);
        loadLiveChatSessions(true);
      } else {
        toast.error("Error al enviar mensaje");
      }
    } catch {
      toast.error("Error de conexión");
    } finally {
      setLiveChatSendingReply(false);
    }
  }

  function handleLiveChatReplyChange(val: string) {
    setLiveChatReplyText(val);
    const now = Date.now();
    if (selectedLiveChatSession && now - lastOperatorTypingPingRef.current > 2500) {
      lastOperatorTypingPingRef.current = now;
      fetch("/api/live-chat/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "typing", sessionId: selectedLiveChatSession.id }),
      }).catch(() => {});
    }
  }

  async function openKnowledgeModal() {
    setIsKnowledgeModalOpen(true);
    setLoadingKnowledge(true);
    try {
      const res = await fetch("/api/live-chat/admin?knowledge=true");
      if (res.ok) {
        const data = await res.json();
        setKnowledgePrompt(data.knowledge || "");
      }
    } catch {
      toast.error("Error al cargar instrucciones del Asistente IA");
    } finally {
      setLoadingKnowledge(false);
    }
  }

  async function handleSaveKnowledge(e: React.FormEvent) {
    e.preventDefault();
    setSavingKnowledge(true);
    try {
      const res = await fetch("/api/live-chat/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_knowledge",
          knowledgePrompt: knowledgePrompt.trim(),
        }),
      });

      if (res.ok) {
        toast.success("🧠 ¡Instrucciones del Asistente IA actualizadas con éxito!");
        setIsKnowledgeModalOpen(false);
      } else {
        const err = await res.json();
        toast.error(err.error || "Error al guardar instrucciones");
      }
    } catch {
      toast.error("Error de conexión al guardar");
    } finally {
      setSavingKnowledge(false);
    }
  }

  function handleResetKnowledge() {
    const DEFAULT_PROMPT = `Eres "InHubFlow Concierge", el Asistente SDR oficial de InHubFlow B2B Suite en el sitio web inhubflow.online.
Tu objetivo es orientar a los visitantes, resolver dudas comerciales y técnicas frecuentes de forma concisa, educada y persuasiva, y pre-calificar al lead para el equipo humano.

CONOCIMIENTO OFICIAL DE INHUBFLOW:
1. ¿QUÉ ES INHUBFLOW?: Suite tecnológica empresarial SaaS para prospección comercial B2B multicanal (LinkedIn + Email), enriquecimiento con Google X-Ray y Asistente SDR con Inteligencia Artificial que pre-califica respuestas y agenda reuniones comerciales.
2. SEGURIDAD EN LINKEDIN: InHubFlow opera con algoritmos de cadencia humana y respeta estrictamente el límite seguro recomendado de 20 invitaciones diarias por cuenta (hasta 100/semana por cuenta). Con una cuenta de 10 slots se contactan 4,000 personas al mes de manera segura sin riesgo de penalizaciones.
3. PLANES Y PRECIOS:
   - Plan Starter: $49/mes (1 cuenta de LinkedIn, 20 inv/día, secuencias multicanal, CRM).
   - Plan Growth: $149/mes (5 cuentas de LinkedIn, Asistente SDR con IA, enriquecimiento de datos).
   - Plan Business: $249/mes (10 cuentas de LinkedIn / multi-asiento, 1,000 inv/semana, soporte prioritario, reportes ejecutivos).
   - Contratación anual: 20% de descuento.
4. FACTURACIÓN Y CANCELACIÓN: Pagos procesados con Lemon Squeezy by Stripe y PayPal. Autonomía total: el cliente puede cancelar su suscripción en cualquier momento desde su panel sin penalizaciones.
5. PROGRAMA DE PARTNERS: 50% de comisión recurrente mensual para agencias y consultores que recomienden InHubFlow, atribución de cookie de 60 días.

REGLAS DE COMPORTAMIENTO:
- Responde siempre en el idioma en que te hable el usuario (Español por defecto, Portugués o Inglés).
- Sé conciso y directo: respuestas de 2 a 4 frases, profesionales y cálidas. No sueltes muros de texto.
- DETECCIÓN DE ATENCIÓN HUMANA (HANDOFF):
  Si el visitante:
  a) Solicita hablar con una persona, asesor, el fundador (Roberto) o soporte.
  b) Pide un plan empresarial a medida (más de 10 cuentas o franquicia).
  c) Hace una pregunta técnica o de precios compleja que no esté en tu conocimiento.
  d) Ya está listo para comprar o contratar y quiere atención guiada.
  -> Responde cordialmente indicando que con mucho gusto lo conectas con Roberto de nuestro equipo.
  -> Marca en el JSON que "needs_human" es true.

FORMATO DE SALIDA OBLIGATORIO:
Debes responder SIEMPRE un JSON válido con esta estructura exacta:
{
  "reply": "Tu mensaje para el visitante...",
  "needs_human": false o true,
  "lead_intent": "pricing" | "features" | "support" | "demo_request" | "partner" | "other",
  "extracted_name": "Nombre si lo detectaste o null",
  "extracted_email": "Email si lo detectaste o null",
  "extracted_company": "Empresa si la detectaste o null"
}`;
    setKnowledgePrompt(DEFAULT_PROMPT);
    toast.info("Plantilla predeterminada cargada en el editor. Haz clic en Guardar para aplicarla.");
  }

  async function loadAdminTickets() {
    setAdminTicketsLoading(true);
    try {
      const res = await fetch("/api/support/tickets?all=true");
      if (res.ok) {
        const data = await res.json();
        setAdminTickets(data.tickets || []);
        if (data.counts) setAdminTicketCounts(data.counts);
      }
    } catch (err) {
      console.error("Error al cargar tickets en admin:", err);
    } finally {
      setAdminTicketsLoading(false);
    }
  }

  async function openAdminTicket(ticket: AdminTicket) {
    setSelectedAdminTicket(ticket);
    setIsAdminTicketModalOpen(true);
    setAdminTicketLoadingDetail(true);
    try {
      const res = await fetch(`/api/support/tickets/${ticket.id}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedAdminTicket(data.ticket);
        setSelectedTicketMessages(data.messages || []);
        setSelectedTicketCustomer(data.customerDetails || null);
      }
    } catch (err) {
      console.error("Error al cargar detalle de ticket:", err);
    } finally {
      setAdminTicketLoadingDetail(false);
    }
  }

  async function handleAdminSendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!adminReplyText.trim() || !selectedAdminTicket) return;

    setAdminSendingReply(true);
    try {
      const res = await fetch(`/api/support/tickets/${selectedAdminTicket.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: adminReplyText.trim() }),
      });

      if (res.ok) {
        const data = await res.json();
        setSelectedTicketMessages((prev) => [...prev, data.message]);
        setAdminReplyText("");
        toast.success("Respuesta enviada al cliente por plataforma e email");
        if (data.newStatus) {
          setSelectedAdminTicket((prev) => prev ? { ...prev, status: data.newStatus } : null);
        }
        loadAdminTickets();
      } else {
        const err = await res.json();
        toast.error(err.error || "Error al enviar respuesta");
      }
    } catch (err) {
      toast.error("Error de conexión");
    } finally {
      setAdminSendingReply(false);
    }
  }

  async function handleAdminChangeStatus(newStatus: string) {
    if (!selectedAdminTicket) return;
    setAdminUpdatingStatus(true);
    try {
      const res = await fetch(`/api/support/tickets/${selectedAdminTicket.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (res.ok) {
        setSelectedAdminTicket((prev) => prev ? { ...prev, status: newStatus as any } : null);
        toast.success("Estado del ticket actualizado");
        loadAdminTickets();
      } else {
        toast.error("No se pudo actualizar el estado");
      }
    } catch (err) {
      toast.error("Error al actualizar estado");
    } finally {
      setAdminUpdatingStatus(false);
    }
  }

  async function loadData() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/subscribers");
      if (res.ok) {
        const data = await res.json();
        setSubscribers(data.subscribers || []);
        if (data.stats) setStats(data.stats);
      } else if (res.status === 401) {
        router.push("/login");
      } else if (res.status === 403) {
        router.push("/");
      }
    } catch (err) {
      console.error("Error loading subscribers:", err);
    } finally {
      setLoading(false);
    }
  }

  function openEditModal(sub: Subscriber) {
    setSelectedSub(sub);
    setEditSlots(sub.slots_limit || 1);
    setEditPlan(((sub.plan_tier as string) === "scale" ? "business" : sub.plan_tier) || "starter");
    setEditStatus(sub.subscription_status || "active");
    setEditCompany(sub.company_name || "");
    setIsEditModalOpen(true);
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSub) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/subscribers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedSub.id,
          slots_limit: Number(editSlots),
          plan_tier: editPlan,
          subscription_status: editStatus,
          company_name: editCompany,
        }),
      });

      if (res.ok) {
        setIsEditModalOpen(false);
        loadData();
      } else {
        const err = await res.json();
        alert(err.error || "Error al actualizar suscriptor");
      }
    } catch {
      alert("Error de red al actualizar");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    setCreating(true);
    try {
      const res = await fetch("/api/admin/subscribers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newEmail,
          password: newPassword,
          company_name: newCompany,
          slots_limit: Number(newSlots),
          plan_tier: newPlan,
        }),
      });

      if (res.ok) {
        setIsCreateModalOpen(false);
        const createdEmail = newEmail;
        setNewEmail("");
        setNewPassword("");
        setNewCompany("");
        setNewSlots(1);
        toast.success(t("admin.toastClientCreated", { email: createdEmail }), { duration: 7000 });
        loadData();
      } else {
        const err = await res.json();
        setFormError(err.error || "Error al crear cliente");
      }
    } catch {
      setFormError("Error de conexión");
    } finally {
      setCreating(false);
    }
  }

  async function loadPartners() {
    setPartnersLoading(true);
    try {
      const res = await fetch("/api/admin/partners");
      if (res.ok) {
        const data = await res.json();
        setPartners(data.partners || []);
        if (data.summary) setPartnerSummary(data.summary);
      }
    } catch (err) {
      console.error("Error loading partners:", err);
    } finally {
      setPartnersLoading(false);
    }
  }

  async function handleCreatePartner(e: React.FormEvent) {
    e.preventDefault();
    setPartnerFormError("");
    setPartnerCreating(true);
    try {
      const res = await fetch("/api/admin/partners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newPartnerName,
          email: newPartnerEmail,
          phone: newPartnerPhone,
          payout_method: newPartnerPayoutMethod,
          payout_account: newPartnerPayoutAccount,
          commission_pct: Number(newPartnerCommission),
          custom_code: newPartnerCustomCode,
          notes: newPartnerNotes,
        }),
      });

      if (res.ok) {
        setIsCreatePartnerModalOpen(false);
        setNewPartnerName("");
        setNewPartnerEmail("");
        setNewPartnerPhone("");
        setNewPartnerPayoutAccount("");
        setNewPartnerCustomCode("");
        setNewPartnerNotes("");
        toast.success(t("admin.toastPartnerCreated"));
        loadPartners();
      } else {
        const err = await res.json();
        setPartnerFormError(err.error || "Error al crear Partner");
      }
    } catch {
      setPartnerFormError("Error de conexión");
    } finally {
      setPartnerCreating(false);
    }
  }

  function openPayoutModal(p: Partner) {
    setSelectedPartnerForPayout(p);
    setPayoutAmount(p.balance > 0 ? p.balance : 0);
    setPayoutRef("");
    setPayoutNotes("");
    setIsPayoutModalOpen(true);
  }

  async function handleConfirmPayout(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedPartnerForPayout) return;
    setPayoutSaving(true);
    try {
      const res = await fetch(`/api/admin/partners/${selectedPartnerForPayout.id}/payout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: Number(payoutAmount),
          reference: payoutRef,
          notes: payoutNotes,
        }),
      });

      if (res.ok) {
        setIsPayoutModalOpen(false);
        toast.success(t("admin.toastPayoutSuccess"));
        loadPartners();
      } else {
        const err = await res.json();
        alert(err.error || "Error al registrar liquidación");
      }
    } catch {
      alert("Error de red");
    } finally {
      setPayoutSaving(false);
    }
  }

  function copyDiscountLink(link: string, code: string) {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(link);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2500);
    }
  }

  const filteredSubscribers = subscribers.filter((sub) => {
    const matchesSearch =
      sub.email.toLowerCase().includes(search.toLowerCase()) ||
      (sub.company_name && sub.company_name.toLowerCase().includes(search.toLowerCase()));

    const matchesStatus = statusFilter === "all" || sub.subscription_status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const filteredPartners = partners.filter((p) => {
    return (
      p.name.toLowerCase().includes(partnerSearch.toLowerCase()) ||
      p.email.toLowerCase().includes(partnerSearch.toLowerCase()) ||
      p.code.toLowerCase().includes(partnerSearch.toLowerCase())
    );
  });

  const filteredTickets = adminTickets.filter((tck) => {
    const term = ticketSearch.toLowerCase().trim();
    const matchesSearch =
      !term ||
      tck.subject.toLowerCase().includes(term) ||
      tck.user_email.toLowerCase().includes(term) ||
      (tck.user_name && tck.user_name.toLowerCase().includes(term)) ||
      (tck.company_name && tck.company_name.toLowerCase().includes(term)) ||
      String(tck.ticket_number).includes(term);

    const matchesStatus = ticketStatusFilter === "all" || tck.status === ticketStatusFilter;

    return matchesSearch && matchesStatus;
  });

  return (
    <>
      <Head>
        <title>{t("admin.pageTitle")}</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>

      <div className="space-y-6">
        {/* ── Top Header Banner ── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-brand-500/10 via-brand-500/5 to-indigo-500/10 dark:from-brand-950/30 dark:via-brand-950/20 dark:to-indigo-950/30 border border-brand-500/20 dark:border-brand-500/10 p-5 md:p-6 rounded-2xl">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="p-2 rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-400">
                {adminSection === "tickets" ? (
                  <RiCustomerService2Line size={24} />
                ) : adminSection === "live_chat" ? (
                  <RiChat1Line size={24} />
                ) : (
                  <RiShieldCheckLine size={24} />
                )}
              </span>
              <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
                {adminSection === "subscribers" 
                  ? t("admin.subscribersTitle") 
                  : adminSection === "partners"
                  ? t("admin.partnersTitle")
                  : adminSection === "tickets"
                  ? "Centro de Soporte y Tickets"
                  : "Live Chat Web: Asistente IA & Leads en Vivo"}
              </h1>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {adminSection === "subscribers"
                ? t("admin.subscribersSubtitle")
                : adminSection === "partners"
                ? t("admin.partnersSubtitle")
                : adminSection === "tickets"
                ? "Atención directa de incidencias, dudas técnicas y solicitudes de clientes InHubFlow"
                : "Monitorea las conversaciones del Asistente SDR en la landing page, atiende prospectos calientes y responde en vivo."}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                if (adminSection === "subscribers") loadData();
                else if (adminSection === "partners") loadPartners();
                else if (adminSection === "tickets") loadAdminTickets();
                else loadLiveChatSessions();
              }}
              title={t("admin.refresh")}
              className="p-2.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 transition-colors shadow-xs cursor-pointer"
            >
              <RiRefreshLine className={loading || partnersLoading || adminTicketsLoading || adminLiveChatLoading ? "animate-spin" : ""} size={18} />
            </button>
            {adminSection === "subscribers" ? (
              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-medium text-sm shadow-xs transition-all cursor-pointer"
              >
                <RiUserAddLine size={18} />
                <span>{t("admin.newManualClient")}</span>
              </button>
            ) : adminSection === "partners" ? (
              <button
                onClick={() => setIsCreatePartnerModalOpen(true)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-sm shadow-xs transition-all cursor-pointer"
              >
                <RiHandHeartLine size={18} />
                <span>{t("admin.newPartner")}</span>
              </button>
            ) : adminSection === "live_chat" ? (
              <button
                onClick={openKnowledgeModal}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-semibold text-sm shadow-xs transition-all cursor-pointer"
              >
                <RiBrainLine size={18} />
                <span>🧠 Entrenar Asistente IA</span>
              </button>
            ) : null}
          </div>
        </div>

        {/* ── Section Switcher Tabs ── */}
        <div className="flex items-center gap-2 border-b border-gray-200 dark:border-gray-800 pb-2 flex-wrap">
          <button
            onClick={() => setAdminSection("subscribers")}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl transition-colors cursor-pointer ${
              adminSection === "subscribers"
                ? "bg-brand-500/10 text-brand-600 dark:text-brand-400 border border-brand-500/20"
                : "text-gray-500 hover:text-gray-900 dark:hover:text-white"
            }`}
          >
            <RiUserFollowLine size={18} />
            <span>{t("admin.tabSubscribers")}</span>
            <span className="px-2 py-0.5 text-xs rounded-full bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
              {stats.totalSubscribers}
            </span>
          </button>

          <button
            onClick={() => setAdminSection("partners")}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl transition-colors cursor-pointer ${
              adminSection === "partners"
                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                : "text-gray-500 hover:text-gray-900 dark:hover:text-white"
            }`}
          >
            <RiHandHeartLine size={18} />
            <span>{t("admin.tabPartners")}</span>
            <span className="px-2 py-0.5 text-xs rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300 font-bold">
              {partners.length}
            </span>
          </button>

          <button
            onClick={() => {
              setAdminSection("tickets");
              loadAdminTickets();
            }}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl transition-colors cursor-pointer ${
              adminSection === "tickets"
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                : "text-gray-500 hover:text-gray-900 dark:hover:text-white"
            }`}
          >
            <RiCustomerService2Line size={18} />
            <span>Soporte y Tickets</span>
            {adminTicketCounts.open > 0 ? (
              <span className="px-2 py-0.5 text-xs rounded-full bg-emerald-500 text-white font-bold animate-pulse">
                {adminTicketCounts.open} nuevos
              </span>
            ) : (
              <span className="px-2 py-0.5 text-xs rounded-full bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                {adminTicketCounts.total}
              </span>
            )}
          </button>

          <button
            onClick={() => {
              setAdminSection("live_chat");
              loadLiveChatSessions();
            }}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl transition-colors cursor-pointer ${
              adminSection === "live_chat"
                ? "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20"
                : "text-gray-500 hover:text-gray-900 dark:hover:text-white"
            }`}
          >
            <RiChat1Line size={18} />
            <span>Live Chat</span>
            {adminLiveChatCounts.needs_human > 0 ? (
              <span className="px-2 py-0.5 text-xs rounded-full bg-red-500 text-white font-bold animate-pulse flex items-center gap-1 shadow-xs">
                <RiFireFill size={12} />
                {adminLiveChatCounts.needs_human} alertas
              </span>
            ) : (
              <span className="px-2 py-0.5 text-xs rounded-full bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 font-semibold">
                {adminLiveChatCounts.total}
              </span>
            )}
          </button>
        </div>

        {/* ── SECTION 1: SUBSCRIBERS ── */}
        {adminSection === "subscribers" && (
          <div className="space-y-6">
            {/* KPI Stats Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-5 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs">
                <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider">{t("admin.statTotalClients")}</span>
                  <span className="p-2 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
                    <RiUserFollowLine size={18} />
                  </span>
                </div>
                <div className="text-3xl font-extrabold text-gray-900 dark:text-white">
                  {stats.totalSubscribers}
                </div>
                <div className="text-xs text-gray-400 mt-1">{t("admin.statTotalClientsDesc")}</div>
              </div>

              <div className="p-5 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs">
                <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider">{t("admin.statActiveSubs")}</span>
                  <span className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    <RiVipCrownLine size={18} />
                  </span>
                </div>
                <div className="text-3xl font-extrabold text-emerald-600 dark:text-emerald-400">
                  {stats.activeSubscriptions}
                </div>
                <div className="text-xs text-emerald-600/80 dark:text-emerald-400/80 mt-1">{t("admin.statActiveSubsDesc")}</div>
              </div>

              <div className="p-5 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs">
                <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider">{t("admin.statAllocatedSlots")}</span>
                  <span className="p-2 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                    <RiCpuLine size={18} />
                  </span>
                </div>
                <div className="text-3xl font-extrabold text-gray-900 dark:text-white">
                  {stats.totalSlotsAllocated}
                </div>
                <div className="text-xs text-gray-400 mt-1">{t("admin.statAllocatedSlotsDesc")}</div>
              </div>

              <div className="p-5 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs">
                <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider">{t("admin.statLinkedInAccounts")}</span>
                  <span className="p-2 rounded-xl bg-blue-600/10 text-[#0a66c2]">
                    <RiLinkedinBoxFill size={18} />
                  </span>
                </div>
                <div className="text-3xl font-extrabold text-[#0a66c2]">
                  {stats.totalConnectedAccounts}
                </div>
                <div className="text-xs text-gray-400 mt-1">{t("admin.statLinkedInAccountsDesc")}</div>
              </div>
            </div>

            {/* Filters and Search */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs">
              <div className="relative w-full sm:w-80">
                <RiSearchLine className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input
                  type="text"
                  placeholder={t("admin.searchSubscribersPlaceholder")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <span className="text-xs text-gray-400">{t("admin.filterLabel")}</span>
                <div className="flex rounded-xl bg-gray-100 dark:bg-gray-800 p-1 text-xs">
                  {[
                    { id: "all", label: t("admin.filterAll") },
                    { id: "active", label: t("admin.filterActive") },
                    { id: "trial", label: t("admin.filterTrial") },
                    { id: "past_due", label: t("admin.filterPastDue") },
                    { id: "canceled", label: t("admin.filterCanceled") },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setStatusFilter(tab.id)}
                      className={`px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
                        statusFilter === tab.id
                          ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-xs"
                          : "text-gray-500 hover:text-gray-900 dark:hover:text-gray-300"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Subscribers Table */}
            <div className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 text-xs uppercase font-semibold border-b border-gray-200 dark:border-gray-800">
                    <tr>
                      <th className="px-6 py-4">{t("admin.colUserCompany")}</th>
                      <th className="px-6 py-4">{t("admin.colCurrentPlan")}</th>
                      <th className="px-6 py-4">{t("admin.colSlotsAllowed")}</th>
                      <th className="px-6 py-4">{t("admin.colStatus")}</th>
                      <th className="px-6 py-4">{t("admin.colRegisterDate")}</th>
                      <th className="px-6 py-4 text-right">{t("admin.colActions")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                    {loading ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-12 text-center text-gray-400">
                          <RiRefreshLine className="animate-spin inline-block mr-2" size={20} />
                          {t("admin.loadingClients")}
                        </td>
                      </tr>
                    ) : filteredSubscribers.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-12 text-center text-gray-400">
                          {t("admin.noClientsFound")}
                        </td>
                      </tr>
                    ) : (
                      filteredSubscribers.map((sub) => {
                        return (
                          <tr key={sub.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors">
                            <td className="px-6 py-4">
                              <div className="font-semibold text-gray-900 dark:text-white">
                                {sub.email}
                              </div>
                              <div className="text-xs text-gray-400">
                                {sub.company_name || t("admin.noCompany")} • {t("admin.role", { role: sub.role })}
                              </div>
                            </td>

                            <td className="px-6 py-4">
                              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-brand-50 dark:bg-brand-500/10 text-brand-700 dark:text-brand-400 border border-brand-200 dark:border-brand-800 uppercase">
                                {(sub.plan_tier as string) === "scale" ? "business" : (sub.plan_tier || "starter")}
                              </span>
                            </td>

                            <td className="px-6 py-4">
                              <div className="flex items-center gap-1.5 font-bold text-gray-800 dark:text-gray-200">
                                <RiCpuLine size={16} className="text-gray-400" />
                                <span>{sub.slots_limit === 1 ? t("admin.slotSingle") : t("admin.slotPlural", { count: sub.slots_limit })}</span>
                              </div>
                            </td>

                            <td className="px-6 py-4">
                              <span
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                                  sub.subscription_status === "active"
                                    ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800"
                                    : sub.subscription_status === "trial"
                                    ? "bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800"
                                    : sub.subscription_status === "past_due"
                                    ? "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800"
                                    : "bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800"
                                }`}
                              >
                                <span
                                  className={`h-1.5 w-1.5 rounded-full ${
                                    sub.subscription_status === "active"
                                      ? "bg-emerald-500"
                                      : sub.subscription_status === "trial"
                                      ? "bg-blue-500"
                                      : sub.subscription_status === "past_due"
                                      ? "bg-amber-500"
                                      : "bg-rose-500"
                                  }`}
                                />
                                {sub.subscription_status === "active" && t("admin.statusActive")}
                                {sub.subscription_status === "trial" && t("admin.statusTrial")}
                                {sub.subscription_status === "past_due" && t("admin.statusPastDue")}
                                {sub.subscription_status === "canceled" && t("admin.statusCanceled")}
                              </span>
                            </td>

                            <td className="px-6 py-4 text-xs text-gray-400">
                              {new Date(sub.created_at).toLocaleDateString(locale)}
                            </td>

                            <td className="px-6 py-4 text-right">
                              <button
                                onClick={() => openEditModal(sub)}
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 text-xs font-semibold text-gray-700 dark:text-gray-300 transition-colors cursor-pointer"
                              >
                                <RiEditLine size={14} />
                                <span>{t("admin.manage")}</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Webhook Information Callout */}
            <div className="p-4 rounded-2xl bg-brand-500/5 border border-brand-500/10 flex items-start gap-3">
              <RiInformationLine className="text-brand-500 shrink-0 mt-0.5" size={20} />
              <div className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
                <div className="font-semibold text-gray-900 dark:text-white">
                  {t("admin.webhookCalloutTitle")}
                </div>
                <div>
                  {t("admin.webhookCalloutDesc", { endpoint: "/api/webhooks/lemonsqueezy" })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── SECTION 2: INHUBFLOW PARTNERS (25% RECURRENT) ── */}
        {adminSection === "partners" && (
          <div className="space-y-6">
            {/* Partners KPI Stats Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-5 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs">
                <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider">{t("admin.statTotalPartners")}</span>
                  <span className="p-2 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
                    <RiHandHeartLine size={18} />
                  </span>
                </div>
                <div className="text-3xl font-extrabold text-gray-900 dark:text-white">
                  {partnerSummary.total_partners}
                </div>
                <div className="text-xs text-gray-400 mt-1">{t("admin.statTotalPartnersDesc")}</div>
              </div>

              <div className="p-5 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs">
                <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider">{t("admin.statReferredClients")}</span>
                  <span className="p-2 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
                    <RiUserFollowLine size={18} />
                  </span>
                </div>
                <div className="text-3xl font-extrabold text-blue-600 dark:text-blue-400">
                  {partnerSummary.total_referrals}
                </div>
                <div className="text-xs text-gray-400 mt-1">{t("admin.statReferredClientsDesc")}</div>
              </div>

              <div className="p-5 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs">
                <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider">{t("admin.statPendingCommissions")}</span>
                  <span className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    <RiMoneyDollarCircleLine size={18} />
                  </span>
                </div>
                <div className="text-3xl font-extrabold text-emerald-600 dark:text-emerald-400">
                  ${partnerSummary.total_balance_due.toFixed(2)} USD
                </div>
                <div className="text-xs text-emerald-600/80 dark:text-emerald-400/80 mt-1">{t("admin.statPendingCommissionsDesc")}</div>
              </div>

              <div className="p-5 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs">
                <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider">{t("admin.statTotalPaidOut")}</span>
                  <span className="p-2 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400">
                    <RiBankCardLine size={18} />
                  </span>
                </div>
                <div className="text-3xl font-extrabold text-purple-600 dark:text-purple-400">
                  ${partnerSummary.total_paid_out.toFixed(2)} USD
                </div>
                <div className="text-xs text-gray-400 mt-1">{t("admin.statTotalPaidOutDesc")}</div>
              </div>
            </div>

            {/* Partners Search */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs">
              <div className="relative w-full sm:w-96">
                <RiSearchLine className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input
                  type="text"
                  placeholder={t("admin.searchPartnersPlaceholder")}
                  value={partnerSearch}
                  onChange={(e) => setPartnerSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="text-xs text-gray-500">
                {t("admin.showingPartnersCount", { filtered: filteredPartners.length, total: partners.length })}
              </div>
            </div>

            {/* Partners Table */}
            <div className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 text-xs uppercase font-semibold border-b border-gray-200 dark:border-gray-800">
                    <tr>
                      <th className="px-6 py-4">{t("admin.colPartnerContact")}</th>
                      <th className="px-6 py-4">{t("admin.colDiscountLink")}</th>
                      <th className="px-6 py-4">{t("admin.colCommission")}</th>
                      <th className="px-6 py-4">{t("admin.colPayoutMethod")}</th>
                      <th className="px-6 py-4">{t("admin.colActiveClients")}</th>
                      <th className="px-6 py-4">{t("admin.colPendingBalance")}</th>
                      <th className="px-6 py-4 text-right">{t("admin.colActions")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                    {partnersLoading ? (
                      <tr>
                        <td colSpan={7} className="px-6 py-12 text-center text-gray-400">
                          <RiRefreshLine className="animate-spin inline-block mr-2" size={20} />
                          {t("admin.loadingPartners")}
                        </td>
                      </tr>
                    ) : filteredPartners.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-6 py-12 text-center text-gray-400">
                          {partners.length === 0 ? (
                            <div className="space-y-3">
                              <p>{t("admin.noPartnersYet")}</p>
                              <button
                                onClick={() => setIsCreatePartnerModalOpen(true)}
                                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs shadow-xs cursor-pointer"
                              >
                                <RiHandHeartLine size={16} />
                                <span>{t("admin.createFirstPartner")}</span>
                              </button>
                            </div>
                          ) : (
                            t("admin.noPartnersFound")
                          )}
                        </td>
                      </tr>
                    ) : (
                      filteredPartners.map((p) => {
                        const isCopied = copiedCode === p.code;
                        return (
                          <tr key={p.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors">
                            <td className="px-6 py-4">
                              <div className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                <span>{p.name}</span>
                                <span className="px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-400 text-xs font-mono font-bold">
                                  {p.code}
                                </span>
                              </div>
                              <div className="text-xs text-gray-400">
                                {p.email} {p.phone ? `• ${p.phone}` : ""}
                              </div>
                            </td>

                            <td className="px-6 py-4">
                              <div className="flex items-center gap-2">
                                <code className="px-2 py-1 rounded-lg bg-gray-100 dark:bg-gray-800 font-mono text-xs text-brand-600 dark:text-brand-400 max-w-[240px] truncate">
                                  {p.discount_link}
                                </code>
                                <button
                                  onClick={() => copyDiscountLink(p.discount_link, p.code)}
                                  title={t("admin.copyDiscountLink")}
                                  className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                                    isCopied
                                      ? "bg-emerald-500 text-white border-emerald-600"
                                      : "border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300"
                                  }`}
                                >
                                  {isCopied ? <RiCheckLine size={14} /> : <RiFileCopyLine size={14} />}
                                </button>
                              </div>
                              {isCopied && (
                                <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                                  {t("admin.linkCopied")}
                                </span>
                              )}
                            </td>

                            <td className="px-6 py-4">
                              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                                {t("admin.recurringCommission", { pct: p.commission_pct })}
                              </span>
                            </td>

                            <td className="px-6 py-4">
                              <div className="text-xs font-medium text-gray-900 dark:text-white">
                                {p.payout_method || "PayPal"}
                              </div>
                              <div className="text-[11px] text-gray-400 truncate max-w-[180px]">
                                {p.payout_account || t("admin.notSpecified")}
                              </div>
                            </td>

                            <td className="px-6 py-4">
                              <div className="font-bold text-gray-900 dark:text-white">
                                {p.active_referrals || 0}
                              </div>
                              <div className="text-[11px] text-gray-400">
                                {t("admin.billedRevenue", { amount: ((p.total_revenue_generated || 0)).toFixed(2) })}
                              </div>
                            </td>

                            <td className="px-6 py-4">
                              <div className={`font-extrabold ${p.balance > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-gray-500"}`}>
                                ${p.balance.toFixed(2)} USD
                              </div>
                              <div className="text-[11px] text-gray-400">
                                {t("admin.paidHistorical", { amount: p.total_paid.toFixed(2) })}
                              </div>
                            </td>

                            <td className="px-6 py-4 text-right">
                              <button
                                onClick={() => openPayoutModal(p)}
                                disabled={p.balance <= 0}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:hover:bg-emerald-600 text-white font-semibold text-xs transition-colors shadow-xs cursor-pointer"
                              >
                                <RiMoneyDollarCircleLine size={14} />
                                <span>{t("admin.payout")}</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* InHubFlow Partners Callout */}
            <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-start gap-3">
              <RiHandHeartLine className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" size={20} />
              <div className="text-xs text-gray-700 dark:text-gray-300 space-y-1">
                <div className="font-bold text-gray-900 dark:text-white">
                  {t("admin.partnerCalloutTitle")}
                </div>
                <div>
                  {t("admin.partnerCalloutDesc", { sampleUrl: "https://inhubflow.online?25-OFF=SE7GH" })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── SECTION 3: SUPPORT & TICKETS ── */}
        {adminSection === "tickets" && (
          <div className="space-y-6">
            {/* KPI Stats Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-5 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs">
                <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider">Total Tickets</span>
                  <span className="p-2 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
                    <RiMessage3Line size={18} />
                  </span>
                </div>
                <div className="text-3xl font-extrabold text-gray-900 dark:text-white">
                  {adminTicketCounts.total}
                </div>
                <div className="text-xs text-gray-400 mt-1">Total acumulado de incidencias</div>
              </div>

              <div className="p-5 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs">
                <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider">Tickets Abiertos</span>
                  <span className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    <RiCustomerService2Line size={18} />
                  </span>
                </div>
                <div className="text-3xl font-extrabold text-emerald-600 dark:text-emerald-400">
                  {adminTicketCounts.open}
                </div>
                <div className="text-xs text-emerald-600/80 dark:text-emerald-400/80 mt-1">Requieren atención inmediata</div>
              </div>

              <div className="p-5 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs">
                <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider">En Proceso / Espera</span>
                  <span className="p-2 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
                    <RiTimeLine size={18} />
                  </span>
                </div>
                <div className="text-3xl font-extrabold text-amber-600 dark:text-amber-400">
                  {(adminTicketCounts.in_progress || 0) + (adminTicketCounts.waiting_client || 0)}
                </div>
                <div className="text-xs text-gray-400 mt-1">En seguimiento con el cliente</div>
              </div>

              <div className="p-5 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs">
                <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider">Resueltos</span>
                  <span className="p-2 rounded-xl bg-teal-500/10 text-teal-600 dark:text-teal-400">
                    <RiCheckboxCircleLine size={18} />
                  </span>
                </div>
                <div className="text-3xl font-extrabold text-teal-600 dark:text-teal-400">
                  {adminTicketCounts.resolved}
                </div>
                <div className="text-xs text-gray-400 mt-1">Incidencias solucionadas</div>
              </div>
            </div>

            {/* Filter & Search Bar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs">
              <div className="relative w-full sm:w-96">
                <RiSearchLine className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input
                  type="text"
                  placeholder="Buscar por cliente, email, asunto o #Ticket..."
                  value={ticketSearch}
                  onChange={(e) => setTicketSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="flex items-center gap-3 w-full sm:w-auto">
                <select
                  value={ticketStatusFilter}
                  onChange={(e) => setTicketStatusFilter(e.target.value)}
                  className="px-3.5 py-2 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 text-xs sm:text-sm text-gray-700 dark:text-gray-300 focus:outline-none"
                >
                  <option value="all">Todos los Estados</option>
                  <option value="open">Abiertos</option>
                  <option value="in_progress">En Proceso</option>
                  <option value="waiting_client">Esperando Cliente</option>
                  <option value="resolved">Resueltos</option>
                  <option value="closed">Cerrados</option>
                </select>
                <div className="text-xs text-gray-500 whitespace-nowrap">
                  Mostrando {filteredTickets.length} de {adminTickets.length}
                </div>
              </div>
            </div>

            {/* Tickets Table */}
            <div className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 text-xs uppercase font-semibold border-b border-gray-200 dark:border-gray-800">
                    <tr>
                      <th className="px-6 py-4"># Ticket</th>
                      <th className="px-6 py-4">Cliente / Empresa</th>
                      <th className="px-6 py-4">Asunto</th>
                      <th className="px-6 py-4">Categoría</th>
                      <th className="px-6 py-4">Prioridad</th>
                      <th className="px-6 py-4">Estado</th>
                      <th className="px-6 py-4">Última Actividad</th>
                      <th className="px-6 py-4 text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                    {adminTicketsLoading ? (
                      <tr>
                        <td colSpan={8} className="px-6 py-12 text-center text-gray-400">
                          <RiRefreshLine className="animate-spin inline-block mr-2" size={20} />
                          Cargando tickets de soporte...
                        </td>
                      </tr>
                    ) : filteredTickets.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-6 py-12 text-center text-gray-400">
                          No se encontraron tickets con los filtros actuales.
                        </td>
                      </tr>
                    ) : (
                      filteredTickets.map((tck) => (
                        <tr key={tck.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors">
                          <td className="px-6 py-4 font-mono font-bold text-gray-900 dark:text-white">
                            #TCK-{tck.ticket_number}
                          </td>
                          <td className="px-6 py-4">
                            <div className="font-semibold text-gray-900 dark:text-white">
                              {tck.user_name || tck.user_email.split("@")[0]}
                            </div>
                            <div className="text-xs text-gray-400">
                              {tck.user_email} {tck.company_name ? `• ${tck.company_name}` : ""}
                            </div>
                          </td>
                          <td className="px-6 py-4 font-medium text-gray-900 dark:text-white max-w-xs truncate">
                            <div className="flex items-center gap-1.5">
                              <span>{tck.subject}</span>
                              {tck.message_count && tck.message_count > 1 ? (
                                <span className="inline-flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 font-mono">
                                  <RiMessage3Line size={10} />
                                  {tck.message_count}
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-6 py-4 text-xs text-gray-600 dark:text-gray-400">
                            {tck.category}
                          </td>
                          <td className="px-6 py-4">
                            {tck.priority === "urgent" ? (
                              <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400">Urgente</span>
                            ) : tck.priority === "high" ? (
                              <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-950/50 dark:text-orange-400">Alta</span>
                            ) : tck.priority === "low" ? (
                              <span className="text-[11px] font-normal px-2 py-0.5 rounded bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">Baja</span>
                            ) : (
                              <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400">Normal</span>
                            )}
                          </td>
                          <td className="px-6 py-4">
                            {tck.status === "open" ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                Abierto
                              </span>
                            ) : tck.status === "in_progress" ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800">
                                En Proceso
                              </span>
                            ) : tck.status === "waiting_client" ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                                Espera Cliente
                              </span>
                            ) : tck.status === "resolved" ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-400 border border-teal-200 dark:border-teal-800">
                                <RiCheckboxCircleLine size={12} />
                                Resuelto
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400">
                                Cerrado
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-xs text-gray-400 font-mono">
                            {new Date(tck.updated_at || tck.created_at).toLocaleDateString("es-ES", {
                              day: "2-digit",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <button
                              onClick={() => openAdminTicket(tck)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-semibold text-xs transition cursor-pointer shadow-2xs"
                            >
                              <RiCustomerService2Line size={14} />
                              <span>Atender</span>
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── SECTION 4: LIVE CHAT (WEB LEADS & AI SDR) ── */}
        {adminSection === "live_chat" && (
          <div className="space-y-6">
            {/* KPI Stats Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="p-5 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs">
                <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider">Total Conversaciones</span>
                  <span className="p-2 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                    <RiChat1Line size={18} />
                  </span>
                </div>
                <div className="text-3xl font-extrabold text-gray-900 dark:text-white">
                  {adminLiveChatCounts.total}
                </div>
                <div className="text-xs text-gray-400 mt-1">Visitantes que han interactuado en la web</div>
              </div>

              <div className="p-5 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs">
                <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider">Leads Calientes (Alertas)</span>
                  <span className="p-2 rounded-xl bg-red-500/10 text-red-600 dark:text-red-400">
                    <RiFireFill size={18} />
                  </span>
                </div>
                <div className="text-3xl font-extrabold text-red-600 dark:text-red-400 flex items-center gap-2">
                  {adminLiveChatCounts.needs_human}
                  {adminLiveChatCounts.needs_human > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-red-500 text-white font-bold animate-pulse">
                      ¡Atención requerida!
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-400 mt-1">Solicitaron hablar con asesor o comprar</div>
              </div>

              <div className="p-5 rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs">
                <div className="flex items-center justify-between text-gray-500 dark:text-gray-400 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider">Sesiones en Curso</span>
                  <span className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    <RiRobot3Line size={18} />
                  </span>
                </div>
                <div className="text-3xl font-extrabold text-gray-900 dark:text-white">
                  {adminLiveChatCounts.active}
                </div>
                <div className="text-xs text-gray-400 mt-1">Atendidas por IA o con control humano</div>
              </div>
            </div>

            {/* Live Chat Two-Column Workspace */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 h-[680px] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-3xl shadow-sm overflow-hidden">
              {/* Left Column: Sessions List (4 cols) */}
              <div className="lg:col-span-4 border-r border-gray-200 dark:border-gray-800 flex flex-col h-full bg-gray-50/50 dark:bg-gray-900/50">
                {/* Search and Filters */}
                <div className="p-4 border-b border-gray-200 dark:border-gray-800 space-y-3">
                  <div className="relative">
                    <RiSearchLine className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                    <input
                      type="text"
                      value={liveChatSearch}
                      onChange={(e) => setLiveChatSearch(e.target.value)}
                      placeholder="Buscar por visitante o empresa..."
                      className="w-full pl-9 pr-3 py-2 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900 dark:text-white"
                    />
                  </div>

                  {/* Filter Pills */}
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px]">
                    <button
                      onClick={() => setLiveChatFilter("all")}
                      className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer shrink-0 ${
                        liveChatFilter === "all"
                          ? "bg-indigo-600 text-white"
                          : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700"
                      }`}
                    >
                      Todos ({adminLiveChatSessions.length})
                    </button>
                    <button
                      onClick={() => setLiveChatFilter("needs_human")}
                      className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer shrink-0 flex items-center gap-1 ${
                        liveChatFilter === "needs_human"
                          ? "bg-red-600 text-white font-bold"
                          : "bg-white dark:bg-gray-800 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900"
                      }`}
                    >
                      <RiFireFill size={12} />
                      Leads ({adminLiveChatCounts.needs_human})
                    </button>
                    <button
                      onClick={() => setLiveChatFilter("active")}
                      className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer shrink-0 ${
                        liveChatFilter === "active"
                          ? "bg-indigo-600 text-white"
                          : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700"
                      }`}
                    >
                      Activos
                    </button>
                    <button
                      onClick={() => setLiveChatFilter("resolved")}
                      className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer shrink-0 ${
                        liveChatFilter === "resolved"
                          ? "bg-indigo-600 text-white"
                          : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700"
                      }`}
                    >
                      Resueltos
                    </button>
                  </div>
                </div>

                {/* Sessions Scroll List */}
                <div className="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800">
                  {adminLiveChatLoading ? (
                    <div className="p-8 text-center text-xs text-gray-400">
                      Cargando conversaciones...
                    </div>
                  ) : adminLiveChatSessions.length === 0 ? (
                    <div className="p-8 text-center space-y-2">
                      <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 mx-auto flex items-center justify-center text-xl">
                        💬
                      </div>
                      <p className="text-xs font-semibold text-gray-800 dark:text-gray-200">
                        Aún no hay conversaciones registradas
                      </p>
                      <p className="text-[11px] text-gray-400 max-w-[200px] mx-auto">
                        Cuando los visitantes escriban en el chat de inhubflow.online, aparecerán aquí al instante.
                      </p>
                    </div>
                  ) : (
                    adminLiveChatSessions
                      .filter((s) => {
                        const term = liveChatSearch.toLowerCase().trim();
                        const matchesTerm =
                          !term ||
                          (s.visitor_name && s.visitor_name.toLowerCase().includes(term)) ||
                          (s.company_name && s.company_name.toLowerCase().includes(term)) ||
                          (s.visitor_email && s.visitor_email.toLowerCase().includes(term)) ||
                          (s.last_message && s.last_message.toLowerCase().includes(term));

                        if (!matchesTerm) return false;
                        if (liveChatFilter === "needs_human") return s.needs_human === 1;
                        if (liveChatFilter === "active") return s.status === "ai_active" || s.status === "human_takeover";
                        if (liveChatFilter === "resolved") return s.status === "resolved" || s.status === "closed";
                        return true;
                      })
                      .map((s) => {
                        const isSelected = selectedLiveChatSession?.id === s.id;
                        const isHot = s.needs_human === 1;
                        const isHumanTakeover = s.status === "human_takeover";

                        return (
                          <div
                            key={s.id}
                            onClick={() => {
                              setSelectedLiveChatSession(s);
                              loadLiveChatThread(s.id);
                            }}
                            className={`p-3.5 transition cursor-pointer flex flex-col gap-1.5 ${
                              isSelected
                                ? "bg-indigo-50/80 dark:bg-indigo-950/40 border-l-4 border-indigo-600"
                                : "hover:bg-white dark:hover:bg-gray-850"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                                  isHot 
                                    ? "bg-red-500 text-white animate-bounce" 
                                    : isHumanTakeover 
                                    ? "bg-emerald-600 text-white" 
                                    : "bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-200"
                                }`}>
                                  {isHot ? "🔥" : s.visitor_name ? s.visitor_name.charAt(0).toUpperCase() : "V"}
                                </div>
                                <span className="text-xs font-bold text-gray-900 dark:text-white truncate">
                                  {s.visitor_name || "Prospecto Web"}
                                  {s.company_name && (
                                    <span className="font-normal text-gray-400 ml-1">({s.company_name})</span>
                                  )}
                                </span>
                              </div>

                              <span className="text-[10px] text-gray-400 shrink-0 font-mono">
                                {s.last_message_at
                                  ? new Date(s.last_message_at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })
                                  : ""}
                              </span>
                            </div>

                            {/* Visitor Phone if registered */}
                            {s.visitor_phone && (
                              <div className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">
                                <RiWhatsappLine size={12} />
                                <span>{s.visitor_phone}</span>
                              </div>
                            )}

                            {/* Status Badge */}
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {isHot && (
                                <span className="text-[10px] bg-red-100 dark:bg-red-950/50 text-red-600 dark:text-red-400 font-bold px-2 py-0.5 rounded-full border border-red-200 dark:border-red-900 flex items-center gap-1">
                                  <RiFireFill size={10} /> Lead Caliente
                                </span>
                              )}
                              {isHumanTakeover && (
                                <span className="text-[10px] bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 font-semibold px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-900">
                                  👤 En Vivo (Tú)
                                </span>
                              )}
                              {s.status === "ai_active" && !isHot && (
                                <span className="text-[10px] bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 font-semibold px-2 py-0.5 rounded-full border border-blue-200 dark:border-blue-900">
                                  ⚡ IA SDR Activa
                                </span>
                              )}
                              {s.status === "resolved" && (
                                <span className="text-[10px] bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 font-medium px-2 py-0.5 rounded-full">
                                  ✓ Resuelto
                                </span>
                              )}
                              <span className="text-[10px] text-gray-400 uppercase font-mono">
                                {s.language || "ES"}
                              </span>
                            </div>

                            {/* Last message snippet */}
                            <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 leading-relaxed">
                              {s.last_message || "Sin mensajes"}
                            </p>
                          </div>
                        );
                      })
                  )}
                </div>
              </div>

              {/* Right Column: Chat Thread & Operator Console (8 cols) */}
              <div className="lg:col-span-8 flex flex-col h-full bg-white dark:bg-gray-900">
                {!selectedLiveChatSession ? (
                  <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-3">
                    <div className="w-16 h-16 rounded-3xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-3xl shadow-xs">
                      💬
                    </div>
                    <h3 className="text-base font-bold text-gray-900 dark:text-white">
                      Consola de Live Chat & Asistente SDR
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 max-w-md leading-relaxed">
                      Selecciona una conversación de la columna izquierda para ver los mensajes en tiempo real, supervisar las respuestas del bot de IA o tomar el control para chatear tú mismo con el visitante en vivo.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col h-full">
                    {/* Chat Header */}
                    <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-gray-50/70 dark:bg-gray-850/50">
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-bold text-gray-900 dark:text-white">
                            {selectedLiveChatSession.visitor_name || "Prospecto Web"}
                          </h4>
                          {selectedLiveChatSession.company_name && (
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              • {selectedLiveChatSession.company_name}
                            </span>
                          )}
                          {selectedLiveChatSession.needs_human === 1 && (
                            <span className="text-[10px] bg-red-500 text-white font-bold px-2 py-0.5 rounded-full flex items-center gap-1 animate-pulse">
                              <RiFireFill size={10} /> Lead Caliente
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-[11px] text-gray-400 mt-0.5 flex-wrap">
                          {selectedLiveChatSession.visitor_phone && (
                            <a
                              href={`https://wa.me/${selectedLiveChatSession.visitor_phone.replace(/[^0-9]/g, "")}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 rounded-lg hover:underline transition"
                            >
                              <RiWhatsappLine size={13} />
                              <span>{selectedLiveChatSession.visitor_phone} (Abrir en WhatsApp)</span>
                            </a>
                          )}
                          {selectedLiveChatSession.visitor_email && (
                            <span>✉️ {selectedLiveChatSession.visitor_email}</span>
                          )}
                          <span>🌐 {selectedLiveChatSession.page_url || "Landing Page"}</span>
                          <span>ID: {selectedLiveChatSession.id.slice(0, 10)}...</span>
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-2">
                        {selectedLiveChatSession.status === "human_takeover" ? (
                          <button
                            type="button"
                            disabled={liveChatActionLoading}
                            onClick={() => handleLiveChatResumeAI(selectedLiveChatSession.id)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-xs transition cursor-pointer"
                          >
                            <RiRobot3Line size={14} />
                            <span>Reactivar IA</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={liveChatActionLoading}
                            onClick={() => handleLiveChatTakeover(selectedLiveChatSession.id)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs shadow-xs transition cursor-pointer"
                          >
                            <RiUser3Line size={14} />
                            <span>Tomar Control (Pausar IA)</span>
                          </button>
                        )}

                        <button
                          type="button"
                          disabled={liveChatActionLoading}
                          onClick={() => handleLiveChatResolve(selectedLiveChatSession.id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 font-semibold text-xs transition cursor-pointer"
                        >
                          <RiCheckboxCircleLine size={14} />
                          <span>Resuelto</span>
                        </button>
                      </div>
                    </div>

                    {/* Messages Thread */}
                    <div className="flex-1 p-5 overflow-y-auto space-y-3.5 bg-slate-50/40 dark:bg-gray-900/40">
                      {liveChatLoadingThread ? (
                        <div className="py-8 text-center text-xs text-gray-400">
                          Cargando mensajes del chat...
                        </div>
                      ) : selectedLiveChatMessages.length === 0 ? (
                        <div className="py-8 text-center text-xs text-gray-400">
                          Esta conversación aún no tiene mensajes.
                        </div>
                      ) : (
                        selectedLiveChatMessages.map((msg) => {
                          const isVisitor = msg.sender_type === "visitor";
                          const isHumanAgent = msg.sender_type === "human_agent";

                          return (
                            <div
                              key={msg.id}
                              className={`flex flex-col ${isHumanAgent ? "items-end" : "items-start"}`}
                            >
                              <div className="flex items-center gap-1.5 mb-1 px-1">
                                <span className={`text-[10px] font-bold uppercase tracking-wider ${
                                  isHumanAgent
                                    ? "text-emerald-600 dark:text-emerald-400"
                                    : isVisitor
                                    ? "text-gray-600 dark:text-gray-300"
                                    : "text-indigo-600 dark:text-indigo-400"
                                }`}>
                                  {isHumanAgent
                                    ? "Roberto (Tú)"
                                    : isVisitor
                                    ? msg.sender_name || "Visitante"
                                    : "🤖 Asistente InHubFlow"}
                                </span>
                                <span className="text-[10px] text-gray-400 font-mono">
                                  {new Date(msg.created_at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                                </span>
                              </div>

                              <div
                                className={`text-xs sm:text-sm rounded-2xl px-4 py-2.5 max-w-[80%] leading-relaxed shadow-xs whitespace-pre-wrap ${
                                  isHumanAgent
                                    ? "bg-emerald-600 text-white rounded-tr-none"
                                    : isVisitor
                                    ? "bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 rounded-tl-none"
                                    : "bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-900 text-indigo-950 dark:text-indigo-200 rounded-tl-none font-normal"
                                }`}
                              >
                                {msg.message}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>

                    {/* Operator Reply Box */}
                    <form onSubmit={handleLiveChatSendReply} className="p-3 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={liveChatReplyText}
                          onChange={(e) => handleLiveChatReplyChange(e.target.value)}
                          placeholder="Escribe tu mensaje en vivo al visitante (se enviará directamente a su pantalla)..."
                          className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-xs sm:text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                        <button
                          type="submit"
                          disabled={liveChatSendingReply || !liveChatReplyText.trim()}
                          className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold text-xs shadow-xs transition cursor-pointer shrink-0"
                        >
                          <RiSendPlaneFill size={14} />
                          <span>{liveChatSendingReply ? "Enviando..." : "Enviar"}</span>
                        </button>
                      </div>
                      <div className="text-[11px] text-gray-400 mt-1.5 flex items-center justify-between">
                        <span>💡 Al responder, la IA se pausa automáticamente para no interferir con tu conversación.</span>
                        <span className="text-emerald-600 dark:text-emerald-400 font-medium">Sincronización en tiempo real activa</span>
                      </div>
                    </form>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Edit Subscriber Modal */}
      {isEditModalOpen && selectedSub && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-6 shadow-xl space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                {t("admin.modalManageSub")}
              </h3>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-white cursor-pointer"
              >
                <RiCloseLine size={20} />
              </button>
            </div>

            <div className="text-xs text-gray-500 bg-gray-50 dark:bg-gray-800/50 p-3 rounded-xl">
              {t("admin.editingTo", { email: selectedSub.email })}
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-4 text-sm">
              <div>
                <label htmlFor={editSlotsInputId} className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  {t("admin.labelSlotsLimit")}
                </label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setEditSlots((s) => Math.max(1, s - 1))}
                    className="h-10 w-10 rounded-xl border border-gray-200 dark:border-gray-700 flex items-center justify-center font-bold text-lg hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer"
                  >
                    -
                  </button>
                  <input
                    id={editSlotsInputId}
                    type="number"
                    min={1}
                    max={100}
                    value={editSlots}
                    onChange={(e) => setEditSlots(Number(e.target.value))}
                    className="flex-1 text-center font-bold text-lg py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  <button
                    type="button"
                    onClick={() => setEditSlots((s) => s + 1)}
                    className="h-10 w-10 rounded-xl border border-gray-200 dark:border-gray-700 flex items-center justify-center font-bold text-lg hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer"
                  >
                    +
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor={editPlanSelectId} className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  {t("admin.labelPlanTier")}
                </label>
                <select
                  id={editPlanSelectId}
                  value={editPlan}
                  onChange={(e) => setEditPlan(e.target.value as "starter" | "growth" | "business" | "custom")}
                  className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm"
                >
                  <option value="starter">{t("admin.planStarter")}</option>
                  <option value="growth">{t("admin.planGrowth")}</option>
                  <option value="business">{t("admin.planBusiness")}</option>
                  <option value="custom">{t("admin.planCustom")}</option>
                </select>
              </div>

              <div>
                <label htmlFor={editStatusSelectId} className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  {t("admin.labelSubStatus")}
                </label>
                <select
                  id={editStatusSelectId}
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as "active" | "trial" | "past_due" | "canceled")}
                  className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm"
                >
                  <option value="active">{t("admin.statusOptActive")}</option>
                  <option value="trial">{t("admin.statusOptTrial")}</option>
                  <option value="past_due">{t("admin.statusOptPastDue")}</option>
                  <option value="canceled">{t("admin.statusOptCanceled")}</option>
                </select>
              </div>

              <div>
                <label htmlFor={editCompanyInputId} className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  {t("admin.labelCompany")}
                </label>
                <input
                  id={editCompanyInputId}
                  type="text"
                  value={editCompany}
                  onChange={(e) => setEditCompany(e.target.value)}
                  placeholder={t("admin.placeholderCompany")}
                  className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm"
                />
              </div>

              <div className="pt-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={async () => {
                    if (!selectedSub) return;
                    setSendingEmail(true);
                    try {
                      const res = await fetch("/api/admin/subscribers/test-email", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          to: selectedSub.email,
                          companyName: editCompany,
                          planTier: editPlan,
                          slotsLimit: editSlots,
                        }),
                      });
                      const data = await res.json();
                      if (res.ok) {
                        toast.success(t("admin.toastCredentialsSent", { email: selectedSub.email }), { duration: 7000 });
                      } else {
                        toast.error(data.error || t("admin.toastCredentialsError"));
                      }
                    } catch {
                      toast.error(t("admin.toastCredentialsError"));
                    } finally {
                      setSendingEmail(false);
                    }
                  }}
                  disabled={sendingEmail}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-medium text-xs hover:bg-blue-100 dark:hover:bg-blue-900/40 cursor-pointer disabled:opacity-50"
                  title="Reenviar correo de bienvenida con credenciales vía Resend"
                >
                  <RiMailSendLine size={15} />
                  <span>{sendingEmail ? t("admin.sending") : t("admin.sendAccessEmail")}</span>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsEditModalOpen(false)}
                    className="px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-medium text-xs hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer"
                  >
                    {t("admin.cancel")}
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-medium text-xs shadow-xs disabled:opacity-50 cursor-pointer"
                  >
                    <RiCheckLine size={16} />
                    <span>{saving ? t("admin.saving") : t("admin.saveChanges")}</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Subscriber Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-6 shadow-xl space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                {t("admin.modalNewClient")}
              </h3>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-white cursor-pointer"
              >
                <RiCloseLine size={20} />
              </button>
            </div>

            {formError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 text-xs">
                {formError}
              </div>
            )}

            <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-700 dark:text-blue-300 text-xs flex items-start gap-2.5">
              <RiMailSendLine size={16} className="shrink-0 mt-0.5 text-blue-600 dark:text-blue-400" />
              <div className="space-y-1">
                <strong className="block font-semibold">{t("admin.credNoticeTitle")}</strong>
                <span>{t("admin.credNoticeDesc")}</span>
                <span className="block text-[11px] text-amber-700 dark:text-amber-300 font-medium pt-1 border-t border-blue-500/20">
                  {t("admin.credNoticeSpamHint")}
                </span>
              </div>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-4 text-sm">
              <div>
                <label htmlFor={newEmailInputId} className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  {t("admin.labelClientEmail")}
                </label>
                <input
                  id={newEmailInputId}
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder={t("admin.placeholderClientEmail")}
                  className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              <div>
                <label htmlFor={newPasswordInputId} className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  {t("admin.labelInitialPassword")}
                </label>
                <input
                  id={newPasswordInputId}
                  type="password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={t("admin.placeholderPassword")}
                  className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              <div>
                <label htmlFor={newCompanyInputId} className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  {t("admin.labelCompany")}
                </label>
                <input
                  id={newCompanyInputId}
                  type="text"
                  value={newCompany}
                  onChange={(e) => setNewCompany(e.target.value)}
                  placeholder={t("admin.placeholderCompany")}
                  className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor={newSlotsInputId} className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    {t("admin.labelAuthorizedSlots")}
                  </label>
                  <input
                    id={newSlotsInputId}
                    type="number"
                    min={1}
                    max={100}
                    value={newSlots}
                    onChange={(e) => setNewSlots(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm text-center font-bold"
                  />
                </div>

                <div>
                  <label htmlFor={newPlanSelectId} className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    {t("admin.labelPlan")}
                  </label>
                  <select
                    id={newPlanSelectId}
                    value={newPlan}
                    onChange={(e) => {
                      const val = e.target.value as "starter" | "growth" | "business" | "custom";
                      setNewPlan(val);
                      if (val === "starter") setNewSlots(1);
                      else if (val === "growth") setNewSlots(5);
                      else if (val === "business") setNewSlots(10);
                    }}
                    className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm"
                  >
                    <option value="starter">{t("admin.planOptStarter")}</option>
                    <option value="growth">{t("admin.planOptGrowth")}</option>
                    <option value="business">{t("admin.planOptBusiness")}</option>
                    <option value="custom">{t("admin.planOptCustom")}</option>
                  </select>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-medium text-xs hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer"
                >
                  {t("admin.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-medium text-xs shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  <RiUserAddLine size={16} />
                  <span>{creating ? t("admin.creating") : t("admin.createClient")}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: Crear Nuevo Partner Oficial ── */}
      {isCreatePartnerModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-3xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-6 shadow-xl space-y-5 animate-in fade-in zoom-in-95 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="p-2 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
                  <RiHandHeartLine size={20} />
                </span>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                  {t("admin.modalNewPartner")}
                </h3>
              </div>
              <button
                onClick={() => setIsCreatePartnerModalOpen(false)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-white cursor-pointer"
              >
                <RiCloseLine size={20} />
              </button>
            </div>

            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t("admin.modalNewPartnerDesc")}
            </p>

            {partnerFormError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 text-xs">
                {partnerFormError}
              </div>
            )}

            <form onSubmit={handleCreatePartner} className="space-y-4 text-sm">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    {t("admin.labelAgencyName")}
                  </label>
                  <input
                    type="text"
                    required
                    value={newPartnerName}
                    onChange={(e) => setNewPartnerName(e.target.value)}
                    placeholder={t("admin.placeholderAgencyName")}
                    className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    {t("admin.labelContactEmail")}
                  </label>
                  <input
                    type="email"
                    required
                    value={newPartnerEmail}
                    onChange={(e) => setNewPartnerEmail(e.target.value)}
                    placeholder={t("admin.placeholderContactEmail")}
                    className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    {t("admin.labelPhone")}
                  </label>
                  <input
                    type="tel"
                    value={newPartnerPhone}
                    onChange={(e) => setNewPartnerPhone(e.target.value)}
                    placeholder="+56 9 1234 5678"
                    className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    {t("admin.labelCustomCode")}
                  </label>
                  <input
                    type="text"
                    value={newPartnerCustomCode}
                    onChange={(e) => setNewPartnerCustomCode(e.target.value.toUpperCase())}
                    placeholder={t("admin.placeholderCode")}
                    maxLength={10}
                    className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm uppercase font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    {t("admin.labelPayoutMethod")}
                  </label>
                  <select
                    value={newPartnerPayoutMethod}
                    onChange={(e) => setNewPartnerPayoutMethod(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm"
                  >
                    <option value="PayPal">{t("admin.payoutPayPal")}</option>
                    <option value="Transferencia Bancaria">{t("admin.payoutBank")}</option>
                    <option value="USDT / Crypto">{t("admin.payoutCrypto")}</option>
                    <option value="Wise">{t("admin.payoutWise")}</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                    {t("admin.labelCommissionPct")}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={newPartnerCommission}
                    onChange={(e) => setNewPartnerCommission(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm font-bold text-center"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  {t("admin.labelPayoutAccount")}
                </label>
                <input
                  type="text"
                  value={newPartnerPayoutAccount}
                  onChange={(e) => setNewPartnerPayoutAccount(e.target.value)}
                  placeholder={t("admin.placeholderPayoutAccount")}
                  className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  {t("admin.labelNotes")}
                </label>
                <input
                  type="text"
                  value={newPartnerNotes}
                  onChange={(e) => setNewPartnerNotes(e.target.value)}
                  placeholder={t("admin.placeholderNotes")}
                  className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsCreatePartnerModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-medium text-xs hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer"
                >
                  {t("admin.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={partnerCreating}
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  <RiHandHeartLine size={16} />
                  <span>{partnerCreating ? t("admin.saving") : t("admin.saveAndGenerateLink")}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: Registrar Liquidación de Comisiones ── */}
      {isPayoutModalOpen && selectedPartnerForPayout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-6 shadow-xl space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="p-2 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                  <RiMoneyDollarCircleLine size={20} />
                </span>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                  {t("admin.modalPayoutTitle")}
                </h3>
              </div>
              <button
                onClick={() => setIsPayoutModalOpen(false)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-white cursor-pointer"
              >
                <RiCloseLine size={20} />
              </button>
            </div>

            <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/50 space-y-1">
              <div className="text-xs text-gray-500 dark:text-gray-400">{t("admin.payingTo")}</div>
              <div className="font-bold text-gray-900 dark:text-white text-sm">
                {selectedPartnerForPayout.name} ({selectedPartnerForPayout.code})
              </div>
              <div className="text-xs text-emerald-700 dark:text-emerald-400 font-semibold pt-1">
                {t("admin.currentBalance", { amount: selectedPartnerForPayout.balance.toFixed(2) })}
              </div>
              <div className="text-[11px] text-gray-500">
                {t("admin.payoutVia", {
                  method: selectedPartnerForPayout.payout_method,
                  account: selectedPartnerForPayout.payout_account || t("admin.notSpecified"),
                })}
              </div>
            </div>

            <form onSubmit={handleConfirmPayout} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  {t("admin.labelPayoutAmount")}
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  min={0.01}
                  max={selectedPartnerForPayout.balance}
                  value={payoutAmount}
                  onChange={(e) => setPayoutAmount(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-base font-bold text-center focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  {t("admin.labelPayoutRef")}
                </label>
                <input
                  type="text"
                  value={payoutRef}
                  onChange={(e) => setPayoutRef(e.target.value)}
                  placeholder={t("admin.placeholderPayoutRef")}
                  className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  {t("admin.labelPayoutNotes")}
                </label>
                <input
                  type="text"
                  value={payoutNotes}
                  onChange={(e) => setPayoutNotes(e.target.value)}
                  placeholder={t("admin.placeholderPayoutNotes")}
                  className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsPayoutModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-medium text-xs hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer"
                >
                  {t("admin.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={payoutSaving || payoutAmount <= 0}
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  <RiCheckLine size={16} />
                  <span>{payoutSaving ? t("admin.recording") : t("admin.confirmPayout")}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Admin Ticket Conversation Modal */}
      {isAdminTicketModalOpen && selectedAdminTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-3xl rounded-3xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-6 sm:p-8 shadow-2xl space-y-6 max-h-[92vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-4 border-b border-gray-100 dark:border-gray-800 pb-4">
              <div>
                <div className="flex items-center gap-2.5 mb-1.5 flex-wrap">
                  <span className="font-mono text-xs font-bold px-2 py-0.5 rounded-md bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200">
                    #TCK-{selectedAdminTicket.ticket_number}
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded-md bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-400 font-semibold border border-brand-200 dark:border-brand-800">
                    {selectedAdminTicket.category}
                  </span>
                  <span className="text-xs text-gray-500">
                    {new Date(selectedAdminTicket.created_at).toLocaleDateString("es-ES", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <h3 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white">
                  {selectedAdminTicket.subject}
                </h3>
                <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mt-1 flex-wrap">
                  <span>Cliente: <strong className="text-gray-900 dark:text-white">{selectedAdminTicket.user_name || selectedAdminTicket.user_email}</strong></span>
                  <span>Email: <strong className="text-gray-900 dark:text-white">{selectedAdminTicket.user_email}</strong></span>
                  {selectedTicketCustomer && (
                    <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 font-semibold text-[11px]">
                      Plan {selectedTicketCustomer.plan_tier?.toUpperCase()} ({selectedTicketCustomer.slots_limit} Slots)
                    </span>
                  )}
                </div>
              </div>

              <button
                onClick={() => setIsAdminTicketModalOpen(false)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-white cursor-pointer"
              >
                <RiCloseLine size={22} />
              </button>
            </div>

            {/* Change Status Controls */}
            <div className="flex items-center justify-between gap-4 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 text-xs">
              <span className="font-semibold text-gray-700 dark:text-gray-300">Cambiar Estado del Ticket:</span>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  disabled={adminUpdatingStatus}
                  onClick={() => handleAdminChangeStatus("in_progress")}
                  className={`px-3 py-1 rounded-lg font-semibold transition cursor-pointer ${
                    selectedAdminTicket.status === "in_progress"
                      ? "bg-indigo-600 text-white"
                      : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-100"
                  }`}
                >
                  En Proceso
                </button>
                <button
                  type="button"
                  disabled={adminUpdatingStatus}
                  onClick={() => handleAdminChangeStatus("waiting_client")}
                  className={`px-3 py-1 rounded-lg font-semibold transition cursor-pointer ${
                    selectedAdminTicket.status === "waiting_client"
                      ? "bg-amber-600 text-white"
                      : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-100"
                  }`}
                >
                  Esperando Cliente
                </button>
                <button
                  type="button"
                  disabled={adminUpdatingStatus}
                  onClick={() => handleAdminChangeStatus("resolved")}
                  className={`px-3 py-1 rounded-lg font-semibold transition cursor-pointer ${
                    selectedAdminTicket.status === "resolved"
                      ? "bg-emerald-600 text-white"
                      : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-100"
                  }`}
                >
                  Resuelto
                </button>
                <button
                  type="button"
                  disabled={adminUpdatingStatus}
                  onClick={() => handleAdminChangeStatus("closed")}
                  className={`px-3 py-1 rounded-lg font-semibold transition cursor-pointer ${
                    selectedAdminTicket.status === "closed"
                      ? "bg-gray-600 text-white"
                      : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-100"
                  }`}
                >
                  Cerrar
                </button>
              </div>
            </div>

            {/* Message Thread Scroll Area */}
            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              {adminTicketLoadingDetail ? (
                <div className="py-8 text-center text-sm text-gray-400">
                  Cargando mensajes del ticket...
                </div>
              ) : (
                selectedTicketMessages.map((msg) => {
                  const isAdmin = msg.sender_role === "admin";
                  return (
                    <div
                      key={msg.id}
                      className={`p-4 rounded-2xl border transition ${
                        isAdmin
                          ? "bg-indigo-50/60 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-900"
                          : "bg-gray-50 dark:bg-gray-800/80 border-gray-200 dark:border-gray-700"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-bold ${isAdmin ? "text-indigo-700 dark:text-indigo-400" : "text-gray-900 dark:text-white"}`}>
                            {isAdmin ? "Equipo de Soporte InHubFlow (Tú)" : msg.sender_name || msg.sender_email}
                          </span>
                          {isAdmin && (
                            <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-indigo-200/60 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-300">
                              Admin
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-gray-400 font-mono">
                          {new Date(msg.created_at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      <p className="text-xs sm:text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">
                        {msg.message}
                      </p>
                    </div>
                  );
                })
              )}
            </div>

            {/* Reply Input Box */}
            <form onSubmit={handleAdminSendReply} className="pt-2 border-t border-gray-100 dark:border-gray-800">
              <div className="space-y-3">
                <textarea
                  rows={3}
                  value={adminReplyText}
                  onChange={(e) => setAdminReplyText(e.target.value)}
                  placeholder="Escribe tu respuesta oficial para el cliente (se enviará a su plataforma y a su email)..."
                  className="w-full p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-xs sm:text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">
                    📧 El cliente recibirá una alerta en su email si Resend está activo.
                  </span>
                  <button
                    type="submit"
                    disabled={adminSendingReply || !adminReplyText.trim()}
                    className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-semibold text-xs shadow-xs disabled:opacity-50 cursor-pointer"
                  >
                    <RiSendPlaneFill size={14} />
                    <span>{adminSendingReply ? "Enviando..." : "Responder al Cliente"}</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── AI SDR KNOWLEDGE & TRAINING MODAL ── */}
      {isKnowledgeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="w-full max-w-3xl max-h-[92vh] bg-white dark:bg-gray-900 rounded-3xl shadow-2xl border border-gray-200 dark:border-gray-800 flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="p-5 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between bg-gradient-to-r from-purple-500/10 via-indigo-500/5 to-transparent">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl bg-purple-500/15 text-purple-600 dark:text-purple-400">
                  <RiBrainLine size={24} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900 dark:text-white">
                    Entrenar Asistente SDR con IA
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    Modifica el conocimiento del bot en la web: planes, precios, objeciones y reglas de atención.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsKnowledgeModalOpen(false)}
                className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition cursor-pointer"
              >
                <RiCloseLine size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSaveKnowledge} className="flex-1 flex flex-col p-5 overflow-hidden gap-4">
              <div className="p-3.5 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200/80 dark:border-indigo-800 text-xs text-indigo-950 dark:text-indigo-200 flex items-start gap-2.5">
                <span className="text-base">💡</span>
                <div className="leading-relaxed">
                  <strong>Instrucciones directas:</strong> La IA leerá este texto en cada respuesta en vivo para visitantes de <code>inhubflow.online</code>. Puedes afinar los precios, agregar nuevas promociones, instrucciones para manejo de objeciones o cambiar el tono comercial.
                </div>
              </div>

              <div className="flex-1 flex flex-col min-h-[300px]">
                <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5 flex items-center justify-between">
                  <span>Prompt del Sistema & Base de Conocimiento</span>
                  {loadingKnowledge && (
                    <span className="text-purple-600 text-xs font-normal">Cargando base de conocimiento...</span>
                  )}
                </label>
                <textarea
                  value={knowledgePrompt}
                  onChange={(e) => setKnowledgePrompt(e.target.value)}
                  disabled={loadingKnowledge || savingKnowledge}
                  rows={15}
                  placeholder="Escribe aquí las instrucciones completas, datos de la empresa, planes, precios y reglas de comportamiento..."
                  className="flex-1 w-full p-4 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/80 text-xs text-gray-900 dark:text-gray-100 font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none shadow-inner"
                />
              </div>

              {/* Modal Footer */}
              <div className="pt-2 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={handleResetKnowledge}
                  disabled={loadingKnowledge || savingKnowledge}
                  className="px-3.5 py-2 rounded-xl text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950/40 transition cursor-pointer border border-gray-200 dark:border-gray-800"
                >
                  Restaurar Plantilla Oficial
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsKnowledgeModalOpen(false)}
                    disabled={savingKnowledge}
                    className="px-4 py-2 rounded-xl text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition cursor-pointer"
                  >
                    Cancelar
                  </button>

                  <button
                    type="submit"
                    disabled={savingKnowledge || loadingKnowledge}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-semibold text-xs shadow-md transition active:scale-95 disabled:opacity-50 cursor-pointer"
                  >
                    <RiBrainLine size={16} />
                    <span>{savingKnowledge ? "Guardando Conocimiento..." : "Guardar Conocimiento"}</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
