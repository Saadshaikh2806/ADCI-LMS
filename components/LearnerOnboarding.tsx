"use client";

import { BookOpen, Check, CircleHelp, Settings, ShoppingBag, Sparkles } from "lucide-react";

export default function LearnerOnboarding({
  emailVerified,
  profileComplete,
  openSettings,
  openProgrammes,
  openHelp
}: {
  emailVerified: boolean;
  profileComplete: boolean;
  openSettings: () => void;
  openProgrammes: () => void;
  openHelp: () => void;
}) {
  return <section className="learner-onboarding">
    <div className="learner-onboarding-intro">
      <span><Sparkles /></span>
      <div><p className="eyebrow">GET STARTED</p><h2>Your learning space is ready</h2><p>Complete these steps while ADCI assigns your first course.</p></div>
    </div>
    <div className="learner-onboarding-steps">
      <article className={emailVerified ? "done" : ""}><span>{emailVerified ? <Check /> : "1"}</span><div><strong>Verify your email</strong><small>{emailVerified ? "Email verified" : "Open the confirmation link sent to your inbox"}</small></div></article>
      <article className={profileComplete ? "done" : ""}><span>{profileComplete ? <Check /> : "2"}</span><div><strong>Complete your profile</strong><small>Add your name and account details</small></div><button onClick={openSettings}><Settings /> Settings</button></article>
      <article><span>3</span><div><strong>Join a programme</strong><small>Purchase a programme or ask staff to enrol you</small></div><button onClick={openProgrammes}><ShoppingBag /> Browse</button></article>
    </div>
    <div className="learner-onboarding-help"><BookOpen /><span><strong>Already enrolled?</strong><small>If your course is missing, ADCI support can check your access.</small></span><button onClick={openHelp}><CircleHelp /> Get help</button></div>
  </section>;
}
