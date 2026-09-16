# Integración de LinkedIn con Unipile

## Arquitectura

Unipile es el único transporte de LinkedIn de InHubFlow para:

- resolución y enriquecimiento de perfiles;
- solicitudes de conexión;
- mensajes de campaña y respuestas humanas/SDR;
- sincronización histórica y en tiempo real del Inbox;
- detección de nuevas relaciones;
- estado de las cuentas conectadas.

La extensión de Chrome y el ejecutor local Playwright/Chromium fueron retirados. El Lead Finder continúa usando Serper.dev y no depende de esta integración.

## Variables de entorno

```bash
UNIPILE_DSN="https://apiXX.unipile.com:12345"
UNIPILE_API_KEY="..."

# Secreto interno, generado por InHubFlow, para el estado del callback Hosted Auth.
UNIPILE_CALLBACK_SECRET="..."

# Token obligatorio para los webhooks v1 actuales. Configura el mismo valor en
# el encabezado X-InHubFlow-Webhook-Token de cada webhook.
UNIPILE_WEBHOOK_TOKEN="..."

# Opcional: secretos HMAC si la cuenta se migra a Webhook Endpoints API v2.
UNIPILE_WEBHOOK_SECRET="..."
UNIPILE_WEBHOOK_SECRETS="...,..."
```

Genera `UNIPILE_CALLBACK_SECRET` de forma independiente, por ejemplo:

```bash
openssl rand -hex 32
```

Nunca reutilices ni expongas `UNIPILE_API_KEY` en el navegador.

## Hosted Auth

1. El usuario crea o selecciona un slot local en **Configuración → LinkedIn**.
2. `POST /api/accounts/linkedin-hosted-connect` verifica autorización sobre el slot.
3. InHubFlow genera estado firmado y solicita una URL Hosted Auth.
4. Para una cuenta nueva utiliza `type=create`; para una cuenta ya asociada utiliza `type=reconnect`.
5. El servicio de conexión llama a `/api/accounts/linkedin-hosted-callback?state=...`.
6. El callback verifica el estado, consulta la cuenta en Unipile y guarda `accounts.unipile_account_id` y su estado real.

El UUID local nunca se envía como `account_id` remoto. Si una cuenta antigua no tiene asociación, el runner solo puede adoptar una cuenta LinkedIn remota en estado `OK` que no esté asignada a otro slot.

## Webhooks obligatorios

Configura en Unipile tres webhooks habilitados hacia:

```text
https://TU_DOMINIO/api/webhooks/linkedin-events
```

| Source | Eventos necesarios | Uso |
|---|---|---|
| `messaging` | `message_received` | Inbox entrante/saliente y SDR |
| `users` | `new_relation` | Aceptación de conexiones |
| `account_status` | `creation_success`, `creation_fail`, `deleted`, `reconnected`, `sync_success`, `stopped`, `ok`, `connecting`, `error`, `credentials`, `permissions` | Salud de la cuenta |

Con las credenciales v1 actuales, cada webhook debe enviar `X-InHubFlow-Webhook-Token`; el endpoint compara el token en tiempo constante y rechaza cualquier petición que no coincida. Si la cuenta se migra a la Webhook Endpoints API v2, el mismo endpoint también admite `unipile-signature` con HMAC-SHA256 sobre `timestamp.raw_body`, múltiples secretos y una ventana antirreplay de cinco minutos.

## Motor de secuencias

### Visitar perfil

`visit` llama siempre a `resolveProfile(..., linkedin_sections=*)`. Guarda la identidad remota y completa únicamente datos vacíos del prospecto. No avanza si Unipile no confirma el perfil.

### Solicitar conexión

`connect`:

- consulta el estado de relación antes de invitar;
- avanza si ya es primer grado;
- espera si existe una invitación pendiente;
- respeta el límite diario y horario de la cuenta;
- registra una reserva durable antes del efecto externo;
- exige `invitation_id` como confirmación;
- bloquea reintentos ambiguos para evitar duplicados;
- espera `new_relation` o la reconciliación periódica del perfil.

### Enviar mensaje

`message`:

- exige primer grado;
- respeta límites y horario;
- usa el chat guardado o inicia uno nuevo;
- exige `chat_id` y `message_id`;
- registra una entrega durable por paso;
- permite múltiples pasos de mensaje en el mismo workflow sin confundirlos con un único `message_sent_at`;
- proyecta el mensaje confirmado al Inbox unificado.

Los estados de provider/chat/conexión se guardan por combinación `(account_id, target_id)` en `linkedin_target_accounts`. Los campos históricos de `targets` se mantienen como proyección compatible para la UI.

## Inbox unificado

La sincronización manual usa:

- `GET /api/v1/chats` con cursor;
- `GET /api/v1/chats/{chat_id}/attendees`;
- `GET /api/v1/chats/{chat_id}/messages` con cursor.

Los mensajes se normalizan en `linkedin_inbox_messages`, se deduplican por cuenta/chat/mensaje y mantienen la atribución a cuenta, campaña y workflow. Los webhooks mantienen el Inbox actualizado; la sincronización manual sirve como backfill y recuperación.

## Verificación segura

```bash
npm run typecheck
npm run test:linkedin-runner
npm run test:unipile-migrations
npm run check:unipile
npx next build
```

`test:linkedin-runner` usa SQLite en memoria y un cliente simulado: no envía invitaciones ni mensajes reales. `test:unipile-migrations` aplica las migraciones sobre una copia temporal de la base existente. `check:unipile` solo consulta estado y falla si faltan secretos, webhooks autenticados o una cuenta `OK`.

Para crear o reparar de forma idempotente los tres webhooks v1 con token obligatorio:

```bash
npm run configure:unipile-webhooks
```

El script genera secretos locales si faltan, crea primero los webhooks seguros y solo después retira las variantes antiguas sin autenticación.

No utilices pruebas de envío en vivo para validación automatizada. El primer envío real debe realizarse como canary autorizado con un único prospecto controlado.
