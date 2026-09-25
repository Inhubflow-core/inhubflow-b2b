import Head from "next/head";
import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/router";
import {
  RiCustomerService2Line,
  RiSendPlaneFill,
  RiArrowLeftLine,
  RiRefreshLine,
  RiFireFill,
  RiRobot3Line,
  RiUser3Line,
  RiShieldCheckLine,
  RiCheckboxCircleLine,
  RiStopCircleLine,
  RiPlayCircleLine,
  RiNotification3Line,
  RiWhatsappLine,
  RiCheckLine,
  RiDeleteBinLine,
} from "react-icons/ri";
import { toast } from "sonner";

interface ChatSession {
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
  updated_at: string;
}

interface ChatMessage {
  id: string;
  session_id: string;
  sender_type: "visitor" | "ai" | "human_agent";
  sender_name?: string;
  message: string;
  created_at: string;
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/\-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export default function LiveChatMobileAdmin() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushTesting, setPushTesting] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevSessionsCountRef = useRef<number>(0);
  const prevHotLeadsRef = useRef<number>(0);
  const lastPlayedVisitorMsgIdRef = useRef<string>("");
  const lastTypingPingRef = useRef<number>(0);

  // Web Audio chime generator (double-tone bell/bip: 880Hz -> 1318.5Hz)
  const playNotificationSound = useCallback(() => {
    try {
      if (typeof window === "undefined") return;
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      if (ctx.state === "suspended") {
        ctx.resume();
      }

      const now = ctx.currentTime;

      // Note 1: 880 Hz (A5)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = "sine";
      osc1.frequency.setValueAtTime(880, now);
      gain1.gain.setValueAtTime(0.35, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.3);

      // Note 2: 1318.5 Hz (E6) - harmonic chime
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(1318.5, now + 0.09);
      gain2.gain.setValueAtTime(0.4, now + 0.09);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.09);
      osc2.stop(now + 0.45);

      // Mobile vibration
      if ("vibrate" in navigator) {
        navigator.vibrate([200, 100, 200]);
      }
    } catch (e) {
      console.warn("Audio chime error:", e);
    }
  }, []);

  // Check URL query param for deep link
  useEffect(() => {
    if (router.query.session && typeof router.query.session === "string") {
      setSelectedSessionId(router.query.session);
    }
  }, [router.query]);

  // Check Service Worker & Web Push subscription status on mount
  useEffect(() => {
    if (typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window) {
      navigator.serviceWorker.register("/sw.js").then((reg) => {
        reg.pushManager.getSubscription().then((sub) => {
          if (sub) {
            setPushSubscribed(true);
          }
        });
      }).catch((e) => console.warn("SW register warning:", e));
    }
  }, []);

  // Web Push subscription handler (works with phone locked / app closed)
  const subscribeToPush = async () => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      toast.error("Tu navegador no soporta Notificaciones Push en segundo plano.");
      return;
    }

    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        toast.error("Permiso de notificaciones denegado. Actívalo en la configuración del navegador.");
        return;
      }

      const reg = await navigator.serviceWorker.ready;

      // 1. Fetch public VAPID key
      const keyRes = await fetch("/api/live-chat/push");
      if (!keyRes.ok) throw new Error("No se pudo obtener la clave VAPID");
      const { publicKey } = await keyRes.json();

      // 2. Subscribe via PushManager
      const existingSub = await reg.pushManager.getSubscription();
      const sub = existingSub || (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      }));

      // 3. Register subscription on backend
      const subJson = sub.toJSON();
      const saveRes = await fetch("/api/live-chat/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "subscribe",
          subscription: {
            endpoint: sub.endpoint,
            keys: {
              p256dh: subJson.keys?.p256dh,
              auth: subJson.keys?.auth,
            },
          },
          userEmail: session?.user?.email,
        }),
      });

      if (saveRes.ok) {
        setPushSubscribed(true);
        playNotificationSound();
        toast.success("🔔 ¡Notificaciones Push activadas! Recibirás alertas con la app cerrada y la pantalla apagada.");
      }
    } catch (err: any) {
      console.error("Push subscribe error:", err);
      toast.error("Error al activar notificaciones push: " + (err?.message || ""));
    }
  };

  // Test push notification (so Roberto can verify with app closed)
  const handleTestPush = async () => {
    setPushTesting(true);
    try {
      const res = await fetch("/api/live-chat/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test" }),
      });
      if (res.ok) {
        toast.success("🔔 Notificación enviada. Minimiza la app o bloquea el teléfono para verla.");
      } else {
        toast.error("No se pudo enviar la prueba");
      }
    } catch {
      toast.error("Error de conexión");
    } finally {
      setPushTesting(false);
    }
  };

  // Load sessions list
  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/live-chat/admin");
      if (res.ok) {
        const data = await res.json();
        const list = data.sessions || [];
        setSessions(list);

        // If currently open session was purged due to 5 min inactivity, reset detail view
        if (selectedSessionId && !list.some((s: any) => s.id === selectedSessionId)) {
          setSelectedSessionId(null);
          setCurrentSession(null);
          setMessages([]);
        }

        const hotLeads = list.filter((s: any) => s.needs_human === 1).length;

        // BEEP ONLY when a lead requires human attention (AI Traspaso / Handoff)
        // NEVER on own messages or normal ongoing messages
        if (prevSessionsCountRef.current > 0 && hotLeads > prevHotLeadsRef.current) {
          playNotificationSound();
        }

        prevSessionsCountRef.current = list.length;
        prevHotLeadsRef.current = hotLeads;
      }
    } catch (err) {
      console.error("Error al cargar chats:", err);
    } finally {
      setLoadingList(false);
    }
  }, [playNotificationSound, selectedSessionId]);

  // Load messages for the selected session
  const loadMessages = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`/api/live-chat/admin?sessionId=${sessionId}`);
      if (res.ok) {
        const data = await res.json();
        setCurrentSession(data.session);
        const msgs = (data.messages || []) as ChatMessage[];

        // BEEP ONLY when a message from the VISITOR arrives that hasn't been beeped yet
        // NEVER beep when Roberto sends a message or when AI responds
        if (msgs.length > 0) {
          const latestMsg = msgs[msgs.length - 1];
          if (
            latestMsg &&
            latestMsg.sender_type === "visitor" &&
            latestMsg.id !== lastPlayedVisitorMsgIdRef.current
          ) {
            lastPlayedVisitorMsgIdRef.current = latestMsg.id;
            playNotificationSound();
          }
        }

        setMessages(msgs);
      } else if (res.status === 404) {
        // Chat was deleted or expired after 5 minutes of inactivity
        setSelectedSessionId(null);
        setCurrentSession(null);
        setMessages([]);
        toast.info("El chat expiró y fue eliminado por inactividad (5 min).");
      }
    } catch (err) {
      console.error("Error al cargar mensajes:", err);
    }
  }, [playNotificationSound]);

  // Initial load and polling
  useEffect(() => {
    if (authStatus === "unauthenticated") {
      router.push("/login");
      return;
    }
    if (authStatus === "authenticated") {
      loadSessions();
      const interval = setInterval(loadSessions, 3500);
      return () => clearInterval(interval);
    }
  }, [authStatus, loadSessions, router]);

  // Poll conversation when selected
  useEffect(() => {
    if (selectedSessionId) {
      loadMessages(selectedSessionId);
      const msgInterval = setInterval(() => {
        loadMessages(selectedSessionId);
      }, 3000);
      return () => clearInterval(msgInterval);
    }
  }, [selectedSessionId, loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSelectChat = (sessionId: string) => {
    setSelectedSessionId(sessionId);
    setLoadingDetail(true);
    loadMessages(sessionId).finally(() => setLoadingDetail(false));
  };

  // Ping typing indicator to backend when Roberto types
  const handleReplyChange = (val: string) => {
    setReplyText(val);
    const now = Date.now();
    if (selectedSessionId && now - lastTypingPingRef.current > 2500) {
      lastTypingPingRef.current = now;
      fetch("/api/live-chat/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "typing", sessionId: selectedSessionId }),
      }).catch(() => {});
    }
  };

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim() || !selectedSessionId || sending) return;

    setSending(true);
    try {
      const res = await fetch("/api/live-chat/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reply",
          sessionId: selectedSessionId,
          message: replyText.trim(),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        // Record our own outgoing message ID so it never triggers a beep
        lastPlayedVisitorMsgIdRef.current = data.message.id;
        setMessages((prev) => [...prev, data.message]);
        setReplyText("");
        if (currentSession) {
          setCurrentSession({ ...currentSession, status: "human_takeover", needs_human: 0 });
        }
        loadSessions();
      } else {
        toast.error("Error al enviar el mensaje");
      }
    } catch (err) {
      toast.error("Error de conexión");
    } finally {
      setSending(false);
    }
  };

  const handleTakeover = async () => {
    if (!selectedSessionId) return;
    try {
      const res = await fetch("/api/live-chat/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "takeover", sessionId: selectedSessionId }),
      });
      if (res.ok) {
        toast.success("Has tomado el control. La IA está en pausa.");
        if (currentSession) {
          setCurrentSession({ ...currentSession, status: "human_takeover", needs_human: 0 });
        }
        loadSessions();
      }
    } catch {
      toast.error("Error al pausar la IA");
    }
  };

  const handleResumeAi = async () => {
    if (!selectedSessionId) return;
    try {
      const res = await fetch("/api/live-chat/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resume_ai", sessionId: selectedSessionId }),
      });
      if (res.ok) {
        toast.success("IA reactivada para este chat");
        if (currentSession) {
          setCurrentSession({ ...currentSession, status: "ai_active" });
        }
        loadSessions();
      }
    } catch {
      toast.error("Error al reactivar IA");
    }
  };

  const handleResolve = async () => {
    if (!selectedSessionId) return;
    try {
      const res = await fetch("/api/live-chat/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resolve", sessionId: selectedSessionId }),
      });
      if (res.ok) {
        toast.success("Chat marcado como resuelto");
        if (currentSession) {
          setCurrentSession({ ...currentSession, status: "resolved" });
        }
        loadSessions();
      }
    } catch {
      toast.error("Error al resolver chat");
    }
  };

  const handleDeleteChat = async () => {
    if (!selectedSessionId) return;
    if (!confirm("¿Eliminar este chat ahora de la base de datos?")) return;
    try {
      const res = await fetch("/api/live-chat/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", sessionId: selectedSessionId }),
      });
      if (res.ok) {
        toast.success("Chat eliminado de la base de datos");
        setSelectedSessionId(null);
        setCurrentSession(null);
        setMessages([]);
        loadSessions();
      } else {
        toast.error("No se pudo eliminar el chat");
      }
    } catch {
      toast.error("Error al eliminar chat");
    }
  };

  return (
    <>
      <Head>
        <title>Live Chat</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0" />
        <link rel="manifest" href="/manifest-live-chat.json" />
        <link rel="icon" type="image/png" href="/logo-icon.png" />
        <link rel="apple-touch-icon" href="/logo-icon.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/logo-icon.png" />
        <meta name="theme-color" content="#4f46e5" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Live Chat" />
        <meta name="application-name" content="Live Chat" />
      </Head>

      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col font-sans">
        {/* Top App Bar */}
        <header className="sticky top-0 z-40 bg-white dark:bg-gray-900 border-b border-gray-300 dark:border-gray-700 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {selectedSessionId ? (
              <button
                onClick={() => {
                  setSelectedSessionId(null);
                  setCurrentSession(null);
                }}
                className="p-1.5 -ml-1 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg cursor-pointer"
              >
                <RiArrowLeftLine size={22} />
              </button>
            ) : (
              <div className="p-2 rounded-xl bg-indigo-500/15 text-indigo-600 dark:text-indigo-400">
                <RiCustomerService2Line size={22} />
              </div>
            )}
            <div>
              <h1 className="text-base font-bold text-gray-900 dark:text-white leading-tight">
                {selectedSessionId && currentSession ? (
                  currentSession.visitor_name || "Prospecto Web"
                ) : (
                  "Live Chat"
                )}
              </h1>
              <span className="text-[11px] text-gray-500 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                {selectedSessionId && currentSession
                  ? currentSession.status === "human_takeover"
                    ? "Control manual (Tú)"
                    : "IA SDR respondiendo"
                  : `${sessions.length} chats activos`}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Push notification button / test button */}
            {pushSubscribed ? (
              <button
                onClick={handleTestPush}
                disabled={pushTesting}
                title="Toca para enviar una notificación push de prueba a tu teléfono"
                className="px-2.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 transition cursor-pointer"
              >
                <RiCheckLine size={15} />
                <span className="text-[11px]">{pushTesting ? "Enviando..." : "Push Activo"}</span>
              </button>
            ) : (
              <button
                onClick={subscribeToPush}
                title="Activar notificaciones push para recibir alertas aunque cierres la app"
                className="px-2.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white transition cursor-pointer shadow-xs animate-pulse"
              >
                <RiNotification3Line size={15} />
                <span className="text-[11px]">Activar Push</span>
              </button>
            )}

            <button
              onClick={loadSessions}
              className="p-2 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer"
            >
              <RiRefreshLine size={18} />
            </button>
          </div>
        </header>

        {/* Main Body */}
        <div className="flex-1 flex overflow-hidden">
          {/* List of Chats */}
          <div
            className={`w-full md:w-80 md:border-r border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-y-auto ${
              selectedSessionId ? "hidden md:block" : "block"
            }`}
          >
            {loadingList ? (
              <div className="p-8 text-center text-xs text-gray-400">
                Cargando conversaciones...
              </div>
            ) : sessions.length === 0 ? (
              <div className="p-8 text-center space-y-2">
                <RiCustomerService2Line className="mx-auto text-gray-300 dark:text-gray-600" size={40} />
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  No hay chats activos en este momento
                </p>
                <p className="text-xs text-gray-400">
                  Cuando un visitante en inhubflow.online abra el chat, aparecerá aquí al instante.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {sessions.map((s) => {
                  const isSelected = selectedSessionId === s.id;
                  const isHot = s.needs_human === 1;
                  return (
                    <div
                      key={s.id}
                      onClick={() => handleSelectChat(s.id)}
                      className={`p-4 cursor-pointer transition flex items-start gap-3 hover:bg-gray-50 dark:hover:bg-gray-800/60 ${
                        isSelected ? "bg-brand-50/60 dark:bg-brand-950/20" : ""
                      } ${isHot ? "bg-red-50/50 dark:bg-red-950/20" : ""}`}
                    >
                      <div
                        className={`w-10 h-10 rounded-full shrink-0 flex items-center justify-center font-bold text-xs ${
                          isHot
                            ? "bg-red-500 text-white animate-pulse"
                            : "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200"
                        }`}
                      >
                        {isHot ? <RiFireFill size={18} /> : <RiUser3Line size={18} />}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1 mb-1">
                          <span className="font-bold text-xs text-gray-900 dark:text-white truncate">
                            {s.visitor_name || "Prospecto"}
                          </span>
                          <span className="text-[10px] text-gray-400 shrink-0 font-mono">
                            {new Date(s.updated_at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>

                        {/* WhatsApp Phone if available */}
                        {s.visitor_phone && (
                          <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1 mb-0.5">
                            <RiWhatsappLine size={12} /> {s.visitor_phone}
                          </div>
                        )}

                        {s.company_name && (
                          <div className="text-[11px] text-brand-600 dark:text-brand-400 font-semibold mb-0.5 truncate">
                            🏢 {s.company_name}
                          </div>
                        )}

                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          {s.last_message || "Nueva conversación"}
                        </p>

                        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                          {isHot && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">
                              🔥 REQUIERE ATENCIÓN
                            </span>
                          )}
                          {s.status === "human_takeover" && (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                              Control Manual
                            </span>
                          )}
                          {s.status === "ai_active" && !isHot && (
                            <span className="text-[10px] px-2 py-0.5 rounded bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                              IA Activa
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Conversation Detail Area */}
          {selectedSessionId ? (
            <div className="flex-1 flex flex-col bg-gray-50/50 dark:bg-gray-950">
              {/* Quick Actions Header */}
              {currentSession && (
                <div className="bg-white dark:bg-gray-900 border-b border-gray-300 dark:border-gray-700 p-2.5 px-4 flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    {currentSession.status === "human_takeover" ? (
                      <button
                        onClick={handleResumeAi}
                        className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-semibold cursor-pointer hover:bg-gray-200"
                      >
                        <RiPlayCircleLine size={15} />
                        <span>Reanudar Bot IA</span>
                      </button>
                    ) : (
                      <button
                        onClick={handleTakeover}
                        className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold cursor-pointer shadow-xs"
                      >
                        <RiStopCircleLine size={15} />
                        <span>Tomar Control (Pausar Bot)</span>
                      </button>
                    )}

                    <button
                      onClick={handleResolve}
                      className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 font-semibold cursor-pointer border border-emerald-200 dark:border-emerald-800"
                    >
                      <RiCheckboxCircleLine size={15} />
                      <span>Resolver</span>
                    </button>

                    <button
                      onClick={handleDeleteChat}
                      title="Eliminar chat de la base de datos inmediatamente"
                      className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300 font-semibold cursor-pointer border border-red-200 dark:border-red-800 transition"
                    >
                      <RiDeleteBinLine size={15} />
                      <span>Eliminar</span>
                    </button>
                  </div>

                  {/* Direct WhatsApp link to customer */}
                  {currentSession.visitor_phone && (
                    <a
                      href={`https://wa.me/${currentSession.visitor_phone.replace(/[^0-9]/g, "")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold transition shadow-xs"
                    >
                      <RiWhatsappLine size={14} />
                      <span>{currentSession.visitor_phone}</span>
                    </a>
                  )}
                </div>
              )}

              {/* Messages Timeline */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {loadingDetail ? (
                  <div className="py-12 text-center text-xs text-gray-400">
                    Cargando conversación...
                  </div>
                ) : (
                  messages.map((m) => {
                    const isVisitor = m.sender_type === "visitor";
                    const isHuman = m.sender_type === "human_agent";

                    return (
                      <div
                        key={m.id}
                        className={`flex flex-col ${isVisitor ? "items-start" : "items-end"}`}
                      >
                        <div
                          className={`max-w-[88%] sm:max-w-md p-4 rounded-2xl text-[15px] sm:text-base leading-relaxed shadow-xs ${
                            isVisitor
                              ? "bg-white dark:bg-gray-800 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-700 rounded-tl-xs"
                              : isHuman
                              ? "bg-brand-600 text-white rounded-tr-xs"
                              : "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-950 dark:text-indigo-200 border border-indigo-200 dark:border-indigo-800/80 rounded-tr-xs"
                          }`}
                        >
                          <div className="flex items-center gap-1.5 mb-1.5 opacity-85 text-xs font-bold">
                            {isVisitor ? (
                              <span className="flex items-center gap-1">
                                <RiUser3Line size={13} /> {m.sender_name || "Visitante"}
                              </span>
                            ) : isHuman ? (
                              <span className="flex items-center gap-1 text-white">
                                <RiShieldCheckLine size={13} /> Roberto (Tú)
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-indigo-700 dark:text-indigo-400">
                                <RiRobot3Line size={13} /> Asistente IA InHubFlow
                              </span>
                            )}
                          </div>
                          <div className="whitespace-pre-wrap text-[15px] sm:text-base font-normal leading-relaxed">{m.message}</div>
                          <div className="text-xs opacity-70 text-right mt-1.5 font-mono">
                            {new Date(m.created_at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Chat Input Bar */}
              <form
                onSubmit={handleSendReply}
                className="bg-white dark:bg-gray-900 border-t border-gray-300 dark:border-gray-700 p-3 px-4 flex items-center gap-2.5"
              >
                <input
                  type="text"
                  value={replyText}
                  onChange={(e) => handleReplyChange(e.target.value)}
                  placeholder="Escribe tu mensaje a este cliente..."
                  className="flex-1 py-3 px-4 rounded-xl bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 shadow-xs text-base text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <button
                  type="submit"
                  disabled={sending || !replyText.trim()}
                  className="p-3 rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-bold transition shadow-xs cursor-pointer shrink-0"
                >
                  <RiSendPlaneFill size={20} />
                </button>
              </form>
            </div>
          ) : (
            <div className="hidden md:flex flex-1 items-center justify-center text-center p-8 text-gray-400">
              <div>
                <RiCustomerService2Line size={48} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm font-semibold">Selecciona una conversación para responder</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
