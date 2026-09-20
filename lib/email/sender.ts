import nodemailer from "nodemailer";
import Imap from "imap";
import { decryptSecret } from "@/lib/crypto";

export interface EmailAccount {
  id: string;
  from_email: string;
  from_name: string | null;
  reply_to?: string | null;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: number; // 0 = STARTTLS, 1 = SSL
  username: string;
  password: string;
}

export interface SendEmailOptions {
  messageId?: string;
  inReplyTo?: string | null;
  references?: string[];
}

export interface SendEmailResult {
  messageId: string;
  accepted: string[];
  rejected: string[];
  response: string | null;
}

function resolvePassword(pw: string | null | undefined): string {
  if (!pw) return "";
  try {
    const decrypted = decryptSecret(pw);
    return decrypted || pw;
  } catch {
    return pw;
  }
}

export async function sendEmail(
  account: EmailAccount,
  to: string,
  subject: string,
  body: string,
  options: SendEmailOptions = {},
): Promise<SendEmailResult> {
  const authPassword = resolvePassword(account.password);

  const transporter = nodemailer.createTransport({
    host: account.smtp_host,
    port: account.smtp_port,
    secure: account.smtp_secure === 1,
    auth: {
      user: account.username,
      pass: authPassword,
    },
    // Allow self-signed certs (common in some corp SMTP setups)
    tls: { rejectUnauthorized: process.env.SMTP_ALLOW_SELF_SIGNED !== "true" },
  });

  const from = account.from_name
    ? `"${account.from_name}" <${account.from_email}>`
    : account.from_email;

  const info = await transporter.sendMail({
    from, to, subject, text: body,
    ...(account.reply_to ? { replyTo: account.reply_to } : {}),
    ...(options.messageId ? { messageId: options.messageId } : {}),
    ...(options.inReplyTo ? { inReplyTo: options.inReplyTo } : {}),
    ...(options.references?.length ? { references: options.references } : {}),
  });
  return {
    messageId: String(info.messageId || options.messageId || ""),
    accepted: Array.isArray(info.accepted) ? info.accepted.map(String) : [],
    rejected: Array.isArray(info.rejected) ? info.rejected.map(String) : [],
    response: typeof info.response === "string" ? info.response : null,
  };
}

/**
 * Verifies SMTP connectivity — used by the test-connection endpoint.
 * Returns null on success, error message string on failure.
 */
export async function testSmtpConnection(account: Omit<EmailAccount, "id">): Promise<string | null> {
  try {
    const authPassword = resolvePassword(account.password);
    const transporter = nodemailer.createTransport({
      host: account.smtp_host,
      port: account.smtp_port,
      secure: account.smtp_secure === 1,
      auth: { user: account.username, pass: authPassword },
      tls: { rejectUnauthorized: process.env.SMTP_ALLOW_SELF_SIGNED !== "true" },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
    });
    await transporter.verify();
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

export interface ImapTestAccount {
  imap_host: string;
  imap_port: number;
  username: string;
  password: string;
  imap_username: string | null;
  imap_password: string | null;
}

/**
 * Verifies IMAP connectivity — connects, authenticates, then disconnects.
 * Returns null on success, error message string on failure.
 */
export async function testImapConnection(account: ImapTestAccount): Promise<string | null> {
  return new Promise((resolve) => {
    const authPassword = resolvePassword(account.imap_password ?? account.password);
    const imap = new Imap({
      host: account.imap_host,
      port: account.imap_port,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
      user: account.imap_username ?? account.username,
      password: authPassword,
      authTimeout: 10_000,
      connTimeout: 12_000,
    });

    imap.once("ready", () => {
      try { imap.end(); } catch { /* ignore */ }
      resolve(null);
    });

    imap.once("error", (err: Error) => {
      resolve(err.message ?? String(err));
    });

    imap.connect();
  });
}

