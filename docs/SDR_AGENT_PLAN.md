# Context

> 📌 **Evolución Propietaria e Independiente:**
> A partir de la independencia total de InHubFlow (septiembre 2026), **se eliminan formalmente todas las restricciones de "no tocar core" o "no hacer cambios intrusivos"** que existían anteriormente. InHubFlow evoluciona como plataforma propietaria e independiente, con libertad total para modificar, refactorizar o potenciar su núcleo directamente.

InHubFlow cuenta con un módulo SDR propio basado en Gemini que procesa conversaciones de LinkedIn por cada slot, clasifica la intención, responde preguntas fundamentadas, maneja objeciones permitidas, propone servicios aprobados y entrega la conversación a una persona cuando no pueda actuar con seguridad. Después de completar el SDR no-calendar, coordinará reuniones mediante el calendario empresarial nativo de InHubFlow.

---

# Decisiones de arquitectura

## Evolución Libre y Modificación Directa del Core

Al haberse desvinculado de upstream, el desarrollo ya no está condicionado por la necesidad de recibir actualizaciones externas:

- **Libertad Total sobre el Core:** El equipo puede modificar directamente el runner (`lib/linkedin/runner.ts`), el inbox (`pages/inbox.tsx`), la base de datos (incluso para migraciones profundas o multi-tenancy) y las APIs sin capas artificiales de aislamiento pensadas para upstream.
- **Integración Nativa y Directa:** El Agente SDR, el generador de contenidos y las herramientas de automatización se integran de forma natural y directa en el flujo de trabajo de InHubFlow.
- **Código Limpio y Modular:** Se mantiene la organización de archivos bajo `lib/sdr-agent/**` y `components/sdr-agent/**` por buenas prácticas de ingeniería de software, pero sin la limitación de "no tocar core". InHubFlow evoluciona sin ataduras.

## Agente configurable, no “entrenado” sólo con un prompt

El comportamiento combinará:

1. Prompt/políticas versionados: identidad, tono, idiomas, objetivos, límites y reglas de handoff.
2. Base de conocimiento aprobada: productos, servicios, pricing permitido, FAQs, casos, objeciones y políticas.
3. Historial conversacional resumido y mensajes recientes.
4. Structured output para clasificación/decisión.
5. Function calling para acciones; Gemini nunca ejecuta directamente envíos, calendario o cambios de CRM.
6. Orquestador determinista que valida confianza, permisos, estado, idempotencia y reglas comerciales.

Usar el SDK oficial Google GenAI (`@google/genai`) detrás de una interfaz de proveedor. Mantener el ID del modelo configurable y versionado en DB/env, y verificarlo antes de cada promoción; la implementación actual usa `gemini-3.6-flash` como valor predeterminado, nunca un alias móvil sin evaluación.

## Pipeline asíncrono y reanudable

No llamar a Gemini dentro del callback de scraping/sync. Cada mensaje entrante crea un trabajo persistente con lease:

`captured -> queued -> classifying -> deciding -> waiting_tool/ready_to_send -> sent | handed_off | failed`

- Unique constraints en mensaje externo y acción evitan duplicados.
- Reintentos con backoff y límite.
- Un lock por conversación y otro por slot impiden respuestas concurrentes.
- Reiniciar InHubFlow no pierde ni duplica el trabajo.
- El page queue existente de `lib/linkedin/session.ts` seguirá serializando el acceso Playwright.

## Estados de conversación

- `AI_ACTIVE`
- `HUMAN_REVIEW`
- `HUMAN_ACTIVE`
- `WAITING_LEAD`
- `RESOLVED`
- `DO_NOT_CONTACT`

Cuando una persona toma control, la IA queda bloqueada hasta una reactivación explícita.

# Modelo de datos

Añadir migraciones idempotentes en `lib/db.ts` para tablas separadas del legacy `email_replies`:

- `sdr_agents`: configuración activa, modelo, modo, thresholds, idiomas, horario, handoff y calendar.
- `sdr_agent_versions`: snapshot inmutable de prompt/políticas/configuración publicada.
- `sdr_knowledge_sources`: documento, estado `draft/approved/retired`, versión y referencia del store RAG.
- `conversation_threads`: target, canal, slot/account, external thread id, agent/version, estado, takeover y resumen.
- `conversation_messages`: inbound/outbound, external message id, contenido, idioma, timestamps y delivery status.
- `sdr_jobs`: tipo, estado, lease, intentos, next_attempt_at y error.
- `sdr_decisions`: clasificación estructurada, confidence, risk, reasoning summary, citations, model/tokens/cost y prompt version.
- `sdr_actions`: tool/action, payload validado, idempotency key, approval/execution state y resultado.
- `human_handoffs`: motivo, resumen, recomendación, destinatario, SLA y resolución.
- `native_calendars`, `calendar_resources`, `availability_rules`, `booking_holds`, `meeting_bookings`, `booking_participants` y `booking_reminders`: calendarios/recursos internos, timezone IANA, disponibilidad, selección, conflictos, reprogramación/cancelación y auditoría.
- `notifications`: avisos in-app/email al responsable.

No guardar chain-of-thought. Cifrar API keys, refresh tokens y secretos con `lib/crypto.ts`. Conservar un audit trail redactado y aplicar una política de retención.

# Contratos principales

## Decisión estructurada

Gemini debe devolver un esquema validado con Zod/JSON Schema:

- `intent`: interested, product_question, objection, proposal_request, meeting_request, not_interested, unsubscribe, ooo, referral, automated, ambiguous, legal_risk, human_requested.
- `confidence` y `risk_level`.
- `language`.
- `recommended_action`: answer, ask_clarification, offer_slots, create_proposal, stop_outreach, handoff, no_action.
- `requires_human` y `reason_code`.
- `reply_draft`.
- `knowledge_citations`.

El backend rechaza valores inválidos y nunca interpreta texto libre como autorización.

## Herramientas permitidas

- `search_approved_knowledge`
- `get_contact_context`
- `get_campaign_context`
- `get_approved_pricing`
- `stop_outreach`
- `check_calendar_availability`
- `offer_meeting_slots`
- `create_calendar_event`
- `generate_proposal_from_template`
- `create_handoff`
- `send_linkedin_reply`
- posteriormente `send_email_reply`

Cada herramienta valida ownership del slot, estado de conversación y permisos. Calendar crea eventos sólo después de que el lead elija explícitamente un horario ofrecido. Propuestas usan catálogo/plantillas; términos, descuentos o contratos no estándar siempre hacen handoff.

# Fases y checkpoints reanudables

## Fase 0 — Congelar baseline actual

Objetivo: no mezclar Inbox y SDR.

- Revisar, probar, documentar y guardar el feature pendiente de bandeja unificada/filtro por slot.
- Crear `docs/SDR_AGENT_PLAN.md` con este plan y `docs/SDR_AGENT_PROGRESS.md` con formato de checkpoint.
- Registrar commit base, estado de build y limitación de `ee/` ausente.

**Checkpoint 0:** working tree limpio, commit y push del Inbox; documento SDR versionado.

## Fase 1 — Fundaciones sin IA ni envíos

- Migraciones de conversaciones, mensajes, jobs, agents, versions, actions, handoffs y notifications.
- Repositorios/servicios TypeScript con transacciones y unique constraints.
- Worker con lease, retry/backoff, recovery tras restart y locks.
- UI mínima para crear agente SDR, pero sin activar envío.
- Integración `gemini` visible en Settings y secreto cifrado; endpoint de prueba que no persiste contenido sensible.
- Feature flags globales: `off`, `shadow`, `approval`, `auto`.

**Checkpoint 1:** tests de idempotencia/restart; sin llamadas Gemini ni LinkedIn salientes.

## Fase 2 — Ingesta LinkedIn read-only por slot

### Fase 2A — Contrato y captura explícita, sin red

- Crear el adapter aislado `lib/linkedin/inbox-sync.ts` con un contrato provider-neutral de observaciones; no adivinar endpoints, operaciones GraphQL, payloads ni paginación.
- Normalizar thread id, message id, participantes, timestamps y texto con el contrato SDR existente.
- Resolver targets sólo por `messaging_urn` `urn:li:fsd_profile:*` o URL canónica `/in/<vanity>` dentro del `accountId` explícito; rechazar ambigüedad, conflicto y ownership de otro slot. Nunca sustituir `linkedin_member_urn`.
- Capturar mediante el repositorio SDR transaccional existente, con deduplicación; no cambiar campos legacy, crear targets ni ejecutar el bridge no-op.
- Probar fixtures provider-neutral, idempotencia, aislamiento de slots y ciclo de sesión con fuente inyectada. La captura de esta subfase es manual/expresa y no se conecta al runner, scheduler, UI, Gemini ni envíos.
- Documentar la puerta de descubrimiento en `docs/LINKEDIN_INBOX_CONTRACT.md`, inicialmente `UNVERIFIED`.

### Fase 2B — Fuente basada en contrato observado

- Observar una sesión autorizada y controlada de LinkedIn en modo sólo lectura; registrar el contrato real y un fixture sanitizado antes de implementar el parser/source de red.
- Implementar el source sólo contra las rutas y campos evidenciados: thread id, message id, participantes, dirección, timestamps, texto y paginación.
- Validar sesión expirada/auth wall, límites, errores, paginación y deduplicación contra el fixture observado.
- Ejecutar una prueba controlada de captura por slot y actualizar el documento a `VERIFIED` sólo tras revisión de redacción y seguridad.

### Fases posteriores — Operación

- Integrar un sync periódico con el runner usando intervalos/jitter sólo después del checkpoint 2B y una cuenta controlada.
- Mostrar hilos read-only, slot y estado del agente en Inbox sólo después de validar el contrato y la captura operacional.
- Mantener Gemini, clasificación, handoff y cualquier envío en los checkpoints posteriores; una captura `classify` en cola no implica que la IA esté activa.

**Checkpoint 2:** mensajes inbound reales aparecen una sola vez y en el slot correcto en una prueba controlada; todavía no hay IA ni envío.

## Fase 3 — Gemini clasifica y redacta en shadow mode

- Añadir `@google/genai` y provider adapter.
- Configurar modelo estable, límites, timeout, retries y registro de usage/coste.
- Structured output validado y manejo de bloqueos/refusals.
- Prompt versionado EN/ES/PT-BR con inbound tratado como contenido no confiable.
- Base de conocimiento inicial sólo con documentos aprobados; comenzar con un store pequeño y diseñar adapter para Gemini File Search.
- Generar clasificación, resumen y borrador sin enviar.
- Dataset de evaluación con respuestas reales anonimizadas y casos adversariales.

**Checkpoint 3:** shadow decisions visibles en Inbox; cero mensajes salientes; métricas de accuracy/handoff.

## Fase 4 — Handoff humano y panel operacional

- Configurar responsable y email de handoff por agente/slot.
- Estados `HUMAN_REVIEW/HUMAN_ACTIVE`, bloqueo de IA y botón de devolver control.
- Notificación in-app + email con resumen, pregunta, fuentes y borrador sugerido.
- Acciones Stop outreach / Do not contact transaccionales en ambos tracks.
- Auditoría de cambios manuales y comparación borrador vs respuesta humana.

**Checkpoint 4:** un caso desconocido bloquea IA, avisa al humano correcto y no vuelve a responder solo.

## Fase 5 — Envío LinkedIn automático con guardrails

- Crear `sendLinkedinReply` reutilizando identidad/URN y sesión exacta del slot; no usar typeahead sin validación.
- Abrir el thread exacto, verificar destinatario, enviar y confirmar mensaje persistido antes de marcar éxito.
- Outbox/idempotency, cooldown, quiet hours, límites por slot y máximo de turnos automáticos consecutivos.
- Modo approval primero para pruebas, aunque el objetivo final sea auto.
- Habilitar auto sólo para confidence/risk permitidos y agentes/campañas con opt-in explícito.
- Hard stops obligatorios: unsubscribe, legal, descuentos, información sin fuente, prompt injection, error de herramienta, baja confianza y petición humana.

**Checkpoint 5:** aprobación funciona; luego auto en una cuenta/contacto controlado sin duplicados ni destinatario incorrecto.

## Fase 6 — Calendario empresarial nativo de InHubFlow

Esta fase comienza sólo después de completar y verificar Shadow, approval y auto del SDR no-calendar. No integrar Google Calendar ni Calendly.

- Crear calendarios y recursos internos con permisos por workspace/equipo/usuario.
- Modelar reglas de disponibilidad, excepciones, buffers, duración, capacidad y zonas IANA con DST.
- Consultar disponibilidad y crear holds transaccionales antes de ofrecer 2–3 horarios reales.
- Crear una reserva sólo después de que el lead elija explícitamente un horario ofrecido; usar idempotency key, verificación de conflicto y confirmación persistida.
- Proveer enlaces públicos de reserva seguros, participantes, reprogramación/cancelación, recordatorios y auditoría.
- Vincular cada hold/reserva exactamente con el thread, mensaje, acción, lead y responsable del SDR/Inbox.
- Ante timezone ambiguo, conflicto, hold vencido, permiso insuficiente o fallo de herramienta, realizar handoff.

**Checkpoint 6:** reserva de prueba creada una vez, sin conflicto, en la zona/DST correcta, y reflejada exactamente en Inbox, notificaciones y auditoría.

## Fase 7 — RAG, objeciones y propuestas

- Gemini File Search o adapter RAG con metadata por empresa/campaña/idioma y documentos versionados.
- Editor de servicios, FAQs, playbook, objeciones, pricing y casos de éxito.
- Respuestas deben citar fuentes internas usadas.
- Propuestas desde plantillas y pricing aprobado; no inventar cifras.
- Handoff obligatorio para descuentos, términos custom, seguridad, legal o falta de evidencia.

**Checkpoint 7:** evals demuestran grounding; propuesta estándar reproducible y cualquier excepción llega a humano.

## Fase 8 — Automatización total controlada y producción

- Promover agente versionado de shadow -> approval -> auto mediante gate manual.
- Canary en un slot, luego expansión gradual a cuatro.
- Métricas: clasificación, groundedness, edición humana, handoff, duplicados, reuniones, bajas, latencia, coste y conversión.
- Alertas, daily Gemini budget, circuit breaker, kill switch y runbook de rollback.
- Retención/PII, export/delete y revisión de permisos.

**Checkpoint 8:** producción sólo tras pruebas EN/ES/PT-BR y rollback ensayado.

# Estructura de código prevista

- `lib/sdr-agent/provider.ts`
- `lib/sdr-agent/providers/gemini.ts`
- `lib/sdr-agent/schemas.ts`
- `lib/sdr-agent/orchestrator.ts`
- `lib/sdr-agent/policies.ts`
- `lib/sdr-agent/jobs.ts`
- `lib/sdr-agent/knowledge.ts`
- `lib/sdr-agent/handoff.ts`
- `lib/sdr-agent/tools/*`
- `lib/linkedin/inbox-sync.ts`
- `lib/linkedin/reply.ts`
- `lib/calendar/**`
- `pages/api/sdr-agents/**`
- `pages/api/conversations/**`
- `pages/api/calendar/**`
- `pages/inbox.tsx` y componentes extraídos bajo `components/inbox/**`
- `lib/i18n/locales/{en,es,pt-BR}.json`
- `docs/SDR_AGENT_PLAN.md`
- `docs/SDR_AGENT_PROGRESS.md`
- `docs/SDR_AGENT_RUNBOOK.md`

# Protocolo de continuidad si se agota el crédito

Al terminar cada subfase atómica, antes de continuar:

1. Ejecutar tests/typecheck/lint focalizado/build aplicable.
2. Actualizar `docs/SDR_AGENT_PROGRESS.md` con:
   - fase y subpaso completado;
   - decisiones y supuestos;
   - archivos/migraciones cambiados;
   - comandos y resultados de verificación;
   - commit SHA desplegable;
   - blockers/credenciales pendientes;
   - **siguiente acción exacta**.
3. Crear un commit pequeño con mensaje `feat(sdr): ...` o `test(sdr): ...`.
4. Mantener el working tree limpio entre checkpoints.
5. No comenzar una migración o refactor grande si no queda crédito para verificarlo y documentarlo.

Si se corta la sesión, después de recargar crédito la instrucción de reanudación será:

> Continúa el plan SDR de `docs/SDR_AGENT_PLAN.md` desde el checkpoint registrado en `docs/SDR_AGENT_PROGRESS.md`; primero verifica `git status`, el SHA y los tests, y no repitas fases completadas.

El usuario debe vigilar el balance de Claude; el agente no puede consultar ni garantizar el saldo restante. Los gastos de Gemini se controlarán dentro de InHubFlow mediante límites diarios por agente/slot y logs de tokens/coste.

# Presupuesto orientativo de desarrollo

Los rangos son aproximados y no equivalen directamente a USD porque dependen del modelo, tool outputs y retrabajo:

- Fases 0–1: 80k–160k tokens.
- Fase 2: 120k–220k.
- Fase 3: 120k–220k.
- Fases 4–5: 180k–320k.
- Fase 6: 80k–160k.
- Fases 7–8: 180k–350k.

Con USD 20 de crédito de desarrollo se debe priorizar **un checkpoint verificable por vez**; no asumir que alcanza para todas las fases. No iniciar envío automático hasta completar al menos los checkpoints 0–5.

# Verificación transversal

## Tests automáticos

- Unit: schemas, policies, confidence gates, prompt-injection hard stops, pricing y timezone.
- Integration: jobs/leases, restart, idempotency, DB transactions, provider failures, reservas/holds y validación de herramientas.
- Fixtures EN/ES/PT-BR para cada intent y casos ambiguos/adversariales.
- Simular cuatro slots y asegurar aislamiento/ownership.
- Evals de clasificación, groundedness, tono, acción y handoff contra etiquetas humanas.

## End-to-end controlado

- Cuenta LinkedIn de prueba y contactos consentidos.
- Inbound -> captura única -> shadow decision -> handoff/approval -> envío confirmado.
- Kill/restart entre cada estado para comprobar recovery.
- Reunión con timezone y selección explícita.
- No-interesado/unsubscribe detiene ambos tracks.
- Humano toma control y la IA permanece bloqueada.
- Nunca enviar a un perfil/slot diferente ni duplicar una respuesta.

## Gate de producción

No activar `auto` si falta cualquiera de estos puntos:

- credenciales Gemini y secretos operativos separados/protegidos;
- knowledge base aprobada;
- evals trilingües con umbrales definidos;
- handoff y kill switch probados;
- idempotencia y confirmación de envío;
- límites por slot y daily budget;
- auditoría y rollback;
- canary exitoso en un solo slot.
