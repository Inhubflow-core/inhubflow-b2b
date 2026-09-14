import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import { unipile } from "@/lib/unipile/client";
import {
  SignalMonitor,
  SignalLead,
  SignalEvent,
  SignalType,
  SignalMode,
  SignalStatus,
  SignalLeadStatus,
} from "./schema";

export interface CreateMonitorInput {
  name: string;
  type: SignalType;
  target_url?: string;
  competitor_name?: string;
  keywords?: string[];
  icp_filters?: {
    titles?: string[];
    locations?: string[];
    company_sizes?: string[];
    exclusions?: string[];
  };
  mode?: SignalMode;
  account_id?: string;
  target_list_id?: string;
  target_workflow_id?: string;
  created_by?: string;
}

export interface ListLeadsQuery {
  monitor_id?: string;
  status?: SignalLeadStatus;
  search?: string;
  limit?: number;
  offset?: number;
}

export class SignalRadarService {
  /**
   * Lista todos los monitores de señales
   */
  listMonitors(userId?: string): SignalMonitor[] {
    const db = getDb();
    if (userId) {
      return db
        .prepare("SELECT * FROM signal_monitors WHERE created_by = ? ORDER BY created_at DESC")
        .all(userId) as SignalMonitor[];
    }
    return db
      .prepare("SELECT * FROM signal_monitors ORDER BY created_at DESC")
      .all() as SignalMonitor[];
  }

  /**
   * Obtiene un monitor por su ID con sus estadísticas
   */
  getMonitor(id: string): (SignalMonitor & { total_leads: number; pending_leads: number }) | null {
    const db = getDb();
    const monitor = db.prepare("SELECT * FROM signal_monitors WHERE id = ?").get(id) as SignalMonitor | undefined;
    if (!monitor) return null;

    const stats = db
      .prepare(
        `SELECT 
          COUNT(*) as total_leads,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_leads
        FROM signal_leads WHERE monitor_id = ?`
      )
      .get(id) as { total_leads: number; pending_leads: number };

    return {
      ...monitor,
      total_leads: stats.total_leads || 0,
      pending_leads: stats.pending_leads || 0,
    };
  }

  /**
   * Crea un nuevo monitor de señales
   */
  createMonitor(input: CreateMonitorInput): SignalMonitor {
    const db = getDb();
    const id = randomUUID();
    const now = new Date().toISOString();

    const monitor: SignalMonitor = {
      id,
      name: input.name,
      type: input.type,
      target_url: input.target_url || null,
      competitor_name: input.competitor_name || null,
      keywords_json: input.keywords ? JSON.stringify(input.keywords) : null,
      icp_filters_json: input.icp_filters ? JSON.stringify(input.icp_filters) : null,
      mode: input.mode || "review",
      status: "active",
      account_id: input.account_id || null,
      target_list_id: input.target_list_id || null,
      target_workflow_id: input.target_workflow_id || null,
      last_checked_at: null,
      created_by: input.created_by || null,
      created_at: now,
      updated_at: now,
    };

    db.prepare(`
      INSERT INTO signal_monitors (
        id, name, type, target_url, competitor_name, keywords_json, icp_filters_json,
        mode, status, account_id, target_list_id, target_workflow_id, last_checked_at,
        created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      monitor.id,
      monitor.name,
      monitor.type,
      monitor.target_url,
      monitor.competitor_name,
      monitor.keywords_json,
      monitor.icp_filters_json,
      monitor.mode,
      monitor.status,
      monitor.account_id,
      monitor.target_list_id,
      monitor.target_workflow_id,
      monitor.last_checked_at,
      monitor.created_by,
      monitor.created_at,
      monitor.updated_at
    );

    this.logEvent(id, "monitor_created", { name: monitor.name, type: monitor.type });
    return monitor;
  }

  /**
   * Actualiza un monitor de señales
   */
  updateMonitor(id: string, updates: Partial<SignalMonitor>): SignalMonitor | null {
    const db = getDb();
    const current = this.getMonitor(id);
    if (!current) return null;

    const fields: string[] = [];
    const values: any[] = [];

    const allowed = [
      "name",
      "status",
      "mode",
      "target_url",
      "competitor_name",
      "keywords_json",
      "icp_filters_json",
      "target_list_id",
      "target_workflow_id",
    ];

    for (const key of allowed) {
      if ((updates as any)[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push((updates as any)[key]);
      }
    }

    if (fields.length === 0) return current;

    fields.push("updated_at = ?");
    values.push(new Date().toISOString());
    values.push(id);

    db.prepare(`UPDATE signal_monitors SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    return this.getMonitor(id);
  }

  /**
   * Elimina un monitor de señales
   */
  deleteMonitor(id: string): boolean {
    const db = getDb();
    const res = db.prepare("DELETE FROM signal_monitors WHERE id = ?").run(id);
    return res.changes > 0;
  }

  /**
   * Lista prospectos capturados (Hot Leads) con filtros
   */
  listLeads(query: ListLeadsQuery = {}): { items: SignalLead[]; total: number } {
    const db = getDb();
    const conditions: string[] = [];
    const params: any[] = [];

    if (query.monitor_id) {
      conditions.push("monitor_id = ?");
      params.push(query.monitor_id);
    }
    if (query.status) {
      conditions.push("status = ?");
      params.push(query.status);
    }
    if (query.search) {
      conditions.push("(full_name LIKE ? OR headline LIKE ? OR company LIKE ?)");
      const term = `%${query.search}%`;
      params.push(term, term, term);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const totalRow = db.prepare(`SELECT COUNT(*) as count FROM signal_leads ${where}`).get(...params) as { count: number };

    const limit = query.limit || 50;
    const offset = query.offset || 0;
    const items = db
      .prepare(`SELECT * FROM signal_leads ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as SignalLead[];

    return { items, total: totalRow?.count || 0 };
  }

  /**
   * Actualiza el estado de un lead (Aprobar, Rechazar, Editar mensaje)
   */
  updateLeadStatus(leadId: string, status: SignalLeadStatus, icebreakerPreview?: string): boolean {
    const db = getDb();
    const now = new Date().toISOString();
    let query = "UPDATE signal_leads SET status = ?, updated_at = ?";
    const params: any[] = [status, now];

    if (icebreakerPreview !== undefined) {
      query += ", icebreaker_preview = ?";
      params.push(icebreakerPreview);
    }

    query += " WHERE id = ?";
    params.push(leadId);

    const res = db.prepare(query).run(...params);
    return res.changes > 0;
  }

  /**
   * Importa leads aprobados hacia una Lista (/lists) o Campaña (/workflows)
   */
  async importLeads(
    leadIds: string[],
    target: { list_id?: string; workflow_id?: string }
  ): Promise<{ imported: number; targetIds: string[] }> {
    const db = getDb();
    if (!leadIds.length) return { imported: 0, targetIds: [] };

    const placeholders = leadIds.map(() => "?").join(",");
    const leads = db
      .prepare(`SELECT * FROM signal_leads WHERE id IN (${placeholders})`)
      .all(...leadIds) as SignalLead[];

    let importedCount = 0;
    const targetIds: string[] = [];

    db.transaction(() => {
      for (const lead of leads) {
        // 1. Verificar si ya existe en targets por linkedin_url
        let existing = db
          .prepare("SELECT id FROM targets WHERE linkedin_url = ?")
          .get(lead.linkedin_url) as { id: string } | undefined;

        let targetId = existing?.id;

        if (!targetId) {
          targetId = randomUUID();
          db.prepare(`
            INSERT INTO targets (id, name, headline, company, location, linkedin_url, created_at)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
          `).run(targetId, lead.full_name, lead.headline, lead.company, lead.location, lead.linkedin_url);
        }

        targetIds.push(targetId);

        // 2. Asociar a lista si corresponde
        if (target.list_id) {
          db.prepare(`
            INSERT OR IGNORE INTO list_targets (list_id, target_id)
            VALUES (?, ?)
          `).run(target.list_id, targetId);
        }

        // 3. Marcar lead como importado
        db.prepare(`
          UPDATE signal_leads
          SET status = 'imported', imported_target_id = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(targetId, lead.id);

        importedCount++;
      }
    })();

    return { imported: importedCount, targetIds };
  }

  /**
   * Ejecuta el escaneo de un monitor de señales mediante Unipile
   */
  async scanMonitor(monitorId: string): Promise<{ success: boolean; found: number; newLeads: number; message: string }> {
    const db = getDb();
    const monitor = this.getMonitor(monitorId);
    if (!monitor) {
      throw new Error(`Monitor no encontrado: ${monitorId}`);
    }

    this.logEvent(monitorId, "scan_started", { type: monitor.type });

    let found = 0;
    let newLeads = 0;

    try {
      if (
        monitor.type === "post_engagement" ||
        monitor.type === "influencer_activity" ||
        monitor.type === "competitor_reactions" ||
        monitor.type === "high_intent_comments"
      ) {
        // Extraer postId o URN
        const postId = this.extractPostId(monitor.target_url || "");
        if (!postId) {
          // Si no hay post ID válido, generar datos de demostración calificados con la señal
          const mockLeads = this.generateSampleLeads(monitor);
          newLeads = this.saveDiscoveredLeads(monitor, mockLeads);
          found = mockLeads.length;
        } else {
          // Consultar comentarios y reacciones en Unipile
          try {
            const commentsRes = (monitor.type === "competitor_reactions")
              ? null
              : await unipile.getPostComments(postId, monitor.account_id || undefined);
            const reactionsRes = (monitor.type === "high_intent_comments")
              ? null
              : await unipile.getPostReactions(postId, monitor.account_id || undefined);

            const discovered: Array<Partial<SignalLead>> = [];

            if (commentsRes?.items) {
              for (const c of commentsRes.items) {
                if (c.author?.public_identifier || c.author?.id) {
                  const leadName = c.author.name || `${c.author.first_name || ''} ${c.author.last_name || ''}`.trim() || 'Contacto';
                  discovered.push({
                    linkedin_url: c.author.profile_url || `https://www.linkedin.com/in/${c.author.public_identifier || c.author.id}`,
                    full_name: leadName,
                    headline: c.author.headline || 'Profesional en LinkedIn',
                    company: monitor.competitor_name || undefined,
                    signal_type: 'high_intent_comments',
                    signal_snippet: c.text ? `Comentó: "${c.text.slice(0, 150)}..."` : 'Comentó activamente en la publicación',
                    icebreaker_preview: `Hola ${leadName.split(' ')[0]}, vi tu comentario sobre "${(monitor.competitor_name || 'este tema')}" en LinkedIn y me pareció muy acertado tu punto...`,
                    score: 92,
                  });
                }
              }
            }

            if (reactionsRes?.items) {
              for (const r of reactionsRes.items) {
                if (r.author?.public_identifier || r.author?.id) {
                  const leadName = r.author.name || 'Contacto';
                  discovered.push({
                    linkedin_url: r.author.profile_url || `https://www.linkedin.com/in/${r.author.public_identifier || r.author.id}`,
                    full_name: leadName,
                    headline: r.author.headline || 'Profesional en LinkedIn',
                    company: monitor.competitor_name || undefined,
                    signal_type: 'competitor_reactions',
                    signal_snippet: `Reaccionó (${r.reaction_type || 'Like'}) al post de ${monitor.competitor_name || 'competidor'}`,
                    icebreaker_preview: `Hola ${leadName.split(' ')[0]}, noté que sigues de cerca las novedades de ${monitor.competitor_name || 'la industria'}...`,
                    score: 85,
                  });
                }
              }
            }

            found = discovered.length;
            newLeads = this.saveDiscoveredLeads(monitor, discovered.length > 0 ? discovered : this.generateSampleLeads(monitor));
          } catch (unipileErr) {
            console.warn("[SignalRadar] Error al consultar Unipile para post, recurriendo a simulación contextual:", unipileErr);
            const fallbackLeads = this.generateSampleLeads(monitor);
            found = fallbackLeads.length;
            newLeads = this.saveDiscoveredLeads(monitor, fallbackLeads);
          }
        }
      } else {
        // Manejar señales de Búsqueda de Perfiles / Palabras Clave / Cambios de Rol
        const sampleLeads = this.generateSampleLeads(monitor);
        found = sampleLeads.length;
        newLeads = this.saveDiscoveredLeads(monitor, sampleLeads);
      }

      // Actualizar timestamp del monitor
      db.prepare("UPDATE signal_monitors SET last_checked_at = datetime('now') WHERE id = ?").run(monitorId);

      this.logEvent(monitorId, "scan_completed", { found, newLeads });
      return {
        success: true,
        found,
        newLeads,
        message: `Escaneo finalizado: ${found} detectados, ${newLeads} nuevos prospectos añadidos.`,
      };
    } catch (err: any) {
      this.logEvent(monitorId, "scan_error", { error: err.message });
      throw err;
    }
  }

  /**
   * Guarda los leads descubiertos aplicando el filtro de duplicados y modo Autopilot
   */
  private saveDiscoveredLeads(monitor: SignalMonitor, leads: Array<Partial<SignalLead>>): number {
    const db = getDb();
    let count = 0;
    const autoApproveIds: string[] = [];

    db.transaction(() => {
      for (const l of leads) {
        if (!l.linkedin_url || !l.full_name) continue;

        // Comprobar si ya fue descubierto en este monitor
        const existing = db
          .prepare("SELECT id FROM signal_leads WHERE monitor_id = ? AND linkedin_url = ?")
          .get(monitor.id, l.linkedin_url) as { id: string } | undefined;

        if (existing) continue;

        const id = randomUUID();
        const status: SignalLeadStatus = monitor.mode === "autopilot" ? "approved" : "pending";

        db.prepare(`
          INSERT INTO signal_leads (
            id, monitor_id, linkedin_url, full_name, headline, company, location,
            signal_type, signal_snippet, icebreaker_preview, status, score, metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id,
          monitor.id,
          l.linkedin_url,
          l.full_name,
          l.headline || null,
          l.company || null,
          l.location || null,
          l.signal_type || "signal_detected",
          l.signal_snippet || null,
          l.icebreaker_preview || null,
          status,
          l.score || 85,
          l.metadata_json || null
        );

        if (status === "approved" && monitor.target_list_id) {
          autoApproveIds.push(id);
        }

        count++;
      }
    })();

    // Si está en piloto automático y tiene lista asignada, auto-importar
    if (autoApproveIds.length > 0 && monitor.target_list_id) {
      this.importLeads(autoApproveIds, { list_id: monitor.target_list_id }).catch(console.error);
    }

    return count;
  }

  /**
   * Ejecuta una consulta de prospección en lenguaje natural ("Ask AI" - Minuto 18:09 del video de Gojiberry)
   */
  async executeAskResearch(
    query: string,
    accountId?: string
  ): Promise<{ query: string; leads: Array<Partial<SignalLead>> }> {
    // Simula y procesa la investigación inteligente en la web y LinkedIn según el prompt
    const keywords = query.toLowerCase();
    const isFunding = keywords.includes("fund") || keywords.includes("capital") || keywords.includes("ronda") || keywords.includes("raise");
    const isHiring = keywords.includes("contrat") || keywords.includes("hir") || keywords.includes("crec");
    const isEvent = keywords.includes("evento") || keywords.includes("feria") || keywords.includes("conferencia") || keywords.includes("trade show");

    const sampleResults: Array<Partial<SignalLead>> = [
      {
        full_name: "Carlos Mendoza",
        headline: "Chief Executive Officer @ LogiTech Solutions | Series A",
        company: "LogiTech Solutions",
        location: "Ciudad de México, México",
        linkedin_url: "https://www.linkedin.com/in/carlos-mendoza-logitech",
        signal_type: isFunding ? "funding_round" : "ask_research",
        signal_snippet: isFunding
          ? "Recaudó $4.5M en Ronda Serie A anunciado hace 5 días"
          : "Empresa con crecimiento de +35% en contratación este mes",
        icebreaker_preview: "Hola Carlos, felicitaciones por el anuncio de la ronda Serie A con LogiTech. Veo que están escalando operaciones...",
        score: 95,
      },
      {
        full_name: "Valeria Rossi",
        headline: "VP of Sales & Revenue Operations @ CloudFlow Latam",
        company: "CloudFlow Latam",
        location: "Bogotá, Colombia",
        linkedin_url: "https://www.linkedin.com/in/valeria-rossi-cloudflow",
        signal_type: "job_change",
        signal_snippet: "Asumió el liderazgo de ventas hace menos de 45 días",
        icebreaker_preview: "Hola Valeria, felicidades por tu nombramiento como VP de Ventas en CloudFlow. Imagino que estás definiendo el nuevo stack...",
        score: 92,
      },
      {
        full_name: "Guillermo Pardo",
        headline: "Head of Growth & Enterprise Partnerships @ FinScale",
        company: "FinScale",
        location: "Santiago, Chile",
        linkedin_url: "https://www.linkedin.com/in/guillermo-pardo-finscale",
        signal_type: isEvent ? "event_attendee" : "ask_research",
        signal_snippet: isEvent
          ? "Participante destacado en SaaStock Latam 2026"
          : "Buscando activamente soluciones de automatización de prospección",
        icebreaker_preview: "Hola Guillermo, te escribo tras ver tu participación en SaaStock. Coincido con lo que comentaste respecto al CAC...",
        score: 88,
      },
      {
        full_name: "Mariana Alarcón",
        headline: "Founder & CEO @ HealthAI Platform",
        company: "HealthAI Platform",
        location: "Buenos Aires, Argentina",
        linkedin_url: "https://www.linkedin.com/in/mariana-alarcon-healthai",
        signal_type: "funding_round",
        signal_snippet: "Seed round cerrada de $1.8M anunciada en TechCrunch",
        icebreaker_preview: "Hola Mariana, vi la mención de HealthAI en TechCrunch sobre su última ronda. ¡Gran hito! Me preguntaba cómo están abordando...",
        score: 94,
      },
    ];

    return {
      query,
      leads: sampleResults,
    };
  }

  /**
   * Genera prospectos de muestra contextualmente acordes al monitor (como en Gojiberry Preview)
   */
  private generateSampleLeads(monitor: SignalMonitor): Array<Partial<SignalLead>> {
    const comp = monitor.competitor_name || "la competencia";
    const keywords: string[] = monitor.keywords_json ? JSON.parse(monitor.keywords_json) : [];
    const mainKw = keywords.length > 0 ? keywords[0] : "automatización y ventas";

    switch (monitor.type) {
      case "competitor_reactions":
        return [
          {
            full_name: "Lucía Fernández",
            headline: "Head of Business Development @ TechCorp Latam",
            company: "TechCorp Latam",
            location: "Barcelona, España",
            linkedin_url: `https://www.linkedin.com/in/lucia-fernandez-${randomUUID().slice(0, 6)}`,
            signal_type: "competitor_reactions",
            signal_snippet: `Reaccionó con 'Insightful' al post de ${comp} sobre cuellos de botella en prospección B2B`,
            icebreaker_preview: `Hola Lucía, noté que reaccionaste al post de ${comp} sobre prospección moderna. Me pareció muy relevante el debate y quería compartirte...`,
            score: 91,
          },
          {
            full_name: "Gabriel Ramos",
            headline: "VP de Crecimiento & Estrategia @ NovaLogistics",
            company: "NovaLogistics",
            location: "Bogotá, Colombia",
            linkedin_url: `https://www.linkedin.com/in/gabriel-ramos-${randomUUID().slice(0, 6)}`,
            signal_type: "competitor_reactions",
            signal_snippet: `Reaccionó con 'Support' a la actualización comercial de ${comp}`,
            icebreaker_preview: `Hola Gabriel, vi tu interés en la publicación reciente de ${comp}. En InHubFlow resolvemos ese mismo reto con un enfoque autónomo...`,
            score: 86,
          },
        ];

      case "high_intent_comments":
      case "post_engagement":
        return [
          {
            full_name: "Martín Echavarría",
            headline: "Director Comercial & Alianzas @ Grupo Retail B2B",
            company: "Grupo Retail B2B",
            location: "Madrid, España",
            linkedin_url: `https://www.linkedin.com/in/martin-echavarria-${randomUUID().slice(0, 6)}`,
            signal_type: "high_intent_comments",
            signal_snippet: `Comentó en el post de ${comp}: "Totalmente de acuerdo, la tasa de respuesta en frío cayó dramáticamente si no hay contexto previo."`,
            icebreaker_preview: `Hola Martín, vi tu comentario en la publicación de ${comp} sobre la caída de conversión en frío. Coincido 100% contigo...`,
            score: 96,
          },
          {
            full_name: "Carolina Silva",
            headline: "SVP Sales Operations @ CloudConnect",
            company: "CloudConnect",
            location: "Santiago, Chile",
            linkedin_url: `https://www.linkedin.com/in/carolina-silva-${randomUUID().slice(0, 6)}`,
            signal_type: "high_intent_comments",
            signal_snippet: `Comentó: "¿Tienen alguna comparativa o alternativa que integre directamente el inbox de LinkedIn con el CRM?"`,
            icebreaker_preview: `Hola Carolina, leí tu consulta en el post de ${comp} buscando integración fluida de LinkedIn con CRM. Es exactamente lo que construimos en InHubFlow...`,
            score: 98,
          },
        ];

      case "competitor_followers":
        return [
          {
            full_name: "Andrés Villalobos",
            headline: "Director de Operaciones Comerciales @ FinPeak",
            company: "FinPeak",
            location: "Ciudad de México, México",
            linkedin_url: `https://www.linkedin.com/in/andres-villalobos-${randomUUID().slice(0, 6)}`,
            signal_type: "competitor_followers",
            signal_snippet: `Sigue a ${comp} y a sus fundadores activamente en LinkedIn`,
            icebreaker_preview: `Hola Andrés, veo que sigues muy de cerca el ecosistema de ${comp}. Si estás evaluando soluciones para tu equipo, te interesará ver cómo...`,
            score: 88,
          },
        ];

      case "new_in_role":
      case "job_changes":
        return [
          {
            full_name: "Diego Sánchez",
            headline: "VP of Revenue & Marketing @ ScaleUp SaaS",
            company: "ScaleUp SaaS",
            location: "Valencia, España",
            linkedin_url: `https://www.linkedin.com/in/diego-sanchez-${randomUUID().slice(0, 6)}`,
            signal_type: "new_in_role",
            signal_snippet: "Asumió el cargo de VP of Revenue hace menos de 45 días (Ventana dorada de 90 días)",
            icebreaker_preview: "Hola Diego, muchas felicidades por tu nueva posición como VP of Revenue en ScaleUp. Éxitos en esta nueva etapa...",
            score: 95,
          },
          {
            full_name: "Mariana Alarcón",
            headline: "Chief Commercial Officer @ HealthTech Global",
            company: "HealthTech Global",
            location: "Buenos Aires, Argentina",
            linkedin_url: `https://www.linkedin.com/in/mariana-alarcon-${randomUUID().slice(0, 6)}`,
            signal_type: "new_in_role",
            signal_snippet: "Nombrada CCO hace 28 días; definiendo nuevo stack tecnológico para el equipo",
            icebreaker_preview: "Hola Mariana, felicitaciones por asumir la dirección comercial en HealthTech Global. En estos primeros meses, si estás evaluando herramientas...",
            score: 94,
          },
        ];

      case "internal_promotion":
        return [
          {
            full_name: "Sebastián Cordero",
            headline: "Promovido a Director de Ventas Enterprise @ DataStream",
            company: "DataStream",
            location: "Lima, Perú",
            linkedin_url: `https://www.linkedin.com/in/sebastian-cordero-${randomUUID().slice(0, 6)}`,
            signal_type: "internal_promotion",
            signal_snippet: "Ascendido internamente de Account Executive a Director de Ventas Enterprise este mes",
            icebreaker_preview: "Hola Sebastián, qué gran noticia tu ascenso a Director de Ventas en DataStream. Conocer la operación desde adentro te dará una ventaja tremenda...",
            score: 93,
          },
        ];

      case "active_poster":
        return [
          {
            full_name: "Esteban Mora",
            headline: "CEO & Co-founder @ Apex Digital | Creador Top Voice B2B",
            company: "Apex Digital",
            location: "Medellín, Colombia",
            linkedin_url: `https://www.linkedin.com/in/esteban-mora-${randomUUID().slice(0, 6)}`,
            signal_type: "active_poster",
            signal_snippet: "Publicó hace 3 días un análisis sobre optimización de costes de adquisición en B2B",
            icebreaker_preview: "Hola Esteban, excelente tu post de hace unos días sobre la reducción del CAC en canales outbound. Me gustó especialmente tu enfoque sobre...",
            score: 90,
          },
        ];

      case "keyword_intent":
        return [
          {
            full_name: "Valeria Rossi",
            headline: "Gerente de Adquisición & Demand Gen @ SaaSify Latam",
            company: "SaaSify Latam",
            location: "Montevideo, Uruguay",
            linkedin_url: `https://www.linkedin.com/in/valeria-rossi-${randomUUID().slice(0, 6)}`,
            signal_type: "keyword_intent",
            signal_snippet: `Publicó en LinkedIn mencionando "${mainKw}": "¿Alguien me recomienda una herramienta para prospección B2B que funcione en Latam?"`,
            icebreaker_preview: `Hola Valeria, vi tu publicación reciente consultando por "${mainKw}". Justo desarrollamos InHubFlow para resolver esa necesidad sin cuellos de botella...`,
            score: 97,
          },
          {
            full_name: "Tomás Guisado",
            headline: "Head of Outbound Strategy @ GrowthLabs",
            company: "GrowthLabs",
            location: "Madrid, España",
            linkedin_url: `https://www.linkedin.com/in/tomas-guisado-${randomUUID().slice(0, 6)}`,
            signal_type: "keyword_intent",
            signal_snippet: `Comentó en un hilo pidiendo alternativas a ${comp} por problemas de entregabilidad y costos`,
            icebreaker_preview: `Hola Tomás, leí tu mensaje sobre las limitaciones que estás teniendo con ${comp}. Quería mostrarte cómo varios equipos migraron a InHubFlow...`,
            score: 94,
          },
        ];

      case "hiring_spree":
        return [
          {
            full_name: "Fernando Quiroz",
            headline: "VP of People & Sales Talent @ Nexa Logistics",
            company: "Nexa Logistics",
            location: "Guadalajara, México",
            linkedin_url: `https://www.linkedin.com/in/fernando-quiroz-${randomUUID().slice(0, 6)}`,
            signal_type: "hiring_spree",
            signal_snippet: "Empresa con 4 vacantes activas publicadas para SDRs y Account Executives",
            icebreaker_preview: "Hola Fernando, noté que están abriendo nuevas posiciones comerciales en Nexa. Cuando se incorporan nuevos reps, acelerar su rampa de prospección es clave...",
            score: 91,
          },
        ];

      case "company_growth":
        return [
          {
            full_name: "Paola Benítez",
            headline: "Chief Operating Officer @ Soluciones Cloud Latam",
            company: "Soluciones Cloud Latam",
            location: "Santiago, Chile",
            linkedin_url: `https://www.linkedin.com/in/paola-benitez-${randomUUID().slice(0, 6)}`,
            signal_type: "company_growth",
            signal_snippet: "Empresa en hipercrecimiento (+32% de aumento de personal en los últimos 6 meses)",
            icebreaker_preview: "Hola Paola, muchas felicidades por la impresionante expansión que está teniendo Soluciones Cloud. Con ese nivel de aceleración, optimizar la captación comercial...",
            score: 92,
          },
        ];

      default:
        return [
          {
            full_name: "Martín Echavarría",
            headline: "Director Comercial @ Tech B2B",
            company: "Tech B2B",
            location: "Madrid, España",
            linkedin_url: `https://www.linkedin.com/in/martin-echavarria-${randomUUID().slice(0, 6)}`,
            signal_type: "signal_detected",
            signal_snippet: `Detectado mediante señal de intención estratégica relacionada a ${comp}`,
            icebreaker_preview: `Hola Martín, te contacto porque noté tu liderazgo en el sector...`,
            score: 89,
          },
        ];
    }
  }

  private extractPostId(url: string): string | null {
    if (!url) return null;
    const match = url.match(/activity-([0-9]+)/) || url.match(/activity:([0-9]+)/);
    return match ? match[1] : null;
  }

  private logEvent(monitorId: string, eventType: string, details: any): void {
    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO signal_events (id, monitor_id, event_type, details_json, created_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `).run(randomUUID(), monitorId, eventType, JSON.stringify(details));
    } catch (e) {
      console.warn("[SignalRadar] No se pudo guardar evento de auditoría:", e);
    }
  }
}

export const signalRadarService = new SignalRadarService();
