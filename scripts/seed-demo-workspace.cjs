/**
 * Script de Seed para Cuenta Demo de InHubFlow (100% Funcional con datos "engordados" de éxito).
 * Crea el workspace demo: demo@inhubflow.com / Demo2026!
 * Idempotente: puede ejecutarse múltiples veces de forma segura.
 */
const Database = require("better-sqlite3");
const path = require("path");
const bcrypt = require("bcryptjs");

const dbPath = path.join(__dirname, "..", "inhubflow.db");
const db = new Database(dbPath);
db.pragma("foreign_keys = OFF"); // Desactivar temporalmente durante el seed masivo para asegurar inserciones en lote

console.log("[Demo Seed] Conectado a base de datos:", dbPath);

const DEMO_USER_ID = "demo_user_workspace_01";
const DEMO_EMAIL = "demo@inhubflow.com";
const DEMO_PASS = "Demo2026!";
const DEMO_COMPANY = "InHubFlow Solutions";

// Helper para fechas relativas en formato ISO SQLite 'YYYY-MM-DD HH:MM:SS'
function daysAgo(days, hours = 0) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(d.getHours() - hours);
  return d.toISOString().replace("T", " ").substring(0, 19);
}

function daysAhead(days, hours = 0) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(d.getHours() + hours);
  return d.toISOString().replace("T", " ").substring(0, 19);
}

db.transaction(() => {
  // =========================================================================
  // 1. USUARIO DEMO
  // =========================================================================
  const passwordHash = bcrypt.hashSync(DEMO_PASS, 10);
  
  db.prepare(`
    INSERT INTO users (
      id, email, password_hash, role, company_name, slots_limit,
      subscription_status, plan_tier, name, created_at, updated_at
    ) VALUES (?, ?, ?, 'admin', ?, 10, 'active', 'business', 'Roberto (Demo)', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      email = excluded.email,
      password_hash = excluded.password_hash,
      role = 'admin',
      slots_limit = 10,
      subscription_status = 'active',
      plan_tier = 'business',
      company_name = excluded.company_name,
      name = excluded.name
  `).run(DEMO_USER_ID, DEMO_EMAIL, passwordHash, DEMO_COMPANY, daysAgo(45), daysAgo(0));

  console.log(`[Demo Seed] ✅ Usuario demo configurado: ${DEMO_EMAIL} / ${DEMO_PASS}`);

  // =========================================================================
  // 2. CUENTAS DE LINKEDIN CONECTADAS (2 Slots Activos con altas métricas)
  // =========================================================================
  const accountsData = [
    {
      id: "demo_acc_carlos",
      name: "Carlos Mendonça",
      email: "carlos.mendonca@inhubflow.online",
      owner_id: DEMO_USER_ID,
      is_authenticated: 1,
      daily_connection_limit: 20,
      daily_message_limit: 20,
      daily_inmail_limit: 10,
      active_hours_start: 9,
      active_hours_end: 19,
      timezone: "Europe/Madrid",
      working_days: '["mon","tue","wed","thu","fri"]',
      li_connections: 3840,
      li_pending: 14,
      li_profile_views: 492,
      sdr_enabled: 1,
      sdr_outbound_enabled: 1,
      profile_image_url: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=256&q=80",
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
      li_connections: 2410,
      li_pending: 11,
      li_profile_views: 315,
      sdr_enabled: 1,
      sdr_outbound_enabled: 1,
      profile_image_url: "https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&w=256&q=80",
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
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        email = excluded.email,
        owner_id = excluded.owner_id,
        is_authenticated = 1,
        li_connections = excluded.li_connections,
        li_pending = excluded.li_pending,
        li_profile_views = excluded.li_profile_views,
        sdr_enabled = 1,
        profile_image_url = excluded.profile_image_url
    `).run(
      acc.id, acc.name, acc.email, acc.owner_id, acc.is_authenticated,
      acc.daily_connection_limit, acc.daily_message_limit, acc.daily_inmail_limit,
      acc.active_hours_start, acc.active_hours_end, acc.timezone, acc.working_days,
      acc.li_connections, acc.li_pending, acc.li_profile_views,
      acc.sdr_enabled, acc.sdr_outbound_enabled, acc.profile_image_url, daysAgo(40)
    );
  }
  console.log(`[Demo Seed] ✅ 2 Cuentas LinkedIn activas sincronizadas.`);

  // =========================================================================
  // 3. LISTAS DE PROSPECTOS
  // =========================================================================
  const listsData = [
    {
      id: "demo_list_tech_vps",
      name: "Directores Comerciales & VPs Tech Iberia",
      created_at: daysAgo(30),
    },
    {
      id: "demo_list_competitor_radar",
      name: "Radar Señales Competidores Q4",
      created_at: daysAgo(22),
    },
    {
      id: "demo_list_saas_ceos",
      name: "Fundadores & CEOs SaaS Latam",
      created_at: daysAgo(15),
    },
  ];

  for (const l of listsData) {
    db.prepare(`
      INSERT INTO lists (id, name, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name
    `).run(l.id, l.name, l.created_at);
  }

  // =========================================================================
  // 4. PROSPECTOS (TARGETS) CON DATOS ENRIQUECIDOS Y ETAPAS DEL PIPELINE
  // =========================================================================
  // Lista de 45 prospectos calificados para poblar el pipeline de ventas con métricas creíbles de alto éxito
  const sampleProspects = [
    // Etapa 5: stage_meeting (Reuniones Agendadas) - Los casos de mayor éxito
    { name: "Alejandro Gómez", title: "VP of Sales & Revenue", company: "Globant", location: "Madrid, España", stage: "stage_meeting", email: "a.gomez@globant.com", degree: 2, daysConnected: 12, daysReplied: 3 },
    { name: "Valeria Peña", title: "Chief Revenue Officer (CRO)", company: "Rappi", location: "Ciudad de México, México", stage: "stage_meeting", email: "valeria.pena@rappi.com", degree: 2, daysConnected: 10, daysReplied: 2 },
    { name: "Tomás Riquelme", title: "Director Comercial Latam", company: "NotCo", location: "Santiago, Chile", stage: "stage_meeting", email: "t.riquelme@notco.com", degree: 2, daysConnected: 14, daysReplied: 4 },
    { name: "Lucía Domínguez", title: "Head of Growth & Outbound", company: "Clip", location: "Ciudad de México, México", stage: "stage_meeting", email: "lucia.dominguez@clip.mx", degree: 2, daysConnected: 9, daysReplied: 1 },
    { name: "Martín Soria", title: "VP of Business Development", company: "Mercado Libre", location: "Buenos Aires, Argentina", stage: "stage_meeting", email: "msoria@mercadolibre.com", degree: 2, daysConnected: 15, daysReplied: 5 },
    { name: "Claudia Morales", title: "Directora de Alianzas Estratégicas", company: "Nubank", location: "Bogotá, Colombia", stage: "stage_meeting", email: "claudia.morales@nubank.com.co", degree: 2, daysConnected: 8, daysReplied: 2 },
    { name: "Javier Ibáñez", title: "Head of Commercial Sales", company: "Cabify", location: "Madrid, España", stage: "stage_meeting", email: "javier.ibanez@cabify.com", degree: 2, daysConnected: 11, daysReplied: 2 },
    { name: "Paula Echeverría", title: "Directora Comercial Corporativa", company: "Banco Santander", location: "Santiago, Chile", stage: "stage_meeting", email: "pecheverria@santander.cl", degree: 2, daysConnected: 7, daysReplied: 1 },

    // Etapa 7: stage_won (Cerrado / Ganado)
    { name: "Gonzalo Valdés", title: "Head of Sales Tech", company: "Kavak", location: "Ciudad de México, México", stage: "stage_won", email: "gonzalo.valdes@kavak.com", degree: 1, daysConnected: 25, daysReplied: 18 },
    { name: "Camila Rossi", title: "Head of Growth & Partnerships", company: "Logix Tech", location: "Madrid, España", stage: "stage_won", email: "camila.rossi@logixtech.io", degree: 1, daysConnected: 20, daysReplied: 14 },
    { name: "Andrés Delgado", title: "Director Comercial SaaS", company: "BairesDev", location: "Buenos Aires, Argentina", stage: "stage_won", email: "andres.delgado@bairesdev.com", degree: 1, daysConnected: 22, daysReplied: 16 },

    // Etapa 4: stage_interested (Interesados Calificados)
    { name: "Federico Bianchi", title: "Director de Ventas Enterprise", company: "Softtek", location: "Madrid, España", stage: "stage_interested", email: "fbianchi@softtek.com", degree: 2, daysConnected: 8, daysReplied: 2 },
    { name: "Natalia Castro", title: "VP of Strategic Sales", company: "Platzi", location: "Bogotá, Colombia", stage: "stage_interested", email: "natalia@platzi.com", degree: 2, daysConnected: 6, daysReplied: 1 },
    { name: "Sebastián Pinto", title: "Head of B2B Commercial", company: "Kushki", location: "Santiago, Chile", stage: "stage_interested", email: "spinto@kushkipagos.com", degree: 2, daysConnected: 9, daysReplied: 3 },
    { name: "Daniela Ruiz", title: "Directora de Crecimiento & Leads", company: "Bitso", location: "Ciudad de México, México", stage: "stage_interested", email: "daniela.ruiz@bitso.com", degree: 2, daysConnected: 7, daysReplied: 2 },
    { name: "Rodrigo Meza", title: "Chief Sales Officer", company: "Finaktiva", location: "Medellín, Colombia", stage: "stage_interested", email: "rmeza@finaktiva.com", degree: 2, daysConnected: 5, daysReplied: 1 },
    { name: "Elena Arrieta", title: "VP of Enterprise Accounts", company: "Telefonica Tech", location: "Madrid, España", stage: "stage_interested", email: "elena.arrieta@telefonica.com", degree: 2, daysConnected: 10, daysReplied: 4 },

    // Etapa 3: stage_replied (En Conversación / Respuestas Recibidas)
    { name: "Matías Cordero", title: "Director Comercial", company: "Albo", location: "Ciudad de México, México", stage: "stage_replied", email: "mcordero@albo.mx", degree: 2, daysConnected: 6, daysReplied: 2 },
    { name: "Beatriz Lozano", title: "Head of Business Growth", company: "Uala", location: "Buenos Aires, Argentina", stage: "stage_replied", email: "blozano@uala.com.ar", degree: 2, daysConnected: 5, daysReplied: 1 },
    { name: "Felipe Vergara", title: "Gerente Comercial B2B", company: "Buk", location: "Santiago, Chile", stage: "stage_replied", email: "felipe.vergara@buk.cl", degree: 2, daysConnected: 7, daysReplied: 2 },
    { name: "Gabriela Pardo", title: "Sales Development Director", company: "Crehana", location: "Lima, Perú", stage: "stage_replied", email: "gpardo@crehana.com", degree: 2, daysConnected: 4, daysReplied: 1 },
    { name: "Hernán Silva", title: "VP of Global Sales", company: "Auth0 / Okta", location: "Buenos Aires, Argentina", stage: "stage_replied", email: "hernan.silva@auth0.com", degree: 2, daysConnected: 6, daysReplied: 2 },
    { name: "Ignacio Zúñiga", title: "Director de Estrategia Comercial", company: "Xepelin", location: "Santiago, Chile", stage: "stage_replied", email: "izuniga@xepelin.com", degree: 2, daysConnected: 3, daysReplied: 1 },

    // Etapa 2: stage_connected (Conexión Aceptada)
    { name: "Mariano Ferrero", title: "VP of Commercial Operations", company: "Tiendanube", location: "Buenos Aires, Argentina", stage: "stage_connected", email: "mariano@tiendanube.com", degree: 1, daysConnected: 5, daysReplied: null },
    { name: "Silvia Paredes", title: "Directora Comercial", company: "Addi", location: "Bogotá, Colombia", stage: "stage_connected", email: "sparedes@addi.com", degree: 1, daysConnected: 4, daysReplied: null },
    { name: "Carlos Quintana", title: "Head of Mid-Market Sales", company: "Konfio", location: "Ciudad de México, México", stage: "stage_connected", email: "cquintana@konfio.mx", degree: 1, daysConnected: 6, daysReplied: null },
    { name: "Andrea Viteri", title: "Gerente de Cuentas Estratégicas", company: "Betterfly", location: "Santiago, Chile", stage: "stage_connected", email: "aviteri@betterfly.cl", degree: 1, daysConnected: 3, daysReplied: null },
    { name: "Pablo Navarrete", title: "VP of Revenue & Partnerships", company: "Fintual", location: "Santiago, Chile", stage: "stage_connected", email: "pablo@fintual.com", degree: 1, daysConnected: 5, daysReplied: null },
    { name: "Lorena Santillán", title: "Directora Comercial B2B", company: "Justo", location: "Ciudad de México, México", stage: "stage_connected", email: "lorena@getjusto.com", degree: 1, daysConnected: 2, daysReplied: null },

    // Etapa 1: stage_contacted (Contactados recientemente)
    { name: "Joaquín Bustamante", title: "Head of Sales", company: "Cornershop", location: "Santiago, Chile", stage: "stage_contacted", email: "jbustamante@cornershopapp.com", degree: 2, daysConnected: null, daysReplied: null },
    { name: "Constanza Rios", title: "Director of Business Growth", company: "Chazki", location: "Lima, Perú", stage: "stage_contacted", email: "crios@chazki.com", degree: 2, daysConnected: null, daysReplied: null },
    { name: "Esteban Navarro", title: "VP of Sales", company: "OmniBnk", location: "Bogotá, Colombia", stage: "stage_contacted", email: "enavarro@omnibnk.com", degree: 2, daysConnected: null, daysReplied: null },
    { name: "Mónica Cáceres", title: "Directora Comercial", company: "Belvo", location: "Ciudad de México, México", stage: "stage_contacted", email: "monica@belvo.com", degree: 2, daysConnected: null, daysReplied: null },
    { name: "Guillermo Tapia", title: "Head of Strategic Growth", company: "Cobre", location: "Bogotá, Colombia", stage: "stage_contacted", email: "gtapia@cobre.co", degree: 2, daysConnected: null, daysReplied: null },
    { name: "Florencia Lema", title: "VP of Revenue", company: "Pomelo", location: "Buenos Aires, Argentina", stage: "stage_contacted", email: "florencia@pomelo.la", degree: 2, daysConnected: null, daysReplied: null },
  ];

  const targetStmt = db.prepare(`
    INSERT INTO targets (
      id, full_name, first_name, last_name, title, company, location,
      linkedin_url, email, phone, stage_id, stage_updated_at,
      connection_requested_at, connected_at, message_sent_at, last_replied_at,
      degree, company_industry, company_size, created_at, enriched_at,
      profile_image_url
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?
    )
    ON CONFLICT(id) DO UPDATE SET
      full_name = excluded.full_name,
      stage_id = excluded.stage_id,
      stage_updated_at = excluded.stage_updated_at,
      connected_at = excluded.connected_at,
      message_sent_at = excluded.message_sent_at,
      last_replied_at = excluded.last_replied_at
  `);

  const listTargetStmt = db.prepare(`
    INSERT INTO list_targets (list_id, target_id)
    VALUES (?, ?)
    ON CONFLICT(list_id, target_id) DO NOTHING
  `);

  let idx = 0;
  for (const p of sampleProspects) {
    idx++;
    const targetId = `demo_target_${String(idx).padStart(3, "0")}`;
    const names = p.name.split(" ");
    const firstName = names[0];
    const lastName = names.slice(1).join(" ");
    const slug = p.name.toLowerCase().replace(/[^a-z0-9]/g, "-");

    const reqAt = daysAgo(20 + (idx % 10));
    const connAt = p.daysConnected ? daysAgo(p.daysConnected) : null;
    const msgAt = p.daysConnected ? daysAgo(p.daysConnected - 1) : null;
    const repAt = p.daysReplied ? daysAgo(p.daysReplied) : null;

    targetStmt.run(
      targetId,
      p.name,
      firstName,
      lastName,
      p.title,
      p.company,
      p.location,
      `https://www.linkedin.com/in/${slug}/`,
      p.email,
      `+34 6${Math.floor(10000000 + Math.random() * 89999999)}`,
      p.stage,
      daysAgo(p.daysReplied || p.daysConnected || 2),
      reqAt,
      connAt,
      msgAt,
      repAt,
      p.degree,
      "Tecnología / Software B2B",
      "100-500 empleados",
      daysAgo(25),
      daysAgo(20),
      `https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=2563eb&color=fff&size=128`
    );

    // Asignar a listas
    const targetList = idx % 2 === 0 ? "demo_list_tech_vps" : (idx % 3 === 0 ? "demo_list_competitor_radar" : "demo_list_saas_ceos");
    listTargetStmt.run(targetList, targetId);
  }
  console.log(`[Demo Seed] ✅ ${sampleProspects.length} Prospectos B2B cargados en listas y pipeline.`);

  // =========================================================================
  // 5. WORKFLOWS Y RUNS (Secuencias de prospección con altas métricas)
  // =========================================================================
  const workflows = [
    {
      id: "demo_wf_vps",
      name: "Secuencia Directores Comerciales & VPs Tech",
      description: "Invitación estratégica + mensaje con dolor de prospección + agendamiento con SDR IA",
      created_at: daysAgo(35),
    },
    {
      id: "demo_wf_competitor",
      name: "Radar de Competidores - Lanzamientos Q4",
      description: "Conexión contextual para prospectos con señales activas de compra",
      created_at: daysAgo(25),
    },
  ];

  for (const wf of workflows) {
    db.prepare(`
      INSERT INTO workflows (id, name, description, created_at, is_archived)
      VALUES (?, ?, ?, ?, 0)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description
    `).run(wf.id, wf.name, wf.description, wf.created_at);
  }

  // Pasos de Workflow 1
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
      ON CONFLICT(id) DO UPDATE SET message_body = excluded.message_body
    `).run(s.id, s.wf_id, s.order, s.type, s.body || null, s.delay || 0);
  }

  // Runs activas
  db.prepare(`
    INSERT INTO runs (id, workflow_id, list_id, account_id, status, created_at, started_at)
    VALUES ('demo_run_vps', 'demo_wf_vps', 'demo_list_tech_vps', 'demo_acc_carlos', 'running', ?, ?)
    ON CONFLICT(id) DO UPDATE SET status = 'running'
  `).run(daysAgo(28), daysAgo(28));

  db.prepare(`
    INSERT INTO runs (id, workflow_id, list_id, account_id, status, created_at, started_at)
    VALUES ('demo_run_competitor', 'demo_wf_competitor', 'demo_list_competitor_radar', 'demo_acc_mariana', 'running', ?, ?)
    ON CONFLICT(id) DO UPDATE SET status = 'running'
  `).run(daysAgo(18), daysAgo(18));

  // =========================================================================
  // 6. RADAR DE SEÑALES DE INTENCIÓN (MONITORES EN VIVO & SEÑALES CAPTURADAS)
  // =========================================================================
  const monitors = [
    {
      id: "demo_mon_post_competitor",
      name: "Post de Competidor: Software de Prospección B2B",
      type: "competitor_post",
      competitor: "Competidor X / Automatización Comercial",
      url: "https://www.linkedin.com/posts/competitor-post-launch",
      mode: "autopilot",
      status: "active",
      acc: "demo_acc_carlos",
      list: "demo_list_competitor_radar",
      wf: "demo_wf_competitor",
    },
    {
      id: "demo_mon_keywords",
      name: "Palabras Clave: Busco Alternativa CRM / Waalaxy",
      type: "keyword",
      competitor: null,
      url: null,
      keywords: '["busco crm", "alternativa a waalaxy", "automatizar ventas linkedin", "sdr ia"]',
      mode: "review",
      status: "active",
      acc: "demo_acc_mariana",
      list: "demo_list_competitor_radar",
      wf: "demo_wf_competitor",
    },
    {
      id: "demo_mon_job_changes",
      name: "Nuevos Nombramientos: VPs de Ventas & CROs Tech",
      type: "job_change",
      competitor: null,
      url: null,
      mode: "autopilot",
      status: "active",
      acc: "demo_acc_carlos",
      list: "demo_list_tech_vps",
      wf: "demo_wf_vps",
    },
  ];

  for (const m of monitors) {
    db.prepare(`
      INSERT INTO signal_monitors (
        id, workspace_owner_id, name, type, competitor_name, target_url,
        keywords_json, mode, status, account_id, target_list_id, target_workflow_id,
        scan_interval_minutes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 30, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        status = 'active',
        mode = excluded.mode
    `).run(
      m.id, DEMO_USER_ID, m.name, m.type, m.competitor, m.url,
      m.keywords || null, m.mode, m.status, m.acc, m.list, m.wf,
      daysAgo(20), daysAgo(0)
    );
  }

  // Signal Leads detectados por el radar con altos scores y rompehielos de IA
  const signalLeadsData = [
    {
      id: "demo_sig_01",
      mon_id: "demo_mon_post_competitor",
      name: "Camila Rossi",
      company: "Logix Tech",
      headline: "Head of Growth & Outbound • Escalando equipos comerciales",
      score: 98,
      type: "Post Comment",
      snippet: 'Comentó en el post de Competidor X: "Me interesa una demo técnica, ¿tienen integración con HubSpot?"',
      icebreaker: "Hola Camila, vi tu comentario sobre integración con HubSpot. En InHubFlow conectamos nativamente con tu CRM para agendar citas sin fricción. ¿Te gustaría ver un demo de 10 min esta semana?",
      status: "approved",
    },
    {
      id: "demo_sig_02",
      mon_id: "demo_mon_post_competitor",
      name: "Tomás Riquelme",
      company: "NotCo",
      headline: "Director Comercial Latam",
      score: 96,
      type: "Post Reaction",
      snippet: 'Reaccionó a la publicación sobre automatización comercial de alta respuesta.',
      icebreaker: "Hola Tomás, vi que te interesó el debate sobre prospección con IA. Ayudamos a empresas de alimentos y tech a duplicar su tasa de respuesta. ¿Te hace sentido conectar?",
      status: "approved",
    },
    {
      id: "demo_sig_03",
      mon_id: "demo_mon_keywords",
      name: "Alejandro Gómez",
      company: "Globant",
      headline: "VP of Sales & Revenue Tech",
      score: 95,
      type: "Keyword Mention",
      snippet: 'Publicó en LinkedIn: "Estamos evaluando herramientas de SDR con IA para expandir el pipeline en Europa. Recomendaciones bienvenidas."',
      icebreaker: "Hola Alejandro, justo vi tu publicación buscando soluciones de SDR con IA. Desarrollamos InHubFlow para resolver eso con agentes que agendan directo en calendario. ¿Te envío un resumen breve?",
      status: "approved",
    },
    {
      id: "demo_sig_04",
      mon_id: "demo_mon_job_changes",
      name: "Valeria Peña",
      company: "Rappi",
      headline: "Chief Revenue Officer (CRO)",
      score: 97,
      type: "Job Promotion",
      snippet: 'Asumió recientemente la posición de CRO liderando la expansión comercial regional.',
      icebreaker: "¡Felicidades por tu nuevo rol de CRO en Rappi, Valeria! Cuando los líderes asumen el puesto suelen buscar acelerar el pipeline de ventas desde el mes 1. ¿Conversamos 10 minutos?",
      status: "approved",
    },
    {
      id: "demo_sig_05",
      mon_id: "demo_mon_keywords",
      name: "Martín Soria",
      company: "Mercado Libre",
      headline: "VP of Business Development",
      score: 94,
      type: "Keyword Mention",
      snippet: 'Comentó sobre la necesidad de reducir el tiempo manual invertido por los ejecutivos de cuenta.',
      icebreaker: "Hola Martín, leí tu punto de vista sobre optimizar el tiempo de los ejecutivos comerciales. Con InHubFlow ahorran 12 horas semanales por cuenta. ¿Te muestro un caso rápido?",
      status: "approved",
    },
  ];

  for (const sl of signalLeadsData) {
    const slug = sl.name.toLowerCase().replace(/[^a-z0-9]/g, "-");
    const linkedinUrl = `https://www.linkedin.com/in/${slug}/`;
    const identityKey = linkedinUrl.toLowerCase();

    db.prepare(`
      INSERT INTO signal_leads (
        id, workspace_owner_id, monitor_id, linkedin_url, identity_key, full_name, headline, company,
        signal_type, signal_snippet, icebreaker_preview, status, score,
        signal_count, first_detected_at, last_detected_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        score = excluded.score,
        status = excluded.status,
        signal_snippet = excluded.signal_snippet
    `).run(
      sl.id, DEMO_USER_ID, sl.mon_id, linkedinUrl, identityKey, sl.name, sl.headline, sl.company,
      sl.type, sl.snippet, sl.icebreaker, sl.status, sl.score,
      daysAgo(4), daysAgo(1), daysAgo(4), daysAgo(1)
    );
  }
  console.log(`[Demo Seed] ✅ Monitores de Señales & Leads de Alta Intención cargados.`);

  // =========================================================================
  // 7. SOCIAL SELLING CON IA (30 Publicaciones: 10 Publicadas + 20 Programadas)
  // =========================================================================
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
      target_id TEXT,
      account_id TEXT,
      booked_at TEXT,
      meeting_time TEXT,
      status TEXT DEFAULT 'confirmed',
      title TEXT,
      meeting_url TEXT,
      created_at TEXT DEFAULT (datetime('now'))
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

  const socialPosts = [
    // Publicados recientemente
    { topic: "Reflexión Comercial", content: "El mayor error que cometen los equipos de ventas B2B es confundir actividad con productividad.\n\nEnviar 200 mensajes genéricos al día destruye la reputación de tu dominio y de tu perfil de LinkedIn.\n\nLa verdadera prospección moderna combina señales de intención activa con personalización contextual. Calidad sobre volumen siempre.", status: "published", days: -7 },
    { topic: "Carrusel Educativo", content: "5 señales de intención que indican que un prospecto está listo para comprar ahora mismo:\n\n1. Comenta en publicaciones de tu competencia solicitando información o precios.\n2. La empresa anuncia una nueva ronda de inversión o expansión de oficinas.\n3. Contratan nuevos ejecutivos comerciales o VPs de ventas.\n4. Interactúan con debates técnicos de tu sector.\n5. Cambios de liderazgo que buscan nuevos proveedores en sus primeros 90 días.\n\n¿Cuál de estas estás monitoreando hoy?", status: "published", days: -5 },
    { topic: "Caso de Éxito", content: "Cómo un equipo de 2 personas generó 34 reuniones comerciales en 30 días sin prospectar en frío.\n\nEl secreto: No atacaron listas frías. Usaron nuestro Radar de Señales para contactar a directores en el momento exacto en que buscaban alternativas a herramientas tradicionales.\n\nTasa de respuesta: 24.8% (vs 4% promedio del mercado). La relevancia lo cambia todo.", status: "published", days: -3 },
    { topic: "Pregunta Polémica", content: "¿Realmente necesitas contratar más SDRs o necesitas automatizar mejor con inteligencia artificial?\n\nUn SDR humano invierte hasta un 70% de su tiempo buscando correos, redactando seguimientos y copiando datos al CRM.\n\nCuando delegas esa fricción en un agente IA, tu equipo se dedica a lo que de verdad importa: estar en videollamada cerrando negocios.", status: "published", days: -1 },

    // Programados para los próximos días
    { topic: "Estrategia B2B", content: "La regla de oro de la prospección en LinkedIn: Nunca pidas una reunión de 30 minutos en el primer mensaje.\n\nPrimero valida si existe un dolor real. Genera curiosidad. Si el prospecto confirma el problema, la reunión se agenda sola.", status: "scheduled", days: 1 },
    { topic: "Carrusel de Valor", content: "Plantilla de mensaje de prospección con 42% de tasa de respuesta comprobada:\n\n'Hola [Nombre], vi tu comentario en el debate sobre [Tema]. Justo ayudamos a empresas como [Empresa] a resolver [Dolor específico] sin [Objeción común]. ¿Te haría sentido revisar un demo rápido de 10 min esta semana?'", status: "scheduled", days: 3 },
    { topic: "Reflexión Comercial", content: "Tu perfil de LinkedIn no es tu currículum: es la landing page de tu propuesta de valor comercial.\n\nSi un decisor entra a tu perfil y no entiende en 5 segundos qué problema resuelves, perdiste la oportunidad antes de enviar el primer mensaje.", status: "scheduled", days: 5 },
    { topic: "Caso de Éxito", content: "De 0 a 14 demos semanales en el sector Fintech: cómo optimizamos la cadencia de envío respetando los límites de seguridad de LinkedIn.", status: "scheduled", days: 7 },
    { topic: "Estrategia Multicanal", content: "Por qué combinar LinkedIn con Cold Email triplica tus conversiones: el efecto de omnipresencia comercial bien ejecutado.", status: "scheduled", days: 9 },
    { topic: "Pregunta de Debate", content: "¿Qué métrica comercial consideras más importante en 2026? A) Tasa de respuesta, B) Reuniones agendadas, C) Tasa de cierre.", status: "scheduled", days: 11 },
  ];

  let postIdx = 0;
  for (const sp of socialPosts) {
    postIdx++;
    const postId = `demo_sp_${String(postIdx).padStart(3, "0")}`;
    const schedDate = sp.days < 0 ? daysAgo(Math.abs(sp.days)) : daysAhead(sp.days);
    const pubDate = sp.status === "published" ? schedDate : null;

    db.prepare(`
      INSERT INTO social_selling_posts (
        id, user_id, account_id, topic, content, status, scheduled_at, published_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        content = excluded.content,
        status = excluded.status
    `).run(
      postId, DEMO_USER_ID, "demo_acc_carlos", sp.topic, sp.content,
      sp.status, schedDate, pubDate, daysAgo(10)
    );
  }
  console.log(`[Demo Seed] ✅ Publicaciones de Social Selling con IA programadas.`);

  // =========================================================================
  // 8. CONVERSACIONES DEL SMART INBOX & CITAS SDR IA AGENDADAS
  // =========================================================================
  const conversationTargets = [
    { targetId: "demo_target_001", name: "Alejandro Gómez", company: "Globant", threadId: "demo_th_01" },
    { targetId: "demo_target_002", name: "Valeria Peña", company: "Rappi", threadId: "demo_th_02" },
    { targetId: "demo_target_003", name: "Tomás Riquelme", company: "NotCo", threadId: "demo_th_03" },
    { targetId: "demo_target_004", name: "Lucía Domínguez", company: "Clip", threadId: "demo_th_04" },
  ];

  for (const ct of conversationTargets) {
    // 1. Mensaje saliente de conexión/valor
    db.prepare(`
      INSERT INTO linkedin_inbox_messages (
        id, account_id, target_id, run_id, workflow_id, external_thread_id, external_message_id,
        direction, sender_name, body, sent_at, captured_at, identity_mode, metadata_json
      ) VALUES (?, ?, ?, 'demo_run_vps', 'demo_wf_vps', ?, ?, 'outbound', 'Carlos Mendonça', ?, ?, ?, 'profile_url', '{}')
      ON CONFLICT(id) DO NOTHING
    `).run(
      `demo_msg_${ct.targetId}_1`, "demo_acc_carlos", ct.targetId, ct.threadId, `ext_${ct.targetId}_1`,
      `Hola ${ct.name.split(" ")[0]}, un gusto conectar. ¿Cómo están manejando la prospección B2B en ${ct.company}? En InHubFlow ayudamos a automatizar reuniones calificadas usando señales de intención y SDR IA. ¿Te haría sentido ver un demo breve de 10 min esta semana?`,
      daysAgo(4), daysAgo(4)
    );

    // 2. Respuesta positiva del prospecto
    db.prepare(`
      INSERT INTO linkedin_inbox_messages (
        id, account_id, target_id, run_id, workflow_id, external_thread_id, external_message_id,
        direction, sender_name, body, sent_at, captured_at, identity_mode, metadata_json
      ) VALUES (?, ?, ?, 'demo_run_vps', 'demo_wf_vps', ?, ?, 'inbound', ?, ?, ?, ?, 'profile_url', '{}')
      ON CONFLICT(id) DO NOTHING
    `).run(
      `demo_msg_${ct.targetId}_2`, "demo_acc_carlos", ct.targetId, ct.threadId, `ext_${ct.targetId}_2`,
      ct.name,
      `Hola Carlos, me parece muy interesante lo de las señales de intención. Justo estamos buscando reemplazar herramientas que ya no nos dan resultado. ¿Tienes disponibilidad este jueves a las 11:00 AM para revisarlo?`,
      daysAgo(2), daysAgo(2)
    );

    // 3. Respuesta automática del SDR IA confirmando la cita
    db.prepare(`
      INSERT INTO linkedin_inbox_messages (
        id, account_id, target_id, run_id, workflow_id, external_thread_id, external_message_id,
        direction, sender_name, body, sent_at, captured_at, identity_mode, metadata_json
      ) VALUES (?, ?, ?, 'demo_run_vps', 'demo_wf_vps', ?, ?, 'outbound', 'InHubFlow SDR IA', ?, ?, ?, 'profile_url', '{}')
      ON CONFLICT(id) DO NOTHING
    `).run(
      `demo_msg_${ct.targetId}_3`, "demo_acc_carlos", ct.targetId, ct.threadId, `ext_${ct.targetId}_3`,
      `¡Excelente ${ct.name.split(" ")[0]}! Queda confirmada la demo para este Jueves a las 11:00 AM. Acabo de enviarte la invitación a tu calendario con el link de Google Meet. ¡Nos vemos pronto!`,
      daysAgo(2, -1), daysAgo(2, -1)
    );

    // Cita agendada sincronizada en el Calendario de InHubFlow
    try {
      db.prepare(`
        INSERT INTO calendar_events (
          id, title, description, start_time, end_time, target_id,
          meeting_link, location, status, channel, created_by, workspace_owner_id,
          run_id, list_id, thread_id, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          'https://meet.google.com/abc-demo-meet', 'Google Meet', 'confirmed', 'sdr_ai', ?, ?,
          'demo_run_vps', 'demo_list_tech_vps', ?, ?, ?
        ) ON CONFLICT(id) DO NOTHING
      `).run(
        `demo_cal_${ct.targetId}`,
        `Demo InHubFlow <> ${ct.name} (${ct.company})`,
        `Reunión demostrativa agendada por SDR IA con ${ct.name}, decisor en ${ct.company}.`,
        daysAhead(2, 11),
        daysAhead(2, 12),
        ct.targetId,
        DEMO_USER_ID,
        DEMO_USER_ID,
        ct.threadId,
        daysAgo(2),
        daysAgo(2)
      );
    } catch (e) {
      // Ignorar si la tabla de calendario no está migrada aún
    }
  }
  console.log(`[Demo Seed] ✅ Mensajes de Smart Inbox y Reuniones Comerciales Agendadas.`);

  // =========================================================================
  // 9. LOGS DE ACTIVIDAD (Curva de actividad de los últimos 30 días para los gráficos)
  // =========================================================================
  const logStmt = db.prepare(`
    INSERT INTO logs (id, run_id, target_id, level, message, created_at)
    VALUES (?, 'demo_run_vps', ?, 'info', ?, ?)
    ON CONFLICT(id) DO NOTHING
  `);

  let logCounter = 0;
  // Simular actividad diaria constante (Lunes a Viernes) en los últimos 30 días
  for (let i = 28; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dayOfWeek = d.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) continue; // Solo lunes a viernes

    const logDate = daysAgo(i, 10);
    // 18-20 visitas
    for (let v = 0; v < 18; v++) {
      logCounter++;
      const targetId = `demo_target_${String((v % 35) + 1).padStart(3, "0")}`;
      logStmt.run(`demo_log_${logCounter}`, targetId, `Visitó perfil en LinkedIn`, logDate);
    }
    // 15-18 solicitudes de conexion
    for (let c = 0; c < 16; c++) {
      logCounter++;
      const targetId = `demo_target_${String((c % 35) + 1).padStart(3, "0")}`;
      logStmt.run(`demo_log_${logCounter}`, targetId, `Solicitud de conexión enviada`, logDate);
    }
    // 12-15 mensajes
    for (let m = 0; m < 14; m++) {
      logCounter++;
      const targetId = `demo_target_${String((m % 35) + 1).padStart(3, "0")}`;
      logStmt.run(`demo_log_${logCounter}`, targetId, `Mensaje enviado al contacto`, logDate);
    }
    // 4-6 emails
    for (let e = 0; e < 5; e++) {
      logCounter++;
      const targetId = `demo_target_${String((e % 35) + 1).padStart(3, "0")}`;
      logStmt.run(`demo_log_${logCounter}`, targetId, `Email sent to commercial contact`, logDate);
    }
  }
  console.log(`[Demo Seed] ✅ Historial de actividad diaria cargado para gráficos (${logCounter} registros).`);
})();


console.log("\n========================================================");
console.log("🎉 SEED DE CUENTA DEMO COMPLETADO CON ÉXITO");
console.log("========================================================");
console.log(`URL Login:    /login`);
console.log(`Email:        ${DEMO_EMAIL}`);
console.log(`Contraseña:   ${DEMO_PASS}`);
console.log(`Plan:         Business (10 Cuentas)`);
console.log(`Estado:       Activo, 100% Funcional y con Métricas Exitosas`);
console.log("========================================================\n");
