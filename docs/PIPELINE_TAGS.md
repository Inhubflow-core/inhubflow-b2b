# Pipeline Kanban + Sistema de Etiquetas

El pipeline es el embudo del CRM. Antes de este cambio funcionaba como una vista
casi independiente: el lead sólo entraba si el scraping detectaba la conexión o si
el SDR clasificaba la respuesta. Un prospecto importado y contactado **no aparecía
en el tablero**.

Ahora el pipeline se alimenta de todo el ecosistema (listas, campañas, LinkedIn,
email y SDR) y un sistema de etiquetas — aplicadas por reglas o por la IA — hace
avanzar al lead por las etapas del embudo.

## Modelo de datos

```
tags            id, workspace_owner_id, name, slug UNIQUE(scope, slug), color,
                kind('system'|'custom'), stage_id → pipeline_stages, is_active
target_tags     target_id, tag_id, source('ai'|'manual'|'rule'), confidence,
                applied_by            PK(target_id, tag_id)
tag_events      target_id, tag_id, action('added'|'removed'), source, reason,
                run_id, thread_id, decision_id        → auditoría
```

`tags.stage_id` es la clave del comportamiento: **aplicar una etiqueta empuja el
lead a una etapa**. Las etapas globales (`workspace_owner_id NULL`) son visibles
para todos los workspaces; las personalizadas son del workspace que las crea.

Taxonomía del sistema (sembrada de forma idempotente en `lib/tags/schema.ts`):

| slug | Etapa que empuja | Disparador |
|---|---|---|
| `contacted` | Contactado | enrolamiento en campaña, invitación o mensaje enviado |
| `connected` | Conexión Aceptada | `degree = 1` (scraping **y** webhook) |
| `replied` | En Conversación | inbound de LinkedIn o email |
| `interested` | Interesado | IA: `interested` / `pricing_question` / `proposal_request` |
| `pricing` | — (informativa) | IA: pregunta de precio |
| `meeting` | Reunión Agendada | IA: `meeting_request`, o evento de calendario |
| `not_interested` | No Interesado | IA: rechazo o baja |
| `qualified` | — (informativa) | IA: encaja en el perfil de cliente |
| `unqualified` | — (informativa) | IA: no encaja |

## Etiquetado por la IA

El structured output de Gemini (`lib/sdr-agent/providers/gemini.ts`) incluye
`tags` y `tag_reasoning`. `applyDecisionTags` (llamado desde `finishDecision` en
`lib/sdr-agent/orchestrator.ts`) persiste cada etiqueta con `source='ai'` y su
confianza, y avanza la etapa correspondiente.

Reglas duras, todas cubiertas por `scripts/test-pipeline-tags.cjs`:

- Un slug desconocido **se ignora**: el modelo nunca puede romper el pipeline.
- `not_interested` se aplica al final y **siempre gana**.
- Un mensaje ambiguo **no degrade** Reunión Agendada ni Cerrado/Ganado.
- `stage_won` nunca se pisa automáticamente (es manual, por diseño).

## Puntos de integración (los huecos que se cerraron)

| Evento | Archivo |
|---|---|
| Enrolamiento en campaña | `pages/api/runs/index.ts`, `pages/api/runs/[id]/enroll.ts` |
| Invitación / mensaje LinkedIn enviados | `lib/linkedin/runner.ts` (`tagContacted`) |
| Conexión aceptada por webhook Unipile | `lib/unipile/webhooks.ts` |
| Mensaje entrante de LinkedIn | `lib/unipile/inbox-sync.ts` |
| Respuesta por email | `lib/email/inbox.ts` |
| Intención clasificada por el SDR | `lib/sdr-agent/orchestrator.ts` |

## Aislamiento por workspace

`targets` no tiene columna de propietario, así que el aislamiento se deriva por
join con las cuentas que tocaron al lead (`run_profiles → runs → accounts`,
`linkedin_inbox_messages → accounts`, `email_replies → email_accounts`), igual que
`targetBelongsToLinkedInAccount` en `lib/authz.ts`. `stages.ts` valida la propiedad
en PATCH y DELETE; las etapas globales sólo las puede editar un admin/owner.

## API

- `GET/POST /api/tags` — catálogo y creación de etiquetas personalizadas
- `GET/POST/DELETE /api/targets/[id]/tags` — etiquetas de un lead (+ historial)

## Verificación

```bash
node scripts/test-pipeline-tags.cjs   # 24 comprobaciones: etiquetas, embudo, aislamiento
node scripts/test-pipeline.cjs        # prueba original del kanban
npx tsx scripts/e2e-canary.ts         # canary real con Gemini: la IA etiqueta
```

El canary deja en la BD la prueba de que funciona de punta a punta:
`target_tags` con `source='ai'` y `tag_events` con el motivo de la IA.
