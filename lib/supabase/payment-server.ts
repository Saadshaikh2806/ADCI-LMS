import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { apiErrorHeaders, apiErrorStatus } from "../security/rate-limit";

const RAZORPAY_API = "https://api.razorpay.com/v1";

function requiredEnvironment(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export function getPaymentEnvironment() {
  return {
    supabaseUrl: requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL"),
    publishableKey: requiredEnvironment("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    serviceRoleKey: requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY"),
    razorpayKeyId: requiredEnvironment("RAZORPAY_KEY_ID"),
    razorpayKeySecret: requiredEnvironment("RAZORPAY_KEY_SECRET")
  };
}

export function getServiceSupabase() {
  const environment = getPaymentEnvironment();
  return createClient(environment.supabaseUrl, environment.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

export async function requireAuthenticatedPaymentRequest(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Authentication required");

  const environment = getPaymentEnvironment();
  const service = getServiceSupabase();
  const { data, error } = await service.auth.getUser(token);
  if (error || !data.user) throw new Error("Your session has expired. Please sign in again.");

  const userClient = createClient(environment.supabaseUrl, environment.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } }
  });

  return { user: data.user, userClient, service, environment };
}

function encodeBasicAuth(keyId: string, keySecret: string) {
  return Buffer.from(`${keyId}:${keySecret}`).toString("base64");
}

export async function callRazorpay<T>(
  path: string,
  options: { method?: "GET" | "POST"; body?: Record<string, unknown> } = {}
) {
  const environment = getPaymentEnvironment();
  const response = await fetch(`${RAZORPAY_API}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Basic ${encodeBasicAuth(environment.razorpayKeyId, environment.razorpayKeySecret)}`,
      "Content-Type": "application/json"
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(20_000)
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const providerError = payload.error as { description?: string } | undefined;
    throw new Error(providerError?.description || `Razorpay request failed (${response.status})`);
  }
  return payload as T;
}

export function createPaymentSignature(orderId: string, paymentId: string) {
  return createHmac("sha256", getPaymentEnvironment().razorpayKeySecret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
}

export function createWebhookSignature(rawBody: string) {
  const secret = requiredEnvironment("RAZORPAY_WEBHOOK_SECRET");
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function signaturesMatch(received: string, expected: string) {
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length
    && timingSafeEqual(receivedBuffer, expectedBuffer);
}

export function paymentErrorResponse(error: unknown, status = 400) {
  const message = error instanceof Error ? error.message : "Unable to process payment";
  return Response.json({ error: message }, { status: apiErrorStatus(error, status), headers: apiErrorHeaders(error) });
}
