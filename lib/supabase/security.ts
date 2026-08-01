import { getSupabaseBrowserClient } from "./client";

export type AdciMfaFactor = {
  id: string;
  friendlyName: string;
  createdAt: string;
};

export type AdciMfaState = {
  currentLevel: "aal1" | "aal2" | null;
  nextLevel: "aal1" | "aal2" | null;
  factors: AdciMfaFactor[];
};

function supportedLevel(level: string | null): "aal1" | "aal2" | null {
  return level === "aal1" || level === "aal2" ? level : null;
}

function requireClient() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  return supabase;
}

export async function getMfaState(): Promise<AdciMfaState> {
  const supabase = requireClient();
  const [{ data: levelData, error: levelError }, { data: factorData, error: factorError }] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.mfa.listFactors()
  ]);
  if (levelError) throw levelError;
  if (factorError) throw factorError;
  return {
    currentLevel: supportedLevel(levelData.currentLevel),
    nextLevel: supportedLevel(levelData.nextLevel),
    factors: factorData.totp.map((factor) => ({
      id: factor.id,
      friendlyName: factor.friendly_name || "Authenticator app",
      createdAt: factor.created_at
    }))
  };
}

export async function startMfaEnrollment() {
  const supabase = requireClient();
  const { data: factors, error: factorError } = await supabase.auth.mfa.listFactors();
  if (factorError) throw factorError;

  // Remove abandoned setup attempts so they do not consume the factor limit.
  for (const factor of factors.all.filter((item) => item.factor_type === "totp" && item.status === "unverified")) {
    const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
    if (error) throw error;
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "ADCI Learning Hub"
  });
  if (error) throw error;
  return {
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret
  };
}

export async function verifyMfaCode(factorId: string, code: string) {
  const supabase = requireClient();
  const token = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(token)) throw new Error("Enter the six-digit code from your authenticator app");
  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
  if (challengeError) throw challengeError;
  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code: token
  });
  if (verifyError) throw verifyError;
}

export async function removeMfaFactor(factorId: string) {
  const { error } = await requireClient().auth.mfa.unenroll({ factorId });
  if (error) throw error;
}

export async function recordSecurityEvent(action: string, details: Record<string, unknown> = {}) {
  const { error } = await requireClient().rpc("adci_record_security_event", {
    event_action: action,
    event_details: details
  });
  // The audit migration may not have been applied yet. Security operations must
  // still complete, while database enforcement becomes active after migration.
  if (error && error.code !== "PGRST202" && error.code !== "42883") throw error;
}
