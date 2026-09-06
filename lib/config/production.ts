import "server-only";

export const productionEnvironmentVariables = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "EMAIL_FROM",
  "CRON_SECRET",
  "NEXT_PUBLIC_APP_URL",
  "AGORA_APP_ID",
  "AGORA_APP_CERTIFICATE",
  "ZOOM_ACCOUNT_ID",
  "ZOOM_API_CLIENT_ID",
  "ZOOM_API_CLIENT_SECRET",
  "ZOOM_HOST_USER_ID",
  "ZOOM_MEETING_SDK_CLIENT_ID",
  "ZOOM_MEETING_SDK_CLIENT_SECRET",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME"
] as const;

export function productionConfigurationStatus() {
  const missing = productionEnvironmentVariables.filter((name) => !process.env[name]?.trim());
  return { configured: missing.length === 0, configuredCount: productionEnvironmentVariables.length - missing.length, totalCount: productionEnvironmentVariables.length };
}
