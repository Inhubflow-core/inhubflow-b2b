# Auditoría Técnica — Asistente SDR IA

**Fecha:** 2026-09-18
**Repositorio:** `linki-main` @ rama `main`
**Commit revisado:** `c0aaaf3`
**Estado del working tree:** `M pages/signals/index.tsx` (cambio previo, no incluido en el análisis)
**Alcance:** `lib/sdr-agent/**`, `pages/sdr.tsx`, `pages/api/sdr/**`, y su integración con Inbox, email (IMAP), LinkedIn (Unipile), campañas (`lib/campaigns`, `lib/linkedin/runner`), Signal Radar (`lib/signals/**`, paso 3 del wizard) y calendario nativo.

> Documento de trabajo para el programador. No se ha modificado código: todos los hallazgos están sin corregir a la fecha de esta auditoría.

---

## 1. Resumen ejecutivo

El módulo está **implementado, compila y es seguro por diseño (fail-closed)**, pero **no está operativo**. En la base de datos actual el agente está apagado y **nunca ha procesado un mensaje real** (cero threads, cero decisiones, cero acciones).

Faltan **6 correcciones bloqueantes** y una fase de habilitación controlada antes de que pueda operar en una cuenta real. Los puntos de conexión con campañas, listas y el paso 3 **sí existen y están cableados**; lo que falta es el cierre del circuito de vuelta (respuesta → SDR → campaña).

**Riesgo principal si se habilita hoy sin corregir:** el envío por email falla *después* de entregar el correo (B6), la aprobación puede duplicar envíos (B7), y no existe límite efectivo de turnos de IA (B5).

---

## 2. Verificación ejecutada (resultados reales)

```text
npm run test:sdr-foundation      PASS
npm run test:sdr-runtime         PASS
npm run test:sdr-authorization   PASS
npx tsc --noEmit --incremental false   PASS (sin errores)
npm run build                    PASS (exit code 0)
```

### Estado real en `linki.db`

```text
sdr_agents              1 agente · mode="off" · runtime_enabled=0 · provider_enabled=0 · outbound_enabled=0
sdr_agent_versions      1 versión · publication_state="published" · modelo gemini-3.6-flash
sdr_knowledge_sources   1 fuente aprobada ("Catálogo de Servicios InHubFlow")
sdr_threads             0 filas
sdr_messages            0 filas
sdr_jobs                0 filas
sdr_decisions           0 filas
sdr_actions             0 filas
sdr_handoffs            0 filas
sdr_promotion_gates     0 filas
sdr_outbox              0 filas
sdr_agent_accounts      0 filas
accounts.sdr_enabled    0
targets sdr_autopilot=1 0
```

---

## 3. Componentes verificados en funcionamiento

| Componente | Estado | Referencia |
|---|---|---|
| Esquema aditivo e idempotente (28 tablas) | ✅ | `lib/sdr-agent/schema.ts`, `schema-v2.ts`; aplicado en `lib/db.ts:1001` |
| Captura inbound LinkedIn (Unipile) | ✅ Cableada | `lib/unipile/inbox-sync.ts:161` |
| Captura inbound LinkedIn (candidato Voyager) | ✅ Cableada | `lib/linkedin/inbox-sync.ts:423` |
| Captura inbound Email (IMAP) | ✅ Cableada | `lib/email/inbox.ts:163` |
| Cola durable: lease, reintentos, backoff, dead-letter | ✅ | `lib/sdr-agent/jobs.ts` |
| Worker con arranque automático | ✅ | `lib/sdr-agent/worker.ts:109`, `instrumentation.ts:11` |
| Provider Gemini: structured output + Zod + cadena de fallback | ✅ | `lib/sdr-agent/providers/gemini.ts` |
| Guardrails deterministas pre-provider | ✅ | `lib/sdr-agent/guardrails/pre-provider.ts` |
| Guardrails post-provider (grounding, citas, claims) | ✅ | `lib/sdr-agent/guardrails/post-provider.ts` |
| Recuperación de conocimiento aprobado con aislamiento | ✅ | `lib/sdr-agent/knowledge/retrieval.ts` |
| Handoff durable + bloqueo por `control_epoch` | ✅ | `lib/sdr-agent/handoff.ts` |
| Takeover / Release humanos con autorización | ✅ | `pages/api/sdr/threads/[threadId]/{takeover,release}.ts` |
| Notificaciones in-app + deep link + beep | ✅ | `lib/notifications/*`, `components/notifications/NotificationProvider.tsx` |
| Presupuesto diario, circuit breaker, ledger de coste | ✅ | `lib/sdr-agent/usage.ts` |
| Aprobación / rechazo de borradores desde el Inbox | ✅ | `pages/api/sdr/actions/[id]/{approve,reject}.ts`, UI en `pages/inbox.tsx:921` |
| Dispatcher de envío (LinkedIn vía Unipile, Email vía SMTP) | ✅ Existe | `lib/sdr-agent/dispatcher.ts` |
| Auto-avance de pipeline CRM por intención | ✅ | `lib/sdr-agent/orchestrator.ts:300-314` → `autoAdvanceTargetByTrigger` |
| Paso 3 del wizard persiste `message_config_json` | ✅ | `pages/signals/index.tsx:1116`, `1170` |
| Generación de mensaje por lead con Gemini + anti-stalker | ✅ | `lib/signals/message-generator.ts` |
| Promoción de leads a lista + enrolamiento en campaña | ✅ | `lib/signals/promotion.ts`, `lib/campaigns/enrollment.ts` |
| Autorización en rutas de lectura/mutación del Inbox | ✅ | `lib/authz.ts`, `pages/api/inbox/*` |

---

## 4. Hallazgos

### 4.1 Bloqueantes (🔴)

#### B1 — El agente está apagado en la BD mientras el `.env.local` lo habilita

`.env.local` declara:

```text
SDR_RUNTIME_ENABLED=true
SDR_PROVIDER_ENABLED=true
SDR_AGENT_MODE=approval
SDR_OUTBOUND_ENABLED=true
SDR_LINKEDIN_OUTBOUND_ENABLED=true
SDR_EMAIL_OUTBOUND_ENABLED=true
```

Pero el agente en BD tiene `mode="off"`, `runtime_enabled=0`, `provider_enabled=0`, `outbound_enabled=0`.

`resolveSdrOperationalStatus` (`lib/sdr-agent/runtime.ts:122-127`) aplica un `hardOff` y devuelve `effectiveMode="off"`; el worker cancela todo job entrante vía `evaluatePreProviderGuardrails` → `outcome: "block"`. **Procesamiento nulo.**

Agrava el problema: **ninguna pantalla permite cambiar esos flags**. `pages/api/sdr/config.ts` no expone `runtime_enabled`, `provider_enabled` ni `outbound_enabled`. Hay una divergencia env↔BD que el runbook prohíbe explícitamente.

**Acción:** unificar env y BD (decidir cuál es la fuente de verdad), y exponer los flags operativos en `/api/sdr/config` + UI.

---

#### B2 — El modo `auto` es inalcanzable: los promotion gates nunca se escriben

`lib/sdr-agent/runtime.ts:130-140` exige 4 gates para permitir `auto`:

```text
shadow_evaluated
approval_canary_passed
takeover_race_passed
kill_switch_drill_passed
```

`sdr_promotion_gates` tiene **0 filas** y **no existe ningún `INSERT` en esa tabla en todo el repositorio** — solo el `SELECT` de `runtime.ts:34`. Efecto: aunque el modo fuera `auto`, se degrada silenciosamente a `approval` (línea 139).

**Acción:** crear UI/API para cargar y verificar gates con evidencia (`evidence_json`, `verified_by_user_id`, `verified_at`).

---

#### B3 — No existe dispatcher autónomo del outbox

`sdr_outbox` está creada (`lib/sdr-agent/schema-v2.ts:205-228`) pero **nunca se inserta ni se lee**. Su única aparición fuera del esquema es un `DELETE` al borrar una cuenta (`pages/api/accounts/[id]/index.ts:74`).

No hay job `send_reply` ni loop que drene el outbox. El único envío posible es el clic humano en "Aprobar". Sin esto no hay modo `auto` real, ni reconciliación, ni reintentos de entrega.

**Acción:** implementar job `send_reply` + loop con lease que drene `sdr_outbox` con reintentos y reconciliación (`reconciliation_required`).

---

#### B4 — `evaluatePreSendGuardrails` existe pero nunca se invoca

`lib/sdr-agent/guardrails/pre-send.ts` es **código muerto**: cero llamadores en todo el repo.

Consecuencia: el dispatcher de aprobación **no valida** canal (`SDR_LINKEDIN_OUTBOUND_ENABLED`), cuota, circuit breaker, cooldown, ni "existe un inbound más reciente". Es decir, **con `SDR_LINKEDIN_OUTBOUND_ENABLED=false` se puede enviar igual** aprobando desde el Inbox.

**Acción:** invocar `evaluatePreSendGuardrails` en `dispatchApprovedSdrAction` y escribir en `sdr_outbox` antes del envío.

---

#### B5 — `ai_turn_count` nunca se incrementa: `max_auto_turns` es inoperante

El campo solo se **lee** (`lib/sdr-agent/orchestrator.ts:116`). No hay escritura en `finishDecision`, ni en `dispatcher.ts`, ni en `repository.ts`. Siempre vale `0`, de modo que el límite de turnos consecutivos de IA nunca frena al agente.

**Acción:** incrementar al enviar una respuesta de IA; resetear en takeover/release humano.

---

#### B6 — Envío por Email del dispatcher está roto (2 defectos en la misma sentencia)

`lib/sdr-agent/dispatcher.ts:280-291` inserta en `sdr_messages`:

1. Usa la columna **`sender_type`, que no existe**. Columnas reales de `sdr_messages`: `id, thread_id, direction, external_message_id, sender_external_id, sender_name, body, content_hash, language, sent_at, captured_at, delivery_status, metadata_json, created_at`.
2. Usa `ON CONFLICT(external_message_id)`, que **no coincide con ningún índice único**. El único índice aplicable es `idx_sdr_messages_external ON sdr_messages(thread_id, external_message_id)`.

SQLite lanzará error. Consecuencia grave: el correo **ya se envió** en la línea 260, pero la transacción falla → la acción no se marca como completada, el mensaje no se registra, y un reintento **duplicaría el envío**.

Nota: el bloque LinkedIn del mismo dispatcher (`dispatcher.ts:186-200`) **sí es correcto** (usa `sender_name` y `ON CONFLICT(thread_id, external_message_id)`).

**Acción:** corregir columnas y cláusula de conflicto para que coincidan con el bloque LinkedIn.

---

#### B7 — Riesgo de doble envío al aprobar dos veces

`pages/api/sdr/actions/[id]/approve.ts` lee la acción pero **no valida su `state`**. Tras el primer envío, el thread pasa a `WAITING_LEAD`, que **no** está entre los estados bloqueados del dispatcher (`dispatcher.ts:63` solo bloquea `DO_NOT_CONTACT` y `RESOLVED`). Un segundo clic o una doble request vuelve a enviar el mismo texto.

**Acción:** validar `state IN ('proposed','waiting_approval')` antes de despachar, y añadir clave de idempotencia de entrega.

---

### 4.2 Altos (🟠)

#### A1 — Editar la configuración desactiva el provider

`pages/api/sdr/config.ts:139-148`: cualquier cambio de prompt, modelo o instrucciones crea una versión con `publication_state='draft'` y la marca como activa. Como `runtime.ts` exige versión `published`, **guardar la configuración apaga el provider** hasta volver a invocar `/api/sdr/publish`. No hay aviso en la UI.

**Acción:** republicar automáticamente o advertir claramente en la UI que la versión quedó en draft.

---

#### A2 — `NATIVE_CALENDAR_ENABLED` está invertido y no hay calendario

`lib/sdr-agent/runtime.ts:171`:

```ts
calendarEnabled: process.env.NATIVE_CALENDAR_ENABLED !== "false" && process.env.NATIVE_CALENDAR_ENABLED !== "0",
```

`calendarEnabled` es `true` salvo que la variable sea explícitamente `"false"` o `"0"`. El runbook exige mantenerla en `false`, y `.env.local` **no la define** → `calendarEnabled = true`.

Pero **no existe integración de calendario**: `sdr_meeting_bookings` y `sdr_calendar_integrations` (definidas como Google-only, decisión ya descartada) no son leídas por ningún módulo, y `lib/calendar/**` (eventos propios) no está conectado al SDR.

Resultado: el guardrail que debería derivar a humano las peticiones de reunión **no se dispara**, y Gemini puede ofrecer horarios sin backend de disponibilidad.

**Acción:** invertir el default (fail-closed) y/o conectar `lib/calendar/**` al SDR. Mientras no exista, forzar handoff en toda petición de reunión.

---

#### A3 — No hay aislamiento real por slot en el envío

Existen las columnas `accounts.sdr_outbound_enabled`, `sdr_agent_accounts.outbound_enabled`, `sdr_agent_accounts.canary_percentage`, `accounts.sdr_canary_percentage` — **ninguna se lee en runtime**. Solo se escriben en `pages/api/inbox/toggle-autopilot.ts:55-58`.

El gate de salida es únicamente global + a nivel de agente. No se puede hacer canary por slot ni cortar un slot sin apagar todo.

**Acción:** leer estas columnas en `resolveSdrOperationalStatus`.

---

#### A4 — Signal Radar (paso 3) nunca genera con IA en el estado actual

`lib/signals/message-generator.ts:72` exige `status.providerEnabled`. Con `runtime_enabled=0` **siempre** cae al fallback determinista.

Además, el paso 3 muestra en su preview `previewSignalMessage(...)` (`lib/signals/message-template.ts:93`), que es la plantilla determinista — **no** el resultado de Gemini. El usuario ve una "Simulación en Tiempo Real" que no es el mensaje que se generará.

**Acción:** unificar preview con generador real, o etiquetar explícitamente el preview como plantilla orientativa.

---

#### A5 — Autopilot de señales está permanentemente bloqueado

`lib/signals/promotion.ts:39`:

```ts
const sdrReady = Boolean(sdrStatus?.linkedinOutboundEnabled && sdrStatus.providerEnabled);
```

Hoy ambos son falsos → `promoteSignalLead` marca el lead `blocked` y emite `autopilot_blocked`. El modo "Piloto Automático" del paso 4 existe en la UI pero no puede activarse nunca.

**Acción:** depende de B1 (habilitar agente). Revisar además que el mensaje de la UI explique el bloqueo real.

---

#### A6 — Sin interfaz operativa

Falta UI/API para: promotion gates, kill switch, cola de aprobación centralizada (hoy solo accesible vía join del Inbox), métricas (groundedness, edición humana, latencia, coste) y revisión de auditoría.

`pages/sdr.tsx` solo expone: nombre, modo, modelo, umbral de confianza, max_auto_turns, prompt del sistema, contexto de empresa, instrucciones, reglas de handoff, conocimiento y simulador.

---

### 4.3 Medios (🟡)

| ID | Hallazgo | Referencia |
|---|---|---|
| M1 | `test:linkedin-campaign-inbox` está referenciado en el runbook pero **no existe** en `package.json` | `docs/SDR_AGENT_RUNBOOK.md:54` |
| M2 | Contrato de LinkedIn en estado `CANDIDATE_CANARY`; faltan `LINKEDIN_INBOX_CONTRACT_VERIFIED` y `LINKEDIN_CAMPAIGN_INBOX_SYNC_ENABLED` | `docs/LINKEDIN_INBOX_CONTRACT.md:3` |
| M3 | Web Push sin claves VAPID (`WEB_PUSH_ENABLED` ausente). Solo funciona in-app + beep | `.env.local` |
| M4 | `GEMINI_FALLBACK_MODELS` se lee en `research-planner.ts:164` pero `providers/gemini.ts:16` usa lista hardcodeada que excluye `gemini-3.7-flash`. Divergencia de configuración | ambos archivos |
| M5 | Re-promoción de un lead ya enrolado devuelve `already_enrolled` y `promotion.ts:133` lo marca `blocked`, no `enrolled`. Confuso en la UI | `lib/signals/promotion.ts:127-133` |
| M6 | `docs/SDR_AGENT_PROGRESS.md` sigue declarando "no hay dispatcher ni aprobación", estando ambos implementados | línea 64-65 |
| M7 | `.env.local` contiene la API key real de Gemini en claro en el working tree. Está en `.gitignore` (correcto), pero conviene rotarla y moverla a secreto cifrado con `lib/crypto.ts`, como ya se hace con las credenciales de email | `.env.local` |

---

## 5. Integración con campañas, listas y mensajes (paso 3)

### 5.1 Cadena actual, punta a punta

```text
Paso 1 (ICP) → Paso 2 (Disparadores) → Paso 3 (Mensaje → message_config_json)
  → Paso 4 (Cuenta + Lista + Workflow + Modo)
  → scanMonitor → signal_leads (+ signal_observations)
  → generateSignalMessage (Gemini + conocimiento aprobado + guardrail anti-stalker)
  → promoteSignalLead → upsertCampaignTarget → attachTargetToList
  → enrollSignalTarget → runs / run_profiles / run_profile_tracks
                       → run_profile_step_messages (primer mensaje LinkedIn)
  → lib/linkedin/runner consume run_profile_step_messages
  → respuesta del lead → captureSdrInboundMessage → sdr_jobs → worker → SDR
```

### 5.2 Lo que está integrado y funciona

- El mensaje del paso 3 **sí llega** al primer paso de LinkedIn de la campaña vía `run_profile_step_messages` con `source='signal_radar'` (`lib/campaigns/enrollment.ts:160-168`).
- El runner **sí lo consume** (`lib/linkedin/runner.ts:221`).
- La promoción a lista y el enrolamiento en campaña funcionan correctamente.
- `targets.sdr_autopilot=1` se marca al promover en modo autopilot (`promotion.ts:111`).

### 5.3 Lo que falta para cerrar el circuito

1. **Feedback inverso incompleto.** Cuando el SDR clasifica `not_interested` / `unsubscribe`, marca DNC en el thread, pero **no detiene la campaña** (`run_profile_tracks`). Hoy solo el sync de Unipile marca `skipped` al detectar respuesta (`lib/unipile/inbox-sync.ts:167-176`). Falta un `stop_outreach` transaccional que cancele tracks activos y excluya al prospecto de futuras campañas.

2. **Sin atribución campaña↔conversación.** `sdr_threads` no guarda `run_id` ni `workflow_id`. No se puede responder "qué campaña generó esta conversación" ni medir conversión por campaña.

3. **Preview del paso 3 deshonesto.** Ver A4: el preview es determinista, la generación real es Gemini.

4. **Dependencia oculta del paso 3 con el SDR.** `generateSignalMessage` depende del agente SDR estar operativo. Si el usuario configura solo señales y nunca publica el agente, obtendrá siempre plantillas genéricas sin saber por qué. El paso 3 debería mostrar el estado del provider (como hace el paso 4 con `autopilotReadiness` vía `/api/signals/readiness`).

---

## 6. Plan de trabajo

### Fase A — Habilitación segura (sin envío)

1. Activar en BD: `mode='approval'`, `runtime_enabled=1`, `provider_enabled=1`, `outbound_enabled=0`.
2. Alinear `.env.local`: `SDR_OUTBOUND_ENABLED=false`, `SDR_LINKEDIN_OUTBOUND_ENABLED=false`, `SDR_EMAIL_OUTBOUND_ENABLED=false`, `NATIVE_CALENDAR_ENABLED=false`.
3. Corregir **B6** (columnas y `ON CONFLICT` del bloque email en el dispatcher).
4. Corregir **A1** (publicación automática o aviso de draft en la UI).
5. Ejecutar el canary de LinkedIn según `docs/LINKEDIN_INBOX_CONTRACT.md` y `npm run test:sdr-shadow` con contenido controlado.

### Fase B — Aprobación robusta

6. **B4**: invocar `evaluatePreSendGuardrails` en el dispatcher y escribir en `sdr_outbox`.
7. **B7**: validar `state` de la acción + idempotencia de entrega.
8. **A3**: leer `accounts.sdr_outbound_enabled`, `sdr_agent_accounts.outbound_enabled` y `canary_percentage` en `runtime.ts`.
9. **B5**: incrementar `ai_turn_count` al enviar; resetear en takeover/release.
10. **A6**: cola de aprobación, métricas y kill switch en `/sdr`.

### Fase C — Auto controlado

11. **B2**: UI/API para cargar `sdr_promotion_gates` con evidencia. Sin ellos no existe `auto`.
12. **B3**: job `send_reply` + loop que drene `sdr_outbox` con lease, reintentos y reconciliación.
13. **A2**: decidir calendario nativo (conectar `lib/calendar/**` al SDR; no Google Calendar) o forzar handoff en toda petición de reunión mientras no exista.
14. Canary en un slot, luego expansión gradual.

### Fase D — Cierre del circuito con campañas

15. Añadir `run_id` y `workflow_id` a `sdr_threads`.
16. `stop_outreach` transaccional que cancele `run_profile_tracks` y marque exclusión de campañas.
17. Unificar preview del paso 3 con el generador real; mostrar estado del provider.
18. Actualizar `SDR_AGENT_PROGRESS.md` y `SDR_AGENT_RUNBOOK.md` (M1, M6); mover la API key a secreto cifrado (M7).

---

## 7. Notas de alcance

- **El Inbox no fue auditado como módulo autónomo.** Se revisó únicamente como superficie de integración del SDR: joins de estado (`pages/api/inbox/index.ts:218-236`), autorización, tarjeta de aprobación (`pages/inbox.tsx:921`), takeover/release y toggle de autopilot. Todo verificado correcto. Quedan fuera ~2,700 líneas (`pages/inbox.tsx` + 7 endpoints): rendimiento de la query del listado, lectura IMAP por request, filtros, idempotencia de envíos manuales y costo del botón "Sugerir respuesta IA".
- **El cambio pendiente en `pages/signals/index.tsx`** (previo a esta auditoría) no fue modificado ni analizado más allá de su contenido actual en el working tree.

---

## 8. Referencias

- Plan original: `docs/SDR_AGENT_PLAN.md`
- Progreso (desincronizado, ver M6): `docs/SDR_AGENT_PROGRESS.md`
- Runbook operativo: `docs/SDR_AGENT_RUNBOOK.md`
- Contrato LinkedIn: `docs/LINKEDIN_INBOX_CONTRACT.md`
- Backlog histórico (superado): `docs/SDR_AGENT_REVIEW_BACKLOG.md`
