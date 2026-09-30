import Database from "better-sqlite3";
import bcrypt from "bcryptjs";

export function seedDemoWorkspace(db: Database.Database) {
  const DEMO_USER_ID = "demo_user_workspace_01";
  const DEMO_EMAIL = "demo@inhubflow.com";
  const DEMO_PASS = "Demo2026!";
  const DEMO_COMPANY = "InHubFlow Solutions";

  function daysAgo(days: number, hours = 0) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    d.setHours(d.getHours() - hours);
    return d.toISOString().replace("T", " ").substring(0, 19);
  }

  function daysAhead(days: number, hours = 0) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(d.getHours() + hours);
    return d.toISOString().replace("T", " ").substring(0, 19);
  }

  function isoDateAgo(days: number, hours = 0) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    d.setHours(d.getHours() - hours);
    return d.toISOString();
  }

  function isoDateAhead(days: number, hours = 0) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(d.getHours() + hours);
    return d.toISOString();
  }

  const prevFk = db.pragma("foreign_keys", { simple: true });
  db.pragma("foreign_keys = OFF");

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS social_selling_posts (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        account_id TEXT NOT NULL,
        topic TEXT,
        content TEXT NOT NULL,
        image_prompt TEXT,
        media_url TEXT,
        media_type TEXT NOT NULL DEFAULT 'none',
        original_post_url TEXT,
        original_author TEXT,
        original_content TEXT,
        original_metrics_json TEXT,
        scheduled_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'scheduled',
        linkedin_post_urn TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        published_at TEXT
      );

      CREATE TABLE IF NOT EXISTS sdr_meeting_bookings (
        id TEXT PRIMARY KEY,
        thread_id TEXT,
        action_id TEXT,
        calendar_integration_id TEXT,
        external_event_id TEXT,
        idempotency_key TEXT,
        status TEXT DEFAULT 'confirmed',
        timezone TEXT DEFAULT 'Europe/Madrid',
        starts_at TEXT,
        ends_at TEXT,
        attendee_email TEXT,
        meeting_url TEXT,
        offered_slots_json TEXT,
        selected_slot_json TEXT,
        error TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS calendar_events (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        target_id TEXT,
        meeting_link TEXT,
        location TEXT,
        status TEXT NOT NULL DEFAULT 'confirmed',
        channel TEXT NOT NULL DEFAULT 'sdr_ai',
        created_by TEXT,
        workspace_owner_id TEXT,
        run_id TEXT,
        list_id TEXT,
        thread_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    db.transaction(() => {
      // Limpieza de datos demo anteriores
      db.prepare(`DELETE FROM logs WHERE run_id IN ('demo_run_vps', 'demo_run_competitor', 'demo_run_saas', 'demo_run_cros') OR id LIKE 'demo_log_%'`).run();
      db.prepare(`DELETE FROM calendar_events WHERE id LIKE 'demo_cal_%' OR workspace_owner_id = ?`).run(DEMO_USER_ID);
      db.prepare(`DELETE FROM sdr_meeting_bookings WHERE id LIKE 'demo_mb_%' OR thread_id LIKE 'demo_th_%'`).run();
      db.prepare(`DELETE FROM sdr_actions WHERE id LIKE 'demo_act_%' OR thread_id LIKE 'demo_th_%'`).run();
      db.prepare(`DELETE FROM sdr_decisions WHERE id LIKE 'demo_dec_%' OR thread_id LIKE 'demo_th_%'`).run();
      db.prepare(`DELETE FROM sdr_threads WHERE id LIKE 'demo_th_%' OR target_id LIKE 'demo_target_%'`).run();
      db.prepare(`DELETE FROM run_profiles WHERE run_id LIKE 'demo_run_%'`).run();
      db.prepare(`DELETE FROM runs WHERE id LIKE 'demo_run_%'`).run();
      db.prepare(`DELETE FROM workflow_steps WHERE id LIKE 'demo_step_%'`).run();
      db.prepare(`DELETE FROM workflows WHERE id LIKE 'demo_wf_%'`).run();
      db.prepare(`DELETE FROM list_targets WHERE list_id LIKE 'demo_list_%' OR target_id LIKE 'demo_target_%'`).run();
      db.prepare(`DELETE FROM lists WHERE id LIKE 'demo_list_%'`).run();
      db.prepare(`DELETE FROM targets WHERE id LIKE 'demo_target_%'`).run();
      db.prepare(`DELETE FROM signal_leads WHERE id LIKE 'demo_sig_%'`).run();
      db.prepare(`DELETE FROM signal_monitors WHERE id LIKE 'demo_mon_%'`).run();
      db.prepare(`DELETE FROM social_selling_posts WHERE id LIKE 'demo_sp_%'`).run();
      db.prepare(`DELETE FROM linkedin_inbox_messages WHERE id LIKE 'demo_msg_%'`).run();
      db.prepare(`DELETE FROM email_accounts WHERE id LIKE 'demo_email_%' OR owner_id = ?`).run(DEMO_USER_ID);
      db.prepare(`DELETE FROM accounts WHERE id LIKE 'demo_acc_%' OR owner_id = ?`).run(DEMO_USER_ID);

      // Limpiar datos huérfanos de pruebas antiguas
      try {
        db.prepare(`DELETE FROM runs WHERE id LIKE 'tagtest_%'`).run();
        db.prepare(`DELETE FROM list_targets WHERE target_id LIKE 'tagtest_%' OR list_id LIKE 'tagtest_%'`).run();
        db.prepare(`DELETE FROM targets WHERE id LIKE 'tagtest_%'`).run();
        db.prepare(`DELETE FROM lists WHERE id LIKE 'tagtest_%'`).run();
      } catch {}

      // 1. USUARIO DEMO (Registrado hace 180 días = 6 meses de antigüedad)
      const passwordHash = bcrypt.hashSync(DEMO_PASS, 10);
      db.prepare(`
        INSERT INTO users (
          id, email, password_hash, role, company_name, slots_limit,
          subscription_status, plan_tier, name, created_at, updated_at
        ) VALUES (?, ?, ?, 'user', ?, 10, 'active', 'business', 'Roberto (Demo)', ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          email = excluded.email,
          password_hash = excluded.password_hash,
          role = 'user',
          slots_limit = 10,
          subscription_status = 'active',
          plan_tier = 'business',
          company_name = excluded.company_name,
          name = excluded.name
      `).run(DEMO_USER_ID, DEMO_EMAIL, passwordHash, DEMO_COMPANY, daysAgo(180), daysAgo(0));

      // 2. CUENTAS DE LINKEDIN CONECTADAS (2 Slots Activos con alta reputación SSI)
      const accountsData = [
        {
          id: "demo_acc_carlos",
          name: "Carlos Mendonça",
          email: "carlos.mendonca@inhubflow.online",
          owner_id: DEMO_USER_ID,
          is_authenticated: 1,
          daily_connection_limit: 20,
          daily_message_limit: 25,
          daily_inmail_limit: 10,
          active_hours_start: 9,
          active_hours_end: 19,
          timezone: "Europe/Madrid",
          working_days: '["mon","tue","wed","thu","fri"]',
          li_connections: 4210,
          li_pending: 16,
          li_profile_views: 680,
          sdr_enabled: 1,
          sdr_outbound_enabled: 1,
          profile_image_url: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=256&q=80",
          created_at: daysAgo(175),
        },
        {
          id: "demo_acc_mariana",
          name: "Mariana Silva",
          email: "mariana.silva@inhubflow.online",
          owner_id: DEMO_USER_ID,
          is_authenticated: 1,
          daily_connection_limit: 20,
          daily_message_limit: 20,
          daily_inmail_limit: 10,
          active_hours_start: 9,
          active_hours_end: 19,
          timezone: "America/Santiago",
          working_days: '["mon","tue","wed","thu","fri"]',
          li_connections: 2890,
          li_pending: 12,
          li_profile_views: 430,
          sdr_enabled: 1,
          sdr_outbound_enabled: 1,
          profile_image_url: "https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&w=256&q=80",
          created_at: daysAgo(160),
        },
      ];

      for (const acc of accountsData) {
        db.prepare(`
          INSERT INTO accounts (
            id, name, email, owner_id, is_authenticated, daily_connection_limit,
            daily_message_limit, daily_inmail_limit, active_hours_start, active_hours_end,
            timezone, working_days, li_connections, li_pending, li_profile_views,
            sdr_enabled, sdr_outbound_enabled, profile_image_url, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          acc.id, acc.name, acc.email, acc.owner_id, acc.is_authenticated,
          acc.daily_connection_limit, acc.daily_message_limit, acc.daily_inmail_limit,
          acc.active_hours_start, acc.active_hours_end, acc.timezone, acc.working_days,
          acc.li_connections, acc.li_pending, acc.li_profile_views,
          acc.sdr_enabled, acc.sdr_outbound_enabled, acc.profile_image_url, acc.created_at
        );
      }

      // 3. CUENTA DE EMAIL CONECTADA & VERIFICADA (Salud 100%, Warmup OK)
      db.prepare(`
        INSERT INTO email_accounts (
          id, name, from_email, from_name, smtp_host, smtp_port, smtp_secure,
          imap_host, imap_port, username, password, daily_email_limit,
          active_hours_start, active_hours_end, timezone, working_days,
          is_verified, inbox_synced_at, created_at, signature, reply_to,
          ramp_up_enabled, ramp_start_date, owner_id, sdr_enabled, sdr_outbound_enabled
        ) VALUES (
          'demo_email_acc_01', 'Carlos Mendonça (Google Workspace)', 'carlos@inhubflow.online',
          'Carlos Mendonça | InHubFlow', 'smtp.gmail.com', 587, 0,
          'imap.gmail.com', 993, 'carlos@inhubflow.online', 'encrypted_token_demo',
          50, 9, 19, 'Europe/Madrid', '1,2,3,4,5',
          1, datetime('now'), ?,
          '<p>Saludos cordiales,<br/><strong>Carlos Mendonça</strong><br/>Head of Partnerships | InHubFlow</p>',
          'carlos@inhubflow.online', 1, ?, ?, 1, 1
        )
      `).run(daysAgo(150), daysAgo(140), DEMO_USER_ID);

      // 4. LISTAS DE PROSPECTOS (6 Listas Especializadas)
      const listsData = [
        { id: "demo_list_tech_vps", name: "Directores Comerciales & VPs Tech Iberia", description: "Decisores de empresas de software con >50 empleados en España", created_at: daysAgo(165) },
        { id: "demo_list_competitor_radar", name: "Radar Señales Competidores Q4", description: "Prospectos detectados interactuando con herramientas de prospección", created_at: daysAgo(140) },
        { id: "demo_list_saas_ceos", name: "Fundadores & CEOs SaaS Latam", description: "Fundadores de startups en etapas Seed a Serie B en Latam", created_at: daysAgo(115) },
        { id: "demo_list_commercial_cros", name: "CROs & Enterprise Sales Directors", description: "Responsables de facturación corporativa y cuentas clave", created_at: daysAgo(90) },
        { id: "demo_list_fintech_banking", name: "Líderes de Innovación Fintech & Banca", description: "Directores comerciales de banca digital, pagos y neobancos", created_at: daysAgo(60) },
        { id: "demo_list_retail_ecommerce", name: "Head of Sales & Retail E-Commerce", description: "Líderes comerciales de e-commerce y retailers de alta escala", created_at: daysAgo(35) },
      ];

      for (const l of listsData) {
        db.prepare(`
          INSERT INTO lists (id, name, description, purpose, created_at)
          VALUES (?, ?, ?, 'linkedin', ?)
        `).run(l.id, l.name, l.description, l.created_at);
      }

      // 5. GENERACIÓN DE 415 PROSPECTOS REALISTAS PARA PIPELINE Y LISTAS
      const firstNamesPool = ["Alejandro", "Valeria", "Tomás", "Lucía", "Martín", "Claudia", "Javier", "Paula", "Gonzalo", "Camila", "Andrés", "Federico", "Natalia", "Sebastián", "Daniela", "Rodrigo", "Elena", "Matías", "Beatriz", "Felipe", "Gabriela", "Hernán", "Ignacio", "Mariano", "Silvia", "Carlos", "Andrea", "Pablo", "Lorena", "Joaquín", "Constanza", "Esteban", "Mónica", "Guillermo", "Florencia", "Diego", "Sofía", "Nicolás", "Valentina", "Lucas", "Catalina", "Emilio", "Mariana", "Agustín", "Juliana", "Santiago", "Renata", "Alonso", "Victoria", "Mauricio", "Patricia", "Cristóbal", "Fernanda", "Alfonso", "Carolina", "Leonardo", "Teresa", "Ricardo", "Adriana", "Manuel", "Isabel", "Fernando", "Rocío", "Alvaro", "Carla", "Hugo", "Verónica", "Sergio", "Daniel", "Laura"];
      const lastNamesPool = ["Gómez", "Peña", "Riquelme", "Domínguez", "Soria", "Morales", "Ibáñez", "Echeverría", "Valdés", "Rossi", "Delgado", "Bianchi", "Castro", "Pinto", "Ruiz", "Meza", "Arrieta", "Cordero", "Lozano", "Vergara", "Pardo", "Silva", "Zúñiga", "Ferrero", "Paredes", "Quintana", "Viteri", "Navarrete", "Santillán", "Bustamante", "Rios", "Navarro", "Cáceres", "Tapia", "Lema", "Herrera", "Montes", "Fuentes", "Carrasco", "Vargas", "Mendoza", "Ortega", "Guerrero", "Rojas", "Salazar", "Cabrera", "Bravo", "Reyes", "Medina", "Cortés", "Aguilar", "Romero", "Benítez", "Soto", "Garrido", "Vidal", "Ponce", "Molina", "Campos", "Vega", "Ramos", "Figueroa", "Miranda", "Pizarro", "Muñoz", "Escobar", "Salinas", "Godoy", "Bustos"];
      const companiesPool = [
        "Globant", "Rappi", "NotCo", "Clip", "Mercado Libre", "Nubank", "Cabify", "Banco Santander", "Kavak", "Logix Tech", "BairesDev", "Softtek", "Platzi", "Kushki", "Bitso", "Finaktiva", "Telefonica Tech", "Albo", "Uala", "Buk", "Crehana", "Auth0 / Okta", "Xepelin", "Tiendanube", "Addi", "Konfio", "Betterfly", "Fintual", "Justo", "Cornershop", "Chazki", "Belvo", "Cobre", "Pomelo", "BBVA Latam", "Falabella Tech", "Factorial", "Typeform", "TravelPerk", "Jobandtalent", "Playtomic", "Seedtag", "CoverManager", "Holded", "Clara", "Minu", "Kueski", "Truora", "Creditas", "QuintoAndar", "VTEX", "Stone", "Wildlife Studios", "Wallbox", "Indra", "Amadeus"
      ];
      const titlesPool = [
        "VP of Sales & Revenue", "Chief Revenue Officer (CRO)", "Director Comercial Latam", "Head of Growth & Outbound", "VP of Business Development", "Directora de Alianzas Estratégicas", "Head of Commercial Sales", "Directora Comercial Corporativa", "Head of Sales Tech", "Director Comercial SaaS", "Director de Ventas Enterprise", "VP of Strategic Sales", "Head of B2B Commercial", "Directora de Crecimiento & Leads", "Chief Sales Officer", "VP of Enterprise Accounts", "Sales Development Director", "VP of Global Sales", "Director de Estrategia Comercial", "VP of Commercial Operations", "Head of Mid-Market Sales", "Gerente de Cuentas Estratégicas", "VP of Revenue & Partnerships", "Directora Comercial B2B", "Head of Sales", "Director of Business Growth", "VP of Revenue", "Head of Strategic Growth", "Chief Commercial Officer", "Enterprise Account Director"
      ];
      const locationsPool = [
        "Madrid, España", "Barcelona, España", "Ciudad de México, México", "Santiago, Chile", "Bogotá, Colombia", "Buenos Aires, Argentina", "Medellín, Colombia", "Lima, Perú", "Monterrey, México", "Guadalajara, México", "São Paulo, Brasil", "Valencia, España"
      ];

      const targetStmt = db.prepare(`
        INSERT INTO targets (
          id, full_name, first_name, last_name, title, company, location,
          linkedin_url, email, phone, stage_id, stage_updated_at,
          connection_requested_at, connected_at, message_sent_at, last_replied_at,
          degree, company_industry, company_size, created_at, enriched_at,
          profile_image_url, email_replied_at, inmail_sent_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?
        )
      `);

      const listTargetStmt = db.prepare(`
        INSERT INTO list_targets (list_id, target_id) VALUES (?, ?)
      `);

      const TOTAL_TARGETS = 415;
      const listKeys = [
        "demo_list_tech_vps",
        "demo_list_competitor_radar",
        "demo_list_saas_ceos",
        "demo_list_commercial_cros",
        "demo_list_fintech_banking",
        "demo_list_retail_ecommerce"
      ];

      for (let idx = 1; idx <= TOTAL_TARGETS; idx++) {
        const targetId = `demo_target_${String(idx).padStart(3, "0")}`;
        const fn = firstNamesPool[(idx * 7) % firstNamesPool.length];
        const ln = lastNamesPool[(idx * 13) % lastNamesPool.length];
        const fullName = `${fn} ${ln}`;
        const company = companiesPool[(idx * 11) % companiesPool.length];
        const title = titlesPool[(idx * 5) % titlesPool.length];
        const loc = locationsPool[(idx * 3) % locationsPool.length];
        const slug = `${fn.toLowerCase()}-${ln.toLowerCase()}-${idx}`.replace(/[^a-z0-9]/g, "-");
        const emailDomain = company.toLowerCase().replace(/[^a-z0-9]/g, "") + ".com";
        const email = `${fn.toLowerCase()}.${ln.toLowerCase()}@${emailDomain}`;
        const phone = `+34 6${Math.floor(10000000 + ((idx * 987654) % 89999999))}`;

        let stageId = "stage_contacted";
        let daysConnected = null;
        let daysReplied = null;
        let daysRequested = null;
        let daysMessaged = null;
        let inmailSentAt = null;
        let emailRepliedAt = null;

        if (idx <= 18) {
          // 18 Cerrados / Ganados
          stageId = "stage_won";
          daysRequested = 30 + (idx * 6);
          daysConnected = daysRequested - 4;
          daysMessaged = daysConnected - 2;
          daysReplied = daysMessaged - 3;
        } else if (idx <= 46) {
          // 28 Reuniones Agendadas
          stageId = "stage_meeting";
          daysRequested = 15 + ((idx - 18) * 3);
          daysConnected = daysRequested - 3;
          daysMessaged = daysConnected - 2;
          daysReplied = daysMessaged - 1;
        } else if (idx <= 64) {
          // 18 Interesados calificados con respuesta en inbox
          stageId = "stage_interested";
          daysRequested = 10 + ((idx - 46) * 3);
          daysConnected = daysRequested - 3;
          daysMessaged = daysConnected - 2;
          daysReplied = daysMessaged - 1;
        } else if (idx <= 110) {
          // 46 En Conversación / Respuestas recibidas
          stageId = "stage_replied";
          daysRequested = 8 + ((idx - 64) * 2);
          daysConnected = daysRequested - 2;
          daysMessaged = daysConnected - 1;
        } else if (idx <= 182) {
          // 72 Conexiones Aceptadas con mensaje de secuencia enviado
          stageId = "stage_connected";
          daysRequested = 6 + ((idx - 110) % 50);
          daysConnected = daysRequested - 2;
          daysMessaged = daysConnected - 1;
        } else if (idx <= 227) {
          // 45 Contactados con solicitud de conexión enviada (total solicitudes = 182 + 45 = 227)
          stageId = "stage_contacted";
          daysRequested = 2 + ((idx - 182) % 30);
        } else if (idx <= 390) {
          // 163 Contactados
          stageId = "stage_contacted";
        } else {
          // 25 No interesados (descartados sin outreach)
          stageId = "stage_not_interested";
        }

        // Exactamente 76 InMails para cuentas VIP (76 / 378 = 20.1%)
        if (idx >= 228 && idx <= 303) {
          inmailSentAt = daysAgo(5 + (idx % 60));
        }

        // Exactamente 42 Respuestas de Email
        if (idx <= 42) {
          emailRepliedAt = daysAgo(daysReplied ? Math.max(1, daysReplied) : 6);
        }

        const reqAt = daysRequested ? daysAgo(daysRequested) : null;
        const connAt = daysConnected ? daysAgo(daysConnected) : null;
        const msgAt = daysMessaged ? daysAgo(daysMessaged) : null;
        const repAt = daysReplied ? daysAgo(daysReplied) : null;

        targetStmt.run(
          targetId,
          fullName,
          fn,
          ln,
          title,
          company,
          loc,
          `https://www.linkedin.com/in/${slug}/`,
          email,
          phone,
          stageId,
          daysAgo(daysReplied || daysConnected || daysRequested || 10),
          reqAt,
          connAt,
          msgAt,
          repAt,
          idx % 3 === 0 ? 1 : 2,
          "Tecnología / Software B2B & Enterprise",
          idx % 2 === 0 ? "250-1000 empleados" : "50-250 empleados",
          daysAgo(Math.min(175, 10 + idx)),
          daysAgo(Math.min(170, 8 + idx)),
          `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName)}&background=2563eb&color=fff&size=128`,
          emailRepliedAt,
          inmailSentAt
        );

        const listId = listKeys[idx % listKeys.length];
        listTargetStmt.run(listId, targetId);
      }

      // 6. WORKFLOWS Y SECUENCIAS
      const workflows = [
        {
          id: "demo_wf_vps",
          name: "Secuencia Directores Comerciales & VPs Tech",
          description: "Invitación contextual + mensaje con dolor de prospección + agendamiento con SDR IA",
          created_at: daysAgo(160),
        },
        {
          id: "demo_wf_competitor",
          name: "Radar de Competidores - Lanzamientos Q4",
          description: "Conexión contextual para prospectos con señales activas de compra detectadas en LinkedIn",
          created_at: daysAgo(135),
        },
        {
          id: "demo_wf_saas",
          name: "Outbound Escalamiento SaaS Latam",
          description: "Cadencia combinada LinkedIn + Cold Email para fundadores y decisores en crecimiento",
          created_at: daysAgo(110),
        },
        {
          id: "demo_wf_cros",
          name: "Enterprise CROs & Sales Directors",
          description: "Prospección ejecutiva con casos de éxito y ROI demostrado en reducción de CAC",
          created_at: daysAgo(85),
        },
      ];

      for (const wf of workflows) {
        db.prepare(`
          INSERT INTO workflows (id, name, description, created_at, is_archived)
          VALUES (?, ?, ?, ?, 0)
        `).run(wf.id, wf.name, wf.description, wf.created_at);
      }

      // Pasos del Workflow 1
      const stepsWf1 = [
        { id: "demo_step_1", wf_id: "demo_wf_vps", order: 1, type: "connect", body: "Hola {{firstName}}, vi que lideras el equipo comercial en {{company}}. Me gustaría conectar contigo para compartir ideas sobre prospección con IA.", delay: 0 },
        { id: "demo_step_2", wf_id: "demo_wf_vps", order: 2, type: "delay", delay: 86400 },
        { id: "demo_step_3", wf_id: "demo_wf_vps", order: 3, type: "message", body: "Hola {{firstName}}, un gusto conectar. ¿Cómo están gestionando actualmente la detección de señales de compra en LinkedIn para evitar el spam en frío? Te pregunto porque en InHubFlow ayudamos a directores de ventas a agendar 30+ demos al mes de forma autónoma. ¿Te haría sentido revisar un demo rápido de 10 minutos esta semana?", delay: 0 },
        { id: "demo_step_4", wf_id: "demo_wf_vps", order: 4, type: "delay", delay: 259200 },
        { id: "demo_step_5", wf_id: "demo_wf_vps", order: 5, type: "message", body: "Hola {{firstName}}, te comparto un caso de estudio breve donde un equipo de 2 personas generó 40 reuniones el mes pasado con nuestro SDR IA. Si tienes 10 minutos el jueves, podemos ver si aplica a {{company}}.", delay: 0 },
      ];

      for (const s of stepsWf1) {
        db.prepare(`
          INSERT INTO workflow_steps (
            id, workflow_id, step_order, step_type, message_body, delay_seconds, enabled, track
          ) VALUES (?, ?, ?, ?, ?, ?, 1, 'linkedin')
        `).run(s.id, s.wf_id, s.order, s.type, s.body || null, s.delay || 0);
      }

      // 4 Runs Activas
      const runsData = [
        { id: "demo_run_vps", wf: "demo_wf_vps", list: "demo_list_tech_vps", acc: "demo_acc_carlos", created: 155 },
        { id: "demo_run_competitor", wf: "demo_wf_competitor", list: "demo_list_competitor_radar", acc: "demo_acc_mariana", created: 130 },
        { id: "demo_run_saas", wf: "demo_wf_saas", list: "demo_list_saas_ceos", acc: "demo_acc_carlos", created: 105 },
        { id: "demo_run_cros", wf: "demo_wf_cros", list: "demo_list_commercial_cros", acc: "demo_acc_mariana", created: 80 },
      ];

      for (const r of runsData) {
        db.prepare(`
          INSERT INTO runs (id, workflow_id, list_id, account_id, status, created_at, started_at)
          VALUES (?, ?, ?, ?, 'running', ?, ?)
        `).run(r.id, r.wf, r.list, r.acc, daysAgo(r.created), daysAgo(r.created));

        db.prepare(`
          INSERT OR IGNORE INTO run_profiles (id, run_id, target_id, created_at)
          SELECT 'demo_rp_' || ? || '_' || lt.target_id, ?, lt.target_id, ?
          FROM list_targets lt
          WHERE lt.list_id = ?
        `).run(r.id, r.id, daysAgo(r.created), r.list);
      }

      // 7. RADAR DE SEÑALES DE INTENCIÓN (4 Monitores)
      const monitors = [
        { id: "demo_mon_post_competitor", name: "Post de Competidor: Software de Prospección B2B", type: "competitor_post", competitor: "Competidor X / Automatización Comercial", url: "https://www.linkedin.com/posts/competitor-post-launch", mode: "autopilot", status: "active", acc: "demo_acc_carlos", list: "demo_list_competitor_radar", wf: "demo_wf_competitor" },
        { id: "demo_mon_keywords", name: "Palabras Clave: Busco Alternativa CRM / Waalaxy", type: "keyword", competitor: null, url: null, keywords: '["busco crm", "alternativa a waalaxy", "automatizar ventas linkedin", "sdr ia"]', mode: "review", status: "active", acc: "demo_acc_mariana", list: "demo_list_competitor_radar", wf: "demo_wf_competitor" },
        { id: "demo_mon_job_changes", name: "Nuevos Nombramientos: VPs de Ventas & CROs Tech", type: "job_change", competitor: null, url: null, mode: "autopilot", status: "active", acc: "demo_acc_carlos", list: "demo_list_tech_vps", wf: "demo_wf_vps" },
        { id: "demo_mon_funding", name: "Rondas de Inversión Semilla y Serie A Latam", type: "funding_round", competitor: null, url: null, mode: "autopilot", status: "active", acc: "demo_acc_mariana", list: "demo_list_saas_ceos", wf: "demo_wf_saas" },
      ];

      for (const m of monitors) {
        db.prepare(`
          INSERT INTO signal_monitors (
            id, workspace_owner_id, name, type, competitor_name, target_url,
            keywords_json, mode, status, account_id, target_list_id, target_workflow_id,
            scan_interval_minutes, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 30, ?, ?)
        `).run(
          m.id, DEMO_USER_ID, m.name, m.type, m.competitor, m.url,
          m.keywords || null, m.mode, m.status, m.acc, m.list, m.wf,
          daysAgo(120), daysAgo(0)
        );
      }

      // Signal Leads
      const signalLeadsData = [
        { id: "demo_sig_01", mon_id: "demo_mon_post_competitor", name: "Camila Rossi", company: "Logix Tech", headline: "Head of Growth & Outbound", score: 98, type: "Post Comment", snippet: 'Comentó en el post de Competidor X: "¿Tienen integración nativa con HubSpot y verificación de emails?"', icebreaker: "Hola Camila, vi tu comentario sobre HubSpot y verificación. En InHubFlow conectamos nativamente con tu CRM para agendar citas sin fricción. ¿Te gustaría ver un demo de 10 min esta semana?" },
        { id: "demo_sig_02", mon_id: "demo_mon_post_competitor", name: "Tomás Riquelme", company: "NotCo", headline: "Director Comercial Latam", score: 96, type: "Post Reaction", snippet: 'Reaccionó a la publicación sobre automatización comercial de alta respuesta.', icebreaker: "Hola Tomás, vi que te interesó el debate sobre prospección con IA. Ayudamos a empresas B2B a duplicar su tasa de respuesta. ¿Te hace sentido conectar?" },
        { id: "demo_sig_03", mon_id: "demo_mon_keywords", name: "Alejandro Gómez", company: "Globant", headline: "VP of Sales & Revenue Tech", score: 95, type: "Keyword Mention", snippet: 'Publicó en LinkedIn: "Estamos evaluando herramientas de SDR con IA para expandir el pipeline en Europa. Recomendaciones bienvenidas."', icebreaker: "Hola Alejandro, justo vi tu publicación buscando soluciones de SDR con IA. Desarrollamos InHubFlow para resolver eso con agentes que agendan directo en calendario. ¿Te envío un resumen breve?" },
        { id: "demo_sig_04", mon_id: "demo_mon_job_changes", name: "Valeria Peña", company: "Rappi", headline: "Chief Revenue Officer (CRO)", score: 97, type: "Job Promotion", snippet: 'Asumió recientemente la posición de CRO liderando la expansión comercial regional.', icebreaker: "¡Felicidades por tu nuevo rol de CRO en Rappi, Valeria! Cuando los líderes asumen el puesto suelen buscar acelerar el pipeline de ventas desde el mes 1. ¿Conversamos 10 minutos?" },
        { id: "demo_sig_05", mon_id: "demo_mon_funding", name: "Martín Soria", company: "Mercado Libre", headline: "VP of Business Development", score: 94, type: "Company Growth", snippet: 'Anunció la expansión de nuevas líneas corporativas y búsqueda de socios comerciales.', icebreaker: "Hola Martín, felicitaciones por la expansión. Con InHubFlow apoyamos la prospección outbound para nuevos verticales ahorrando 15h semanales por cuenta. ¿Te muestro un caso rápido?" },
      ];

      for (const sl of signalLeadsData) {
        const slug = sl.name.toLowerCase().replace(/[^a-z0-9]/g, "-");
        const linkedinUrl = `https://www.linkedin.com/in/${slug}/`;
        db.prepare(`
          INSERT INTO signal_leads (
            id, workspace_owner_id, monitor_id, linkedin_url, identity_key, full_name, headline, company,
            signal_type, signal_snippet, icebreaker_preview, status, score,
            signal_count, first_detected_at, last_detected_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, 1, ?, ?, ?, ?)
        `).run(
          sl.id, DEMO_USER_ID, sl.mon_id, linkedinUrl, linkedinUrl.toLowerCase(), sl.name, sl.headline, sl.company,
          sl.type, sl.snippet, sl.icebreaker, sl.score,
          daysAgo(4), daysAgo(1), daysAgo(4), daysAgo(1)
        );
      }

      // 8. SOCIAL SELLING
      const socialSellingData = [
        { topic: "Estrategia Outbound", content: "El mayor error en B2B no es el volumen, es la falta de contexto. 50 mensajes bien dirigidos superan a 1000 correos genéricos.", days: -90, status: "published" },
        { topic: "Metodología", content: "Cómo diseñar una propuesta de valor en LinkedIn que genere conversaciones en menos de 48 horas.", days: -75, status: "published" },
        { topic: "Caso de Éxito", content: "De 0 a 24 reuniones mensuales con SDR IA: desglosamos la cadencia paso a paso.", days: -60, status: "published" },
        { topic: "Radar de Señales", content: "Por qué las publicaciones de tus competidores son la mejor fuente de leads calificados.", days: -45, status: "published" },
        { topic: "Inteligencia Artificial", content: "El SDR IA no reemplaza al vendedor; elimina la fricción manual para que el equipo cierre más.", days: -30, status: "published" },
        { topic: "Entregabilidad", content: "Warmup y salud de dominio: cómo mantener un 99% de bandeja de entrada en frío.", days: -15, status: "published" },
        { topic: "Reflexión Comercial", content: "Tu perfil de LinkedIn es la landing page de tu solución. ¿La tuya convierte visitas en clientes?", days: -5, status: "published" },
        { topic: "Tendencias 2026", content: "La era del spam masivo ha terminado. La prospección contextual dominará las ventas B2B este año.", days: 2, status: "scheduled" },
        { topic: "Playbook de Ventas", content: "5 preguntas que debes hacer en tu mensaje de conexión para abrir una conversación real.", days: 5, status: "scheduled" },
        { topic: "Productividad", content: "Cómo un equipo de 2 personas gestiona un pipeline de $500k con automatización inteligente.", days: 8, status: "scheduled" },
        { topic: "SDR Autónomo", content: "Manejo de objeciones con agentes de IA: cómo entrenar respuestas que generan confianza.", days: 12, status: "scheduled" },
      ];

      let spIdx = 0;
      for (const sp of socialSellingData) {
        spIdx++;
        const schedDate = sp.days < 0 ? daysAgo(Math.abs(sp.days)) : daysAhead(sp.days);
        db.prepare(`
          INSERT INTO social_selling_posts (
            id, user_id, account_id, topic, content, status, scheduled_at, published_at, created_at
          ) VALUES (?, ?, 'demo_acc_carlos', ?, ?, ?, ?, ?, ?)
        `).run(
          `demo_sp_${String(spIdx).padStart(3, "0")}`, DEMO_USER_ID, sp.topic, sp.content,
          sp.status, schedDate, sp.status === "published" ? schedDate : null, daysAgo(100)
        );
      }

      // 9. AGENDAMIENTOS & REUNIONES EN CALENDARIO (26 Reuniones Comerciales: 18 pasadas + 8 próximas)
      const meetingExecutives = [
        // Próximas Confirmadas (próximos 14 días)
        { id: "up_1", name: "Alejandro Gómez", company: "Globant", title: "VP of Sales & Revenue", targetId: "demo_target_001", days: 1, hour: 10, status: "confirmed" },
        { id: "up_2", name: "Valeria Peña", company: "Rappi", title: "Chief Revenue Officer", targetId: "demo_target_002", days: 2, hour: 11, status: "confirmed" },
        { id: "up_3", name: "Tomás Riquelme", company: "NotCo", title: "Director Comercial Latam", targetId: "demo_target_003", days: 3, hour: 15, status: "confirmed" },
        { id: "up_4", name: "Lucía Domínguez", company: "Clip", title: "Head of Growth", targetId: "demo_target_004", days: 5, hour: 10, status: "confirmed" },
        { id: "up_5", name: "Martín Soria", company: "Mercado Libre", title: "VP of Business Development", targetId: "demo_target_005", days: 6, hour: 16, status: "confirmed" },
        { id: "up_6", name: "Claudia Morales", company: "Nubank", title: "Directora de Alianzas", targetId: "demo_target_006", days: 8, hour: 11, status: "confirmed" },
        { id: "up_7", name: "Javier Ibáñez", company: "Cabify", title: "Head of Commercial Sales", targetId: "demo_target_007", days: 9, hour: 12, status: "confirmed" },
        { id: "up_8", name: "Paula Echeverría", company: "Banco Santander", title: "Directora Comercial Corporativa", targetId: "demo_target_008", days: 11, hour: 17, status: "confirmed" },

        // Pasadas Completadas (a lo largo de los últimos 6 meses)
        { id: "past_1", name: "Gonzalo Valdés", company: "Kavak", title: "Head of Sales Tech", targetId: "demo_target_009", days: -8, hour: 10, status: "completed" },
        { id: "past_2", name: "Camila Rossi", company: "Logix Tech", title: "Head of Growth", targetId: "demo_target_010", days: -15, hour: 11, status: "completed" },
        { id: "past_3", name: "Andrés Delgado", company: "BairesDev", title: "Director Comercial SaaS", targetId: "demo_target_011", days: -22, hour: 15, status: "completed" },
        { id: "past_4", name: "Federico Bianchi", company: "Softtek", title: "Director de Ventas Enterprise", targetId: "demo_target_012", days: -30, hour: 16, status: "completed" },
        { id: "past_5", name: "Natalia Castro", company: "Platzi", title: "VP of Strategic Sales", targetId: "demo_target_013", days: -42, hour: 10, status: "completed" },
        { id: "past_6", name: "Sebastián Pinto", company: "Kushki", title: "Head of B2B Commercial", targetId: "demo_target_014", days: -55, hour: 12, status: "completed" },
        { id: "past_7", name: "Daniela Ruiz", company: "Bitso", title: "Directora de Crecimiento", targetId: "demo_target_015", days: -68, hour: 14, status: "completed" },
        { id: "past_8", name: "Rodrigo Meza", company: "Finaktiva", title: "Chief Sales Officer", targetId: "demo_target_016", days: -80, hour: 11, status: "completed" },
        { id: "past_9", name: "Elena Arrieta", company: "Telefonica Tech", title: "VP of Enterprise Accounts", targetId: "demo_target_017", days: -95, hour: 16, status: "completed" },
        { id: "past_10", name: "Matías Cordero", company: "Albo", title: "Director Comercial", targetId: "demo_target_018", days: -108, hour: 10, status: "completed" },
        { id: "past_11", name: "Beatriz Lozano", company: "Uala", title: "Head of Business Growth", targetId: "demo_target_019", days: -120, hour: 15, status: "completed" },
        { id: "past_12", name: "Felipe Vergara", company: "Buk", title: "Gerente Comercial B2B", targetId: "demo_target_020", days: -132, hour: 11, status: "completed" },
        { id: "past_13", name: "Gabriela Pardo", company: "Crehana", title: "Sales Development Director", targetId: "demo_target_021", days: -142, hour: 16, status: "completed" },
        { id: "past_14", name: "Hernán Silva", company: "Auth0 / Okta", title: "VP of Global Sales", targetId: "demo_target_022", days: -150, hour: 12, status: "completed" },
        { id: "past_15", name: "Ignacio Zúñiga", company: "Xepelin", title: "Director de Estrategia Comercial", targetId: "demo_target_023", days: -158, hour: 10, status: "completed" },
        { id: "past_16", name: "Mariano Ferrero", company: "Tiendanube", title: "VP of Commercial Operations", targetId: "demo_target_024", days: -164, hour: 15, status: "completed" },
        { id: "past_17", name: "Silvia Paredes", company: "Addi", title: "Directora Comercial", targetId: "demo_target_025", days: -170, hour: 11, status: "completed" },
        { id: "past_18", name: "Carlos Quintana", company: "Konfio", title: "Head of Mid-Market Sales", targetId: "demo_target_026", days: -174, hour: 16, status: "completed" },
      ];

      const defaultAgent = db.prepare("SELECT id FROM sdr_agents LIMIT 1").get() as { id: string } | undefined;
      if (defaultAgent) {
        db.prepare(`
          INSERT INTO sdr_calendar_integrations (
            id, agent_id, provider, account_email, calendar_id, status, created_at, updated_at
          ) VALUES ('demo_cal_int_01', ?, 'google', 'demo@inhubflow.com', 'primary', 'connected', datetime('now'), datetime('now'))
          ON CONFLICT(agent_id, provider) DO UPDATE SET status = 'connected'
        `).run(defaultAgent.id);
      }

      for (const m of meetingExecutives) {
        const isFuture = m.days > 0;
        const startIso = isFuture ? isoDateAhead(m.days, -m.hour) : isoDateAgo(Math.abs(m.days), -m.hour);
        const endIso = isFuture ? isoDateAhead(m.days, -(m.hour + 1)) : isoDateAgo(Math.abs(m.days), -(m.hour + 1));
        const meetLink = "https://meet.google.com/inh-demo-meet";

        db.prepare(`
          INSERT INTO calendar_events (
            id, title, description, start_time, end_time, target_id,
            meeting_link, location, status, channel, created_by, workspace_owner_id,
            run_id, list_id, thread_id, created_at, updated_at
          ) VALUES (
            ?, ?, ?, ?, ?, ?,
            ?, 'Google Meet', ?, 'sdr_ai', ?, ?,
            'demo_run_vps', 'demo_list_tech_vps', ?, ?, ?
          )
        `).run(
          `demo_cal_${m.id}`,
          `Demo InHubFlow <> ${m.name} (${m.company})`,
          `Reunión demostrativa agendada de forma autónoma por InHubFlow SDR IA tras detectar alto interés con ${m.name} (${m.title}).`,
          startIso,
          endIso,
          m.targetId,
          meetLink,
          m.status,
          DEMO_USER_ID,
          DEMO_USER_ID,
          `demo_th_${m.id}`,
          isFuture ? daysAgo(2) : daysAgo(Math.abs(m.days) + 2),
          isFuture ? daysAgo(2) : daysAgo(Math.abs(m.days) + 2)
        );

        try {
          db.prepare(`
            INSERT INTO sdr_meeting_bookings (
              id, thread_id, calendar_integration_id, idempotency_key, status, timezone, starts_at, ends_at, attendee_email, meeting_url, created_at, updated_at
            ) VALUES (?, ?, 'demo_cal_int_01', ?, ?, 'Europe/Madrid', ?, ?, ?, ?, ?, ?)
          `).run(
            `demo_mb_${m.id}`,
            `demo_th_${m.id}`,
            `idem_mb_${m.id}`,
            m.status,
            startIso,
            endIso,
            `${m.name.toLowerCase().replace(/\s+/g, '.')}@example.com`,
            meetLink,
            isFuture ? daysAgo(2) : daysAgo(Math.abs(m.days) + 2),
            isFuture ? daysAgo(2) : daysAgo(Math.abs(m.days) + 2)
          );
        } catch {}

        db.prepare(`
          INSERT INTO sdr_threads (
            id, target_id, channel, linkedin_account_id, external_thread_id, state,
            ai_turn_count, workspace_owner_id, automation_enabled, created_at, updated_at
          ) VALUES (?, ?, 'linkedin', 'demo_acc_carlos', ?, 'AI_ACTIVE', 3, ?, 1, ?, ?)
        `).run(
          `demo_th_${m.id}`,
          m.targetId,
          `ext_th_${m.id}`,
          DEMO_USER_ID,
          isFuture ? daysAgo(3) : daysAgo(Math.abs(m.days) + 3),
          isFuture ? daysAgo(1) : daysAgo(Math.abs(m.days) + 1)
        );

        db.prepare(`
          INSERT INTO sdr_decisions (
            id, thread_id, intent, confidence, risk_level, language, recommended_action,
            decision_json, created_at, workspace_owner_id
          ) VALUES (?, ?, 'BOOK_MEETING', 0.96, 'low', 'es', 'schedule_calendar_link', '{"intent":"book_meeting","confidence":0.96}', ?, ?)
        `).run(
          `demo_dec_${m.id}`,
          `demo_th_${m.id}`,
          isFuture ? daysAgo(2) : daysAgo(Math.abs(m.days) + 2),
          DEMO_USER_ID
        );

        db.prepare(`
          INSERT INTO sdr_actions (
            id, decision_id, thread_id, action_type, state, idempotency_key, requires_approval,
            created_at, updated_at, workspace_owner_id
          ) VALUES (?, ?, ?, 'send_calendar_invite', 'completed', ?, 0, ?, ?, ?)
        `).run(
          `demo_act_${m.id}`,
          `demo_dec_${m.id}`,
          `demo_th_${m.id}`,
          `idem_${m.id}`,
          isFuture ? daysAgo(2) : daysAgo(Math.abs(m.days) + 2),
          isFuture ? daysAgo(2) : daysAgo(Math.abs(m.days) + 2),
          DEMO_USER_ID
        );
      }

      // 10. MENSAJES EN SMART INBOX
      const highlightedConversations = [
        { targetId: "demo_target_001", name: "Alejandro Gómez", company: "Globant", threadId: "demo_th_up_1" },
        { targetId: "demo_target_002", name: "Valeria Peña", company: "Rappi", threadId: "demo_th_up_2" },
        { targetId: "demo_target_003", name: "Tomás Riquelme", company: "NotCo", threadId: "demo_th_up_3" },
        { targetId: "demo_target_004", name: "Lucía Domínguez", company: "Clip", threadId: "demo_th_up_4" },
        { targetId: "demo_target_005", name: "Martín Soria", company: "Mercado Libre", threadId: "demo_th_up_5" },
      ];

      for (const hc of highlightedConversations) {
        db.prepare(`
          INSERT INTO linkedin_inbox_messages (
            id, account_id, target_id, run_id, workflow_id, external_thread_id, external_message_id,
            direction, sender_name, body, sent_at, captured_at, identity_mode, metadata_json
          ) VALUES (?, 'demo_acc_carlos', ?, 'demo_run_vps', 'demo_wf_vps', ?, ?, 'outbound', 'Carlos Mendonça', ?, ?, ?, 'profile_url', '{}')
        `).run(
          `demo_msg_${hc.targetId}_1`, hc.targetId, hc.threadId, `ext_${hc.targetId}_1`,
          `Hola ${hc.name.split(" ")[0]}, un gusto conectar. ¿Cómo están gestionando la prospección comercial en ${hc.company}? Con InHubFlow ayudamos a generar 30+ reuniones al mes usando agentes SDR con IA. ¿Tendrías 10 min esta semana para ver un demo?`,
          daysAgo(4), daysAgo(4)
        );

        db.prepare(`
          INSERT INTO linkedin_inbox_messages (
            id, account_id, target_id, run_id, workflow_id, external_thread_id, external_message_id,
            direction, sender_name, body, sent_at, captured_at, identity_mode, metadata_json
          ) VALUES (?, 'demo_acc_carlos', ?, 'demo_run_vps', 'demo_wf_vps', ?, ?, 'inbound', ?, ?, ?, ?, 'profile_url', '{}')
        `).run(
          `demo_msg_${hc.targetId}_2`, hc.targetId, hc.threadId, `ext_${hc.targetId}_2`,
          hc.name,
          `Hola Carlos, me parece muy interesante. Justo estamos buscando soluciones más inteligentes para prospección. ¿Qué tal si nos vemos por videollamada para revisarlo?`,
          daysAgo(2), daysAgo(2)
        );

        db.prepare(`
          INSERT INTO linkedin_inbox_messages (
            id, account_id, target_id, run_id, workflow_id, external_thread_id, external_message_id,
            direction, sender_name, body, sent_at, captured_at, identity_mode, metadata_json
          ) VALUES (?, 'demo_acc_carlos', ?, 'demo_run_vps', 'demo_wf_vps', ?, ?, 'outbound', 'InHubFlow SDR IA', ?, ?, ?, 'profile_url', '{}')
        `).run(
          `demo_msg_${hc.targetId}_3`, hc.targetId, hc.threadId, `ext_${hc.targetId}_3`,
          `¡Excelente ${hc.name.split(" ")[0]}! Quedó agendada la demo en tu calendario con el link de Google Meet. ¡Nos vemos en la sesión!`,
          daysAgo(1), daysAgo(1)
        );
      }

      // 11. HISTORIAL DE ACTIVIDAD EN LOGS
      // Requisitos exactos del usuario:
      // - 350 perfiles visitados en total (342 históricos + 8 de hoy)
      // - 350 perfiles seguidos en total (342 históricos + 8 de hoy)
      const logStmt = db.prepare(`
        INSERT INTO logs (id, run_id, target_id, level, message, created_at)
        VALUES (?, 'demo_run_vps', ?, 'info', ?, ?)
      `);

      let logCounter = 0;

      function insertDistributedLogs(totalCount: number, message: string, maxDays = 175) {
        for (let i = 0; i < totalCount; i++) {
          logCounter++;
          const dayOffset = Math.max(1, Math.floor((i / totalCount) * maxDays));
          const hourOffset = 9 + (i % 9);
          const targetNum = (i % TOTAL_TARGETS) + 1;
          const targetId = `demo_target_${String(targetNum).padStart(3, "0")}`;
          logStmt.run(`demo_log_${logCounter}`, targetId, message, daysAgo(dayOffset, hourOffset));
        }
      }

      // 370 históricos + 8 de hoy = EXACTAMENTE 378 Visitas
      insertDistributedLogs(370, "Visitó perfil en LinkedIn", 175);

      // 370 históricos + 8 de hoy = EXACTAMENTE 378 Seguidos
      insertDistributedLogs(370, "Perfil seguido en LinkedIn", 175);

      // 280 históricos + 5 de hoy = EXACTAMENTE 285 Likes y Comentarios
      insertDistributedLogs(280, "Like y comentario en publicación", 170);

      // 221 históricos + 6 de hoy = EXACTAMENTE 227 Solicitudes de conexión (60% de 378)
      insertDistributedLogs(221, "Solicitud de conexión enviada", 170);

      // 178 históricos + 4 de hoy = EXACTAMENTE 182 Conexiones aceptadas (80% tasa de aceptación)
      insertDistributedLogs(178, "El contacto aceptó la solicitud de conexión", 165);

      // 177 históricos + 5 de hoy = EXACTAMENTE 182 Mensajes enviados (igual a conexiones exitosas)
      insertDistributedLogs(177, "Mensaje enviado al contacto", 160);

      // 74 históricos + 2 de hoy = EXACTAMENTE 76 InMails enviados (20% de 378)
      insertDistributedLogs(74, "InMail enviado al contacto", 120);

      // 336 históricos + 4 de hoy = EXACTAMENTE 340 Emails enviados
      insertDistributedLogs(336, "Email sent to commercial contact", 150);

      // Actividad viva de HOY
      const todayVisits = 8;
      const todayFollows = 8;
      const todayLikes = 5;
      const todayConns = 6;
      const todayMsgs = 5;
      const todayInmails = 2;
      const todayEmails = 4;

      for (let tv = 0; tv < todayVisits; tv++) {
        logCounter++;
        logStmt.run(`demo_log_today_${tv}`, `demo_target_00${tv + 1}`, "Visitó perfil en LinkedIn", daysAgo(0, 1 + tv));
      }
      for (let tf = 0; tf < todayFollows; tf++) {
        logCounter++;
        logStmt.run(`demo_log_today_f_${tf}`, `demo_target_00${tf + 1}`, "Perfil seguido en LinkedIn", daysAgo(0, 1 + tf));
      }
      for (let tl = 0; tl < todayLikes; tl++) {
        logCounter++;
        logStmt.run(`demo_log_today_l_${tl}`, `demo_target_00${tl + 1}`, "Like y comentario en publicación", daysAgo(0, 1 + tl));
      }
      for (let tc = 0; tc < todayConns; tc++) {
        logCounter++;
        logStmt.run(`demo_log_today_c_${tc}`, `demo_target_00${tc + 1}`, "Solicitud de conexión enviada", daysAgo(0, 2 + tc));
      }
      for (let tm = 0; tm < todayMsgs; tm++) {
        logCounter++;
        logStmt.run(`demo_log_today_m_${tm}`, `demo_target_00${tm + 1}`, "Mensaje enviado al contacto", daysAgo(0, 2 + tm));
      }
      for (let ti = 0; ti < todayInmails; ti++) {
        logCounter++;
        logStmt.run(`demo_log_today_inmail_${ti}`, `demo_target_00${ti + 5}`, "InMail enviado al contacto", daysAgo(0, 3));
      }
      for (let te = 0; te < todayEmails; te++) {
        logCounter++;
        logStmt.run(`demo_log_today_e_${te}`, `demo_target_00${te + 1}`, "Email sent to commercial contact", daysAgo(0, 2 + te));
      }
    })();

    console.log(`[Demo Seed] ✅ Cuenta demo sembrada exitosamente (6 meses): ${DEMO_EMAIL}`);
    return { ok: true, email: DEMO_EMAIL, password: DEMO_PASS };
  } finally {
    if (prevFk) {
      db.pragma("foreign_keys = ON");
    }
  }
}
