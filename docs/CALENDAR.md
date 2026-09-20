# Calendario — modelo, integraciones y verificación

Revisión exhaustiva del módulo de calendario y su integración con campañas, listas,
el asistente SDR IA y el resto del ecosistema InHubFlow.

## 1. Modelo de datos

`lib/calendar/schema.ts` — `applyCalendarSchema(db)`, invocado desde `lib/db.ts`
junto a SDR / Pipeline / Tags / Signals. Additivo e idempotente.

| Tabla | Rol |
|---|---|
| `calendar_events` | Citas. Columnas de ecosistema: `run_id`, `list_id`, `thread_id`, `decision_id`, `source`, `workspace_owner_id`, `created_by` |
| `calendar_settings` | Ajustes **por workspace** (`workspace_owner_id`): zona IANA, duración de slot, buffer, horas laborables, aviso mínimo, enlace de videollamada por defecto, token del feed |
| `calendar_meeting_requests` | Propuestas del SDR IA. Estados: `pending` → `scheduled` / `declined` / `expired` |
| `calendar_audit` | Trazabilidad de cada alta, cambio de hora, cambio de estado y borrado |

`id = 'default'` sigue siendo la fila global de reserva para workspaces sin ajustes
propios.

## 2. Zona horaria (la corrección central)

Todo se persiste como **ISO UTC**. El error de fondo era que las vistas agrupaban y
comparaban con prefijos de string, es decir con la fecha **UTC**, contra una grilla
**local**: una reunión a las 23:00 de Santiago aparecía en el día siguiente.

`lib/calendar/time.ts` resuelve esto con `Intl.DateTimeFormat` (sin dependencias
nuevas):

- `dayKeyInZone(instant, tz)` → `YYYY-MM-DD` en la zona del workspace
- `timeLabelInZone(instant, tz)` → `HH:mm`
- `utcFromZoned(y, m, d, h, min, tz)` → instante UTC (resolución DST en dos pasadas)
- `dayBoundsInZone(dateStr, tz)` → rango UTC del día local completo
- `normalizeTimeZone(tz)` → rechaza zonas inválidas y cae a `America/Santiago`

Lo consumen `MonthView`, `WeekView`, `AgendaView`, `ScheduleModal`, `RescheduleModal`,
`EventDetailModal`, `UpcomingMeetingsWidget`, `/book` y todos los endpoints.

## 3. Disponibilidad y colisiones

`lib/calendar/availability.ts`:

- `findSlotCollision` compara **rangos** (`start < :end AND end > :start`), no prefijos
  de string, y respeta `workspaceOwnerId` y `excludeEventId` (reprogramar no choca
  consigo mismo).
- `computeAvailability` aplica el buffer **en ambos lados** del slot, de modo que dos
  reuniones consecutivas nunca se pisan, y omite `cancelled` / `no_show`.
- `suggestSlots` devuelve los próximos N huecos reales (usado por el SDR).

## 4. Integración con el ecosistema

**Campañas y listas.** `CalendarEventFilter` acepta `workspaceOwnerId`, `runId`,
`listId` y `workflowId` (este último resuelto vía `ce.run_id → runs.workflow_id` o
`run_profiles → runs.workflow_id`). `decorateEcosystemContext` adjunta `run_name`,
`list_name`, `list_names` y `workflow_names` en una sola pasada. La UI de `/calendar`
expone filtros de lista y campaña, y `ScheduleModal` permite etiquetar la reunión al
crearla.

**Pipeline.** Agendar (o aprobar una propuesta) avanza el lead a `stage_meeting` vía
`autoAdvanceTargetByTrigger`, respetando las reglas de no regresión: `stage_won` nunca
se degrada y `stage_meeting` sólo retrocede por `sdr_not_interested`. El drawer del
pipeline abre el mismo `ScheduleModal` y muestra las citas del prospecto.

**SDR IA.** El agente **no agenda**: propone. En `finishDecision`
(`lib/sdr-agent/orchestrator.ts`), cuando el intent es `meeting_request`, la acción
recomendada es `offer_slots` o la etiqueta `meeting` está presente, se llama a
`proposeMeetingSlots`, que:
1. respeta el interruptor `NATIVE_CALENDAR_ENABLED` (sin él: `reason: 'disabled'`),
2. crea un `calendar_meeting_requests` en `pending` con huecos reales,
3. notifica al responsable (app + Web Push, `sdr_meeting_request`, idempotente),
4. y si algo falla devuelve `reason: 'error'` **sin** romper la decisión del SDR.

El humano aprueba en `/calendar` (panel de propuestas) o vía
`POST /api/calendar/requests/[id]/approve`; ésa es la única vía por la que una
propuesta se convierte en cita real. **El modo `approval` se mantiene**: el agente no
envía mensajes ni confirma reuniones por su cuenta.

**Página pública `/book`.** Sin sesión, pero convalidada: horizonte ±400 días,
re-chequeo de colisión **dentro** de la misma transacción que el insert (antes había
una carrera TOCTOU que permitía doble reserva), y usa el enlace de videollamada
configurado en vez de inventar una sala `meet.google.com`.

**Feed iCal.** `/api/calendar/feed?token=` exige token (antes era público), resuelve el
workspace a partir de `calendar_settings.feed_token`, escapa el texto ICS y ya no
incluye correos de prospectos. El token se rota desde el modal de ajustes.

## 5. Aislamiento por workspace

- `GET /api/calendar/events` se acota al `actor.workspaceOwnerId` (`requireApiActor`).
- `GET/PUT/DELETE /api/calendar/events/[id]` verifican pertenencia; las filas heredadas
  con `workspace_owner_id IS NULL` sólo pueden mutarlas un superadmin.
- Ajustes y disponibilidad se resuelven por workspace, ya no con una fila global
  compartida.

## 6. i18n

Sección `calendar` (34 claves) en `lib/i18n/locales/{es,en,pt-BR}.json`.

## 7. Verificación

```bash
npm run test:calendar     # 38 comprobaciones
npx tsc --noEmit
npm run build
npm run test:pipeline     # sin regresiones
npm run test:pipeline-tags
```

`scripts/test-calendar.cjs` crea sus propias filas y las limpia al final: matemática
IANA (incluido el cambio de hora chileno), generación de huecos, rechazo de
colisiones, buffer, aislamiento entre workspaces, auditoría, filtros de campaña/lista
y el ciclo completo propuesta → aprobación → reprogramación → borrado.
