# Guía de Integración con Unipile API

## 1. Visión General
InHubFlow utiliza **Unipile API** como el motor cloud oficial para la gestión de cuentas de LinkedIn, envío de mensajes, solicitudes de conexión y sincronización bidireccional en tiempo real del Inbox mediante Webhooks.

Esto reemplaza completamente los antiguos scrapers locales de Playwright/Chromium, eliminando:
- La fragilidad ante cambios en el DOM o popups de LinkedIn.
- El riesgo de bloqueos por huellas digitales de navegador headless.
- La necesidad de copiar manualmente cookies `li_at`.
- El consumo excesivo de memoria RAM y CPU en el servidor.

---

## 2. Configuración de Variables de Entorno

Agrega las siguientes variables a tu archivo `.env.local` (o variables de entorno en producción):

```bash
# URL base de tu Data Source Name en Unipile (proporcionada en tu dashboard)
UNIPILE_DSN="https://api1.unipile.com:13342"

# Token de acceso generado en dashboard.unipile.com/access-tokens
UNIPILE_API_KEY="tu_unipile_api_key_aqui"
```

Para verificar tu conexión en cualquier momento:
```bash
npm run test:unipile
```

---

## 3. Flujo de Vinculación de Cuentas (Hosted Auth)

En lugar de pedir contraseñas o cookies privadas, la plataforma utiliza el **Hosted Auth Link** de Unipile:

1. El usuario hace clic en **"Conectar LinkedIn"** en la sección de Configuración de InHubFlow.
2. InHubFlow llama a `POST /api/accounts/unipile-link`.
3. El servidor solicita a Unipile una URL de autenticación segura (`POST /api/v1/hosted/accounts/link`).
4. El usuario es redirigido a la pantalla oficial y segura de Unipile donde introduce su cuenta de LinkedIn (soporta 2FA sin errores).
5. Al completarse la vinculación:
   - Unipile redirige al usuario de vuelta a InHubFlow (`/settings?unipile_status=success`).
   - Unipile envía un evento webhook de tipo `account_status_changed` marcando la cuenta como activa.

---

## 4. Arquitectura de Webhooks (Inbox en Tiempo Real y Agente SDR)

Unipile envía notificaciones push a InHubFlow para mantener el Inbox actualizado al instante sin hacer peticiones continuas (polling).

### Endpoint del Webhook:
```
POST https://tu-dominio.com/api/webhooks/unipile
```

### Eventos Procesados:
* `message_received`:
  1. Registra el mensaje en la tabla `linkedin_inbox_messages`.
  2. Actualiza la fecha de última respuesta del prospecto (`targets.last_replied_at`).
  3. Despierta al **Agente SDR con IA** (`publishInboundMessage`) para calificar la respuesta o generar un borrador inteligente.
* `invitation_accepted`:
  - Marca al contacto como conexión de 1er grado (`targets.degree = 1`) y fecha de conexión.
* `account_status_changed`:
  - Actualiza el estado operativo de la cuenta (`OK`, `CHECKPOINT`, `DISCONNECTED`).

---

## 5. Envío de Mensajes e Invitaciones

Toda acción de mensajería se realiza a través del cliente centralizado `lib/unipile/client.ts`:

* **Enviar Invitación:**
  ```typescript
  await unipile.sendInvitation({
    account_id: account.unipile_account_id,
    provider_id: target.unipile_provider_id,
    message: "Hola, me gustaría conectar...",
  });
  ```
* **Enviar Mensaje en Chat:**
  ```typescript
  await unipile.sendMessage({
    chat_id: threadId,
    text: "Hola! ¿Cómo estás?",
  });
  ```
