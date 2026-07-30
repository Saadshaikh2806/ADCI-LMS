import { getSupabaseBrowserClient } from "./client";

export type AdciCertificate = {
  id: string;
  certificate_number: string;
  verification_code: string;
  learner_name: string;
  course_title: string;
  completion_percent: number;
  issued_at: string;
  status: "valid" | "revoked";
  revoked_at: string | null;
  revocation_reason: string | null;
};

export type CertificateCandidate = {
  learner_id: string;
  learner_name: string;
  learner_email: string;
  course_id: string;
  course_title: string;
  enrolment_status: string;
  lesson_total: number;
  lesson_completed: number;
  quiz_total: number;
  quiz_passed: number;
  assignment_total: number;
  assignment_graded: number;
  completion_percent: number;
  eligible: boolean;
  certificate: {
    id: string;
    certificate_number: string;
    verification_code: string;
    issued_at: string;
    status: "valid" | "revoked";
    revoked_at: string | null;
    revocation_reason: string | null;
  } | null;
};

export type CertificateAdminData = {
  summary: { issued: number; eligible: number; revoked: number; courses: number };
  courses: { id: string; title: string }[];
  learners: CertificateCandidate[];
};

export type CertificateVerification = {
  found: boolean;
  valid: boolean;
  status?: "valid" | "revoked";
  certificate_number?: string;
  learner_name?: string;
  course_title?: string;
  completion_percent?: number;
  issued_at?: string;
  organization_name?: string;
  revoked_at?: string | null;
  revocation_reason?: string | null;
};

export async function getCertificateAdminData() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase.rpc("adci_admin_get_certificates");
  if (error) throw error;
  return data as CertificateAdminData;
}

export async function issueCertificate(learnerId: string, courseId: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase.rpc("adci_admin_issue_certificate", {
    target_learner_id: learnerId,
    target_course_id: courseId
  });
  if (error) throw error;
  return data as string;
}

export async function revokeCertificate(certificateId: string, reason: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase.rpc("adci_admin_revoke_certificate", {
    target_certificate_id: certificateId,
    revoke_reason: reason
  });
  if (error) throw error;
}

export async function getMyCertificates() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase.rpc("adci_get_my_certificates");
  if (error) throw error;
  return (data ?? []) as AdciCertificate[];
}

export async function verifyCertificate(code: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Certificate verification is not configured");
  const { data, error } = await supabase.rpc("adci_verify_certificate", {
    target_code: code
  });
  if (error) throw error;
  return data as CertificateVerification;
}
