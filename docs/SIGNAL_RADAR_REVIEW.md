# 🔍 Revisión Exhaustiva — Signal Radar

**Fecha:** 18-09-2026
**Repositorio:** `inhubflow` v1.7.4 · **Commit HEAD:** `2f81808`
**Alcance:** módulo `lib/signals/` + integración `lib/unipile/`
**Estado:** Solo revisión. **Sin modificaciones realizadas.**

---

## Verificación ejecutada

| Prueba | Resultado |
|---|---|
| `npx tsc --noEmit` | ✅ 0 errores |
| `npm run test:signal-radar` | ✅ 6/6 |
| `npm run test:signal-migrations` | ✅ |
| `npm run check:unipile` | ✅ 2 cuentas OK, 3 webhooks OK, endpoint seguro |
| `npm run test:unipile` | ✅ Conexión OK |
| Pruebas en vivo contra API Unipile | ✅ 11 sondeos ejecutados |

---

## ✅ Lo que está genuinely bien hecho

**1. El trabajo es sólido y no es humo.** El typecheck pasa limpio, los 3.158 líneas del módulo compilan, y los tests cubren los caminos críticos. La arquitectura es seria: separación entre scanners, scoring, promoción y generación de mensajes; contratos tipados (`SignalScannerClient`) que permiten inyectar dobles en tests.

**2. No hay datos falsos ni fixtures.** Verificado que `scanRealSignals` nunca inventa leads. El scanner web tiene una regla explícita y bien implementada: *"Never emit a web lead unless the LinkedIn identity and current company verify"* — si no puede confirmar que la persona trabaja en la empresa del artículo, la descarta (`web.ts:232`).

**3. La deduplicación es real y robusta.** `evidenceFingerprint` hashea monitor+fuente+ID+URL+proveedor+snippet, con índice único `(monitor_id, fingerprint)` en `signal_observations`. Un contacto detectado por 3 señales distintas cuenta como 3 observaciones pero 1 solo lead, y `signal_count` se incrementa. Bien resuelto.

**4. El guardrail "anti-stalker" existe de verdad.** `message-template.ts` valida que el mensaje generado no contenga frases delatoras, y el prompt del sistema prohíbe explícitamente revelar likes/comentarios/visitas. Si la validación falla, se descarta el mensaje de la IA y se usa la plantilla segura.

**5. El control de concurrencia funciona.** El lease de escaneo (`acquireScanLease`) con expiración de 10 min evita solapamientos, y `deleteMonitor` lo respeta. Backoff exponencial ante fallos (hasta 24h). El esquema SQL tiene migraciones idempotentes y `rebuildSignalMonitors` maneja tablas legacy con `PRAGMA foreign_keys = OFF` correctamente restaurado en `finally`.

**6. Los gates de seguridad están donde deben.** Autopilot exige cuenta+lista+workflow+paso de mensaje+SDR habilitado; si falta algo, el lead queda en `blocked` con los blockers registrados, no se envía nada. Los flags `SDR_OUTBOUND_ENABLED` siguen respetándose.

---

## 🚨 Hallazgos críticos (encontrados en pruebas en vivo)

### 🔴 1. `work_experience` viene vacío por throttling de LinkedIn — 8 de 8 perfiles

Lo más grave encontrado. Consultados 8 perfiles reales desde la cuenta:

```
RESUMEN: con experiencia utilizable=0 | throttled/vacio=8 de 8
  marco-aurelio-soares-martins  wx=0  throttled_experience=true
  celso-de-azevedo-ph-d         wx=0  throttled_experience=true
  mathias-mangels               wx=0  throttled_experience=true
  rodrigo-pastl                 wx=0  throttled_experience=true
  rogeriorafael                 wx=0  throttled_experience=true
  julianarolla                  wx=0  throttled_experience=true
  nabila-pangastuti-id          wx=0  throttled_experience=true
  jventurapn                    wx=0  throttled_experience=true
```

LinkedIn devuelve `work_experience_total_count: 31` pero `work_experience: []`, con `throttled_sections: ["experience", ...]`. La API reporta el dato y luego no lo entrega.

**Nota:** la propia cuenta (`is_self: true`) sí devuelve su experiencia — por eso en pruebas manuales probablemente funcionó. Cualquier prospecto externo devuelve vacío.

**Impacto:**

- **`new_in_role` y `internal_promotion`** — `scanRoleChanges` hace `profile.work_experience?.find(...)` y si no hay datos hace `continue`. **Estas dos señales devuelven 0 leads.**
- **`funding_round`, `company_news`, `acquisition_event`, `industry_event`** — `scanWebSignals` exige `companyMatches(current?.company, company)` en `web.ts:232`. Sin experiencia, `current` es `undefined` → `companyMatches(undefined, ...)` → `false` → **todas las señales web quedan bloqueadas.**
- **Scoring** — `company` y `companySize` nunca se pueblan → `companySize` pierde sus 11 puntos y el filtro 4 de `passesIcp` no aplica.

Esto explicaría por qué "nivel 3" puede parecer que no hace nada. No es un bug del código: la lógica es correcta, pero depende de un campo que LinkedIn no está entregando. Necesita plan B (derivar empresa de `headline`, o del `current_positions` del search, o relajar la verificación con una señal de confianza menor).

### 🔴 2. Sales Navigator no está suscrito → `company_growth` y `profile_viewers` mueren con HTTP 403

```
sales_navigator people + viewed_your_profile_recently
  → 403 {"type":"errors/feature_not_subscribed"}
companies sales_navigator + headcount_growth
  → 403 {"type":"errors/feature_not_subscribed"}
```

Verificado en `connection_params`: `premiumFeatures: []` en **las dos cuentas**. No hay Sales Navigator contratado en Unipile.

**El problema no es solo que no funcionen, sino cómo fallan:**

- `accountHasSalesNavigator()` hace `JSON.stringify(connection_params).includes("sales_navigator")` — como `premiumFeatures` está vacío, devuelve `false` correctamente, y `scanSalesNavigatorPeople`/`scanCompanies` lanzan `SignalScanError("unsupported_capability")` antes de llamar a la API. ✅ Ese camino está bien.
- **Pero `capabilities.ts:30` le dice al frontend que las soporta** si `salesNavigator` es true. Como hoy es false, no las muestra. Sin embargo, si algún día `connection_params` contiene la palabra por otra razón (un `organizations` con ese texto, por ejemplo), el `includes()` sobre el JSON serializado daría falso positivo y el usuario vería una señal que explota con 403.
- Además el 403 no se maneja como estado: si llega, `providerErrorCode` lo convierte en `provider_http_403` y el monitor entra en backoff exponencial, reintentando algo que nunca funcionará.

---

## ⚠️ Hallazgos de calidad (impacto alto, no bloqueantes)

### 🟠 3. Cero rate limiting en el escaneo de señales — riesgo directo de baneo

Buscados `rate-limit`, `throttle`, `delay`, `sleep` en todo `lib/signals/` y `lib/unipile/client.ts`: **cero coincidencias**. Existen `lib/rate-limit.ts` y `lib/durable-rate-limit.ts` en el proyecto, pero el Signal Radar no los usa.

Un escaneo de `new_in_role` con límite 50 dispara:

- 1 búsqueda de posts
- **hasta 50 llamadas a `resolveProfile`** en `scanRoleChanges` (`service.ts:447`), en secuencia
- más **1 `resolveProfile` por cada candidato** en `enrichCandidate` (`service.ts:440`)

Y el worker puede procesar 3 monitores por tick cada 60s. Es exactamente el patrón que el soporte de Unipile señaló en el chat del 15-sep como causa de desconexiones: *"Peticiones excesivas, repetitivas o no aleatorizadas a endpoints sensibles → esto dispara alertas de automatización"*.

### 🟠 4. `competitor_audience` no es la audiencia del competidor

`scanCompetitorAudience` busca **posts** que contienen el nombre del competidor (`keywords: subject`) y luego extrae quienes comentaron/reaccionaron. Verificado en vivo con "HubSpot": los resultados son personas que mencionan HubSpot en *sus propios* posts, no seguidores de HubSpot.

```
- author="Max Foster" @ Reply.io      ← competidor de HubSpot, no su audiencia
- author="OMOLAYO OLUFAYO" Payroll    ← sin relación
- author="OddScrew"                   ← sin relación
```

El nombre de la señal promete "Audiencia Activa de Competidores" (según `señales.docx`) y entrega otra cosa. Además no hay deduplicación por fingerprint en esta función (sí la hay en `scanPostEngagement`), así que el mismo contacto puede salir duplicado.

### 🟠 5. Fricción de geografía: no hay filtro de ubicación en people search

`resolveLocationIds` existe y funciona (verificado: "España" → `105646813`), y se usa para empresas. Pero en la búsqueda de **personas nunca se envía `location`**. Con la cuenta principal en proxy **FR**, los resultados salen en portugués y geografía brasileña:

```
Roberto OrSe (proxy FR): Lieven Cooreman         → São Paulo, Brasil
                         Aldo Tapia Castillo     → Peru
                         Roderlei Magalhães      → Curitiba, Paraná, Brasil
```

Si un usuario configura "España" en su ICP, recibirá brasileños y peruanos. El filtro de `passesIcp` los descarta después, pero eso significa que se pagó la llamada y se descartó el resultado — desperdicio de cuota y de señal.

### 🟠 6. `keyword_intent` ignora su parámetro de ventana temporal

`scanPosts` tiene un parámetro `activeOnly` pero la línea 356 hace:

```js
date_posted: activeOnly ? "past_week" : "past_week",
```

Las dos ramas son idénticas. El `time_window_days` del ICP (que puede ser hasta 365) solo se usa para el `cutoff` posterior en memoria. Efecto: pides señales de los últimos 90 días, Unipile devuelve solo 7, y el cutoff de 90 días nunca se entera de lo que quedó fuera.

### 🟠 7. `limit: Math.min(context.limit, 49)` sin explicación

`postSearch` capa en 49 con un número mágico. Funciona (verificado: devuelve 49), pero si es un límite de Unipile merece un comentario; si no, es un cap arbitrario que reduce el volumen sin que el usuario lo sepa.

---

## 🟡 Detalles menores

- **`enrichCandidate` duplica trabajo:** hace `resolveProfile` sobre candidatos que en `scanRoleChanges` ya fueron resueltos. Doble llamada por persona.
- **Errores 4xx tragados:** `fetchPostItemsWithFallback` prueba 4 variantes de URN con `catch {}` vacío. Un 403 de "no tienes permiso" se trata igual que un 404 de "formato incorrecto", sin log. Difícil de diagnosticar.
- **`SIGNAL_TYPES` incluye `"ask_query"`** como tipo creable por API, pero no tiene scanner — crearlo produce `unsupported_capability` al escanear. Debería excluirse del esquema público.
- **Sin paginación real:** el cursor se guarda pero los scanners de posts/rol no lo reanudan de forma significativa; cada scan reprocesa la misma ventana.
- **2.000+ líneas de UI** en `pages/signals/index.tsx` — grande, pero funcional y bien conectada a los 8 endpoints.

---

## 📊 Resumen de estado real por señal

Verificado contra la cuenta real (`RweFsAAiSyGd1LFpaxmWXg`) y la API en vivo:

| # | Señal | Estado | Motivo |
|---|---|---|---|
| 1 | `competitor_reactions` | 🟢 Funciona | 31/31 reacciones parseadas correctamente |
| 2 | `high_intent_comments` | 🟡 Depende del post | 0 comentarios en el post de prueba; el código está bien |
| 3 | `keyword_intent` | 🟢 Funciona | 49 posts; filtro de autor no reduce |
| 4 | `active_poster` | 🟢 Funciona | mismo camino, cutoff 48h |
| 5 | `competitor_audience` | 🟠 Semántica incorrecta | Ver hallazgo 4 |
| 6 | `hiring_spree` | 🟢 Funciona | 10 empresas con `has_job_offers` |
| 7 | `new_in_role` | 🔴 **0 leads** | `work_experience` vacío |
| 8 | `internal_promotion` | 🔴 **0 leads** | mismo |
| 9 | `funding_round` | 🔴 **Bloqueada** | Verificación de empresa imposible |
| 10 | `company_news` | 🔴 **Bloqueada** | mismo |
| 11 | `acquisition_event` | 🔴 **Bloqueada** | mismo |
| 12 | `industry_event` | 🔴 **Bloqueada** | mismo |
| 13 | `company_growth` | 🔴 No disponible | Sales Nav no suscrito (403) |
| 14 | `profile_viewers` | 🔴 No disponible | Sales Nav no suscrito (403) |

**De 14 señales: 4 funcionan bien, 2 funcionan con matices, 6 no producen leads, 2 no están disponibles en el plan.**

---

## 🛠️ Mejoras recomendadas, por prioridad

### P0 — Desbloquean valor real

1. **Plan B para `work_experience` vacío.** Derivar `company` de `headline` (suele contener "CEO at X"), o usar `current_positions` del search cuando exista, o relajar `companyMatches` en señales web aceptando coincidencia por `headline`. Esto revive 6 señales de golpe.
2. **Rate limiting + jitter en `resolveProfile`.** Reutilizar `lib/durable-rate-limit.ts`, con delay aleatorio entre llamadas y un tope de llamadas por scan. Es la diferencia entre una herramienta que funciona meses y una cuenta baneada en semanas.
3. **Detectar el throttling explícitamente.** Si `throttled_sections` incluye `"experience"`, registrarlo en el `signal_scan_run` y mostrarlo en la UI. Hoy el silencio hace que parezca "no hay señales" cuando en realidad es "LinkedIn no me dio el dato".

### P1 — Corrección y honestidad

4. Mapear `403 feature_not_subscribed` a un error no reintentable con mensaje claro ("esta señal requiere Sales Navigator en tu plan de Unipile"), y sacarlo del backoff exponencial.
5. Renombrar o redocumentar `competitor_audience` para que coincida con lo que hace; añadir deduplicación por fingerprint.
6. Enviar `location` en people search y respetar `time_window_days` en `date_posted`.

### P2 — Robustez

7. Cachear `resolveProfile` entre `scanRoleChanges` y `enrichCandidate` para evitar la doble llamada.
8. Logging estructurado de errores 4xx en los fallbacks de URN.
9. Excluir `ask_query` de `SIGNAL_TYPES` públicos.
10. Documentar el `49` o quitarlo.

---

## Veredicto

**El trabajo está bien hecho desde el punto de vista de ingeniería.** La arquitectura es limpia, el código compila, los tests pasan, la deduplicación es sólida, los guardrails anti-spam son serios, y no hay fixtures ni datos simulados.

**Pero la herramienta hoy entrega bastante menos de lo que promete**, y no por falta de calidad del código sino por dos restricciones del proveedor que no se están comunicando al usuario: LinkedIn no entrega `work_experience` de terceros (8/8 perfiles), y el plan de Unipile no incluye Sales Navigator (403 en las dos señales que lo requieren). El sistema detecta ambas cosas y falla de forma segura — pero en silencio, lo que hace que 8 de 14 señales parezcan simplemente "vacías".

La brecha entre lo que el módulo *es* y lo que *entrega* está casi toda en el hallazgo 1. Arreglar eso solo — un plan B para la empresa del prospecto — revive 6 de las 8 señales muertas y es, con diferencia, el mejor uso de la siguiente iteración. Y el rate limiting (hallazgo 3) es lo que determina si la herramienta sigue funcionando dentro de tres meses.
