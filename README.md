# InHubFlow

<p align="center">
  <strong>Motor Todo-en-Uno de Prospección B2B, Automatización Omnicanal (LinkedIn + Email) y SDR Autónomo con IA</strong>
</p>

---

## ¿Qué es InHubFlow?

**InHubFlow** es una plataforma de prospección B2B y automatización multicanal diseñada para fundadores, consultores y agencias que buscan escalar su pipeline de ventas con máxima estabilidad y sin depender de extensiones locales frágiles ni proxies complejos.

Impulsada por **Unipile API** como motor cloud oficial de mensajería y conectividad, InHubFlow permite construir secuencias sincronizadas (LinkedIn + Cold Email), sincronizar el Inbox en tiempo real mediante Webhooks y gestionar respuestas con un **Asistente SDR de IA 24/7**.

---

## Características Principales

### 📬 Campañas Multicanal (LinkedIn + Cold Email)
- **LinkedIn + Email en una sola secuencia**: ejecuta visitas de perfil, solicitudes de conexión, mensajes directos y correos en paralelo.
- **Constructor visual de flujos**: encadena pasos con tiempos de espera configurables y condiciones inteligentes.
- **A/B Testing de mensajes**: rota plantillas dinámicamente para optimizar tasas de respuesta.

### 🌐 Motor Cloud Unipile (Oficial)
- **Sin navegadores locales ni caídas**: la infraestructura de mensajería corre 100% en la nube a través de la API oficial de Unipile.
- **Hosted Auth (Conexión en 1 Clic)**: conexión segura y transparente de cuentas de LinkedIn con soporte nativo para 2FA y sin lidiar con cookies manuales (`li_at`).
- **Webhooks en Tiempo Real**: cada mensaje o respuesta entrante actualiza el Inbox instantáneamente sin sobrecargar el servidor.

### 🤖 Asistente SDR de IA 24/7
- **Calificación y Respuestas Autónomas**: analiza el sentimiento y la intención del prospecto, responde dudas u objeciones frecuentes y propone agendamientos de reunión.
- **Bandeja de Entrada Unificada**: centraliza conversaciones de LinkedIn y cuentas de email en una única interfaz moderna y colaborativa.

### 🛡️ Entregabilidad y Seguridad
- **Ramp-up progresivo para email**: calentamiento gradual de bandejas SMTP para garantizar alta entregabilidad.
- **Límites de prospección por cuenta**: respeta las directrices y cuotas de seguridad de cada proveedor.

---

## Configuración y Puesta en Marcha

### Requisitos
- Node.js 20+ o 22+
- NPM

### 1. Instalación
```bash
npm install
```

### 2. Variables de Entorno
Copia el archivo de ejemplo y configura tus claves:
```bash
cp .env.example .env.local
```

Configura tus credenciales de Unipile:
```env
# Unipile API (Cloud Engine)
UNIPILE_DSN="https://api1.unipile.com:13342"
UNIPILE_API_KEY="tu_api_key_de_unipile"

# Modelos de IA para el SDR
GEMINI_API_KEY="tu_gemini_key"
OPENAI_API_KEY="tu_openai_key"
```

### 3. Verificar Conexión con Unipile
```bash
npm run test:unipile
```

### 4. Iniciar en Modo Desarrollo
```bash
npm run dev
```

La plataforma estará disponible en `http://localhost:3000`.

---

## Documentación Técnica
- [Guía de Integración con Unipile API](docs/UNIPILE_INTEGRATION_GUIDE.md)
- [Arquitectura del Agente SDR](docs/SDR_AGENT_PLAN.md)
