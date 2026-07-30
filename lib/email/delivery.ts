import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import nodemailer, { type Transporter } from "nodemailer";
import { requireServerEnvironment } from "../supabase/server";

type ClaimedEmail = {
  delivery_id: string;
  announcement_id: string | null;
  message_kind: "announcement" | "payment_receipt" | "assignment_graded";
  recipient_email: string;
  recipient_name: string;
  message_subject: string;
  message_body: string;
  message_priority: "info" | "important" | "urgent";
  attempt_number: number;
};

let smtpTransporter: Transporter | null = null;

function getSmtpTransporter() {
  if (smtpTransporter) return smtpTransporter;
  const port = Number(requireServerEnvironment("SMTP_PORT"));
  if (!Number.isInteger(port) || port <= 0) throw new Error("SMTP_PORT must be a valid port number");
  smtpTransporter = nodemailer.createTransport({
    host: requireServerEnvironment("SMTP_HOST"),
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    auth: {
      user: requireServerEnvironment("SMTP_USER"),
      pass: requireServerEnvironment("SMTP_PASS")
    },
    pool: true,
    maxConnections: 4,
    maxMessages: 100,
    rateDelta: 1000,
    rateLimit: 4,
    tls: { rejectUnauthorized: true }
  });
  return smtpTransporter;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function emailHtml(delivery: ClaimedEmail, appUrl: string) {
  const name = escapeHtml(delivery.recipient_name);
  const title = escapeHtml(delivery.message_subject);
  const body = escapeHtml(delivery.message_body).replaceAll("\n", "<br />");
  const priority = delivery.message_priority.toUpperCase();
  const accent = delivery.message_priority === "urgent" ? "#b85f43" : "#d99839";
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f4f2ec;font-family:Arial,sans-serif;color:#172d32">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ec;padding:28px 12px">
      <tr><td align="center">
        <table role="presentation" width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;background:#fffefa;border:1px solid #ded9cf;border-radius:14px;overflow:hidden">
          <tr><td style="padding:22px 26px;background:#1d3236;color:white">
            <div style="font-size:20px;font-weight:800">ADCI Learning Hub</div>
            <div style="margin-top:4px;font-size:12px;color:#bdc9c7">Anees Defence Career Institute</div>
          </td></tr>
          <tr><td style="height:4px;background:${accent}"></td></tr>
          <tr><td style="padding:28px 26px">
            <div style="font-size:11px;font-weight:800;letter-spacing:.1em;color:${accent}">${priority} UPDATE</div>
            <p style="margin:18px 0 8px;font-size:14px">Hello ${name},</p>
            <h1 style="margin:0 0 14px;font-size:25px;line-height:1.25">${title}</h1>
            <p style="margin:0;color:#596764;font-size:14px;line-height:1.7">${body}</p>
            <a href="${escapeHtml(appUrl)}" style="margin-top:24px;padding:12px 18px;display:inline-block;border-radius:8px;color:#49351e;background:#efad4e;font-size:13px;font-weight:800;text-decoration:none">Open ADCI Learning Hub</a>
          </td></tr>
          <tr><td style="padding:18px 26px;border-top:1px solid #e7e2d9;color:#87908d;font-size:11px;line-height:1.55">
            This operational message was sent to your ADCI account. You can change announcement email preferences from Notifications in the Learning Hub.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

async function sendOne(delivery: ClaimedEmail) {
  const from = requireServerEnvironment("EMAIL_FROM");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://lms.adcionline.com";
  const replyTo = process.env.EMAIL_REPLY_TO;
  const subjectPrefix = delivery.message_priority === "urgent" ? "[Urgent] " : "";
  const messageDomain = new URL(appUrl).hostname;
  const result = await getSmtpTransporter().sendMail({
    from,
    to: delivery.recipient_email,
    replyTo: replyTo || undefined,
    subject: `${subjectPrefix}${delivery.message_subject}`,
    html: emailHtml(delivery, appUrl),
    text: `Hello ${delivery.recipient_name},\n\n${delivery.message_subject}\n\n${delivery.message_body}\n\nOpen ADCI Learning Hub: ${appUrl}`,
    messageId: `<${delivery.delivery_id}@${messageDomain}>`,
    headers: {
      "X-ADCI-Delivery-ID": delivery.delivery_id,
      "X-ADCI-Message-Type": delivery.message_kind
    }
  });
  return result.messageId || delivery.delivery_id;
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function dispatchPendingEmails(service: SupabaseClient, claimLimit = 25) {
  requireServerEnvironment("SMTP_HOST");
  requireServerEnvironment("SMTP_PORT");
  requireServerEnvironment("SMTP_USER");
  requireServerEnvironment("SMTP_PASS");
  requireServerEnvironment("EMAIL_FROM");

  const { data, error } = await service.rpc("adci_claim_email_deliveries", {
    claim_limit: Math.max(1, Math.min(50, claimLimit))
  });
  if (error) throw error;
  const deliveries = (data ?? []) as ClaimedEmail[];
  let sent = 0;
  let failed = 0;

  for (let index = 0; index < deliveries.length; index += 4) {
    const group = deliveries.slice(index, index + 4);
    await Promise.all(group.map(async (delivery) => {
      try {
        const providerId = await sendOne(delivery);
        const { error: markError } = await service.rpc("adci_mark_email_delivery_sent", {
          target_delivery_id: delivery.delivery_id,
          provider_email_id: providerId
        });
        if (markError) throw markError;
        sent += 1;
      } catch (deliveryError) {
        failed += 1;
        await service.rpc("adci_mark_email_delivery_failed", {
          target_delivery_id: delivery.delivery_id,
          failure_message: deliveryError instanceof Error ? deliveryError.message : "Email delivery failed"
        });
      }
    }));
    if (index + 4 < deliveries.length) await wait(900);
  }

  return { claimed: deliveries.length, sent, failed };
}
