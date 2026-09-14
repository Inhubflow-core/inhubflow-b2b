import crypto from "crypto";
import { getDb } from "@/lib/db";
import { createSdrBridge } from "@/lib/sdr-agent/bridge";
import type { UnipileWebhookPayload } from "./types";

export interface ProcessWebhookResult {
  handled: boolean;
  event: string;
  message?: string;
  details?: Record<string, any>;
}

export async function handleUnipileWebhook(payload: UnipileWebhookPayload): Promise<ProcessWebhookResult> {
  const db = getDb();
  const event = payload.event;
  const accountId = payload.account_id;
  const data = payload.data || {};

  console.log(`[Unipile Webhook] Recibido evento: ${event} para cuenta: ${accountId}`);

  // 1. Buscar la cuenta local asociada a este unipile_account_id o id
  const localAccount = db.prepare(`
    SELECT id, name, email, unipile_account_id FROM accounts
    WHERE unipile_account_id = ? OR id = ?
    LIMIT 1
  `).get(accountId, accountId) as { id: string; name: string; email: string; unipile_account_id?: string } | undefined;

  switch (event) {
    case "message_received": {
      const messageId = data.id || data.message_id;
      const chatId = data.chat_id;
      const text = data.text || "";
      const timestamp = data.timestamp || new Date().toISOString();
      const isSender = Boolean(data.is_sender);
      const senderId = data.sender_id || data.sender?.provider_id || "";
      const senderName = data.sender?.name || (isSender ? "Tú" : "Contacto");

      if (!messageId || !chatId) {
        return {
          handled: false,
          event,
          message: "Payload incompleto: falta messageId o chatId",
        };
      }

      const accId = localAccount?.id || accountId;

      // Intentar encontrar el target local asociado a este chat o sender
      let target = db.prepare(`
        SELECT id, full_name, linkedin_url, sdr_autopilot FROM targets
        WHERE unipile_chat_id = ? OR unipile_provider_id = ? OR messaging_urn = ?
        LIMIT 1
      `).get(chatId, senderId, senderId) as { id: string; full_name: string; linkedin_url: string; sdr_autopilot: number } | undefined;

      // Si no encontramos target, buscar si ya había mensajes previos en este thread
      if (!target) {
        const prevMsg = db.prepare(`
          SELECT target_id FROM linkedin_inbox_messages
          WHERE external_thread_id = ? LIMIT 1
        `).get(chatId) as { target_id: string } | undefined;

        if (prevMsg) {
          target = db.prepare("SELECT id, full_name, linkedin_url, sdr_autopilot FROM targets WHERE id = ?").get(prevMsg.target_id) as any;
        }
      }

      // Si aún no existe el target y es un mensaje entrante nuevo, lo creamos para que no se pierda del Inbox
      if (!target && !isSender) {
        const newTargetId = crypto.randomUUID();
        db.prepare(`
          INSERT INTO targets (id, full_name, unipile_chat_id, unipile_provider_id, degree, created_at)
          VALUES (?, ?, ?, ?, 1, datetime('now'))
        `).run(newTargetId, senderName, chatId, senderId);

        target = {
          id: newTargetId,
          full_name: senderName,
          linkedin_url: "",
          sdr_autopilot: 0,
        };
      }

      const targetId = target?.id || "unknown";

      // Insertar mensaje en linkedin_inbox_messages de forma idempotente
      const direction = isSender ? "outbound" : "inbound";
      const existing = db.prepare(`
        SELECT id FROM linkedin_inbox_messages
        WHERE account_id = ? AND external_thread_id = ? AND external_message_id = ?
      `).get(accId, chatId, messageId);

      if (!existing) {
        const internalId = crypto.randomUUID();
        db.prepare(`
          INSERT INTO linkedin_inbox_messages (
            id, account_id, target_id, external_thread_id, external_message_id,
            direction, sender_external_id, sender_name, body, sent_at,
            identity_mode, metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'messaging_urn', ?)
        `).run(
          internalId,
          accId,
          targetId,
          chatId,
          messageId,
          direction,
          senderId,
          senderName,
          text,
          timestamp,
          JSON.stringify(data)
        );

        // Si es mensaje entrante del contacto, actualizar datos del target
        if (!isSender && targetId !== "unknown") {
          db.prepare(`
            UPDATE targets
            SET last_replied_at = ?,
                last_replied_account_id = ?,
                unipile_chat_id = COALESCE(unipile_chat_id, ?)
            WHERE id = ?
          `).run(timestamp, accId, chatId, targetId);

          // Despertar al Agente SDR
          try {
            const bridge = createSdrBridge({ getDatabase: () => db });
            await bridge.publishInboundMessage({
              eventId: `unipile_${messageId}`,
              accountId: accId,
              targetId,
              channel: "linkedin",
              threadId: chatId,
              messageId,
              body: text,
              sentAt: timestamp,
              senderId,
              senderName,
            });

            // Disparar procesamiento del SDR en segundo plano si está disponible
            await bridge.runWorkerTick();
          } catch (sdrErr) {
            console.warn("[Unipile Webhook] Advertencia al notificar al SDR:", sdrErr);
          }
        }
      }

      return {
        handled: true,
        event,
        message: "Mensaje procesado correctamente",
        details: { messageId, chatId, targetId, direction },
      };
    }

    case "account_status_changed": {
      const status = data.status || "OK";
      const isAuthenticated = status === "OK" ? 1 : 0;

      if (localAccount) {
        db.prepare(`
          UPDATE accounts
          SET unipile_status = ?, is_authenticated = ?
          WHERE id = ?
        `).run(status, isAuthenticated, localAccount.id);
      }

      return {
        handled: true,
        event,
        message: `Estado de la cuenta actualizado a: ${status}`,
      };
    }

    case "invitation_accepted": {
      const contactIdentifier = data.provider_id || data.user_id;
      if (contactIdentifier) {
        db.prepare(`
          UPDATE targets
          SET connected_at = datetime('now'), degree = 1
          WHERE unipile_provider_id = ? OR messaging_urn = ?
        `).run(contactIdentifier, contactIdentifier);
      }

      return {
        handled: true,
        event,
        message: "Invitación aceptada registrada",
      };
    }

    default:
      return {
        handled: false,
        event,
        message: `Evento '${event}' no requiere acción específica`,
      };
  }
}
