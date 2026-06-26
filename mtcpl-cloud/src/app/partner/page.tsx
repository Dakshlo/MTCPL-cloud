import type { Metadata } from "next";

import styles from "./partner.module.css";

export const metadata: Metadata = {
  title: "Partner Portal — Mateshwari Temple Construction",
  description: "Partner sign-in for MTCPL — track your project's progress.",
};

export default function PartnerLoginPage() {
  return (
    <main className={styles.shell}>
      <div className={styles.card}>
        {/* logo-light.png = white wordmark, for dark backgrounds. */}
        <img
          src="/logo-light.png"
          alt="MTCPL — Mateshwari Temple Construction"
          className={styles.logo}
        />

        <h1 className={styles.title}>Welcome to the Partner Program</h1>
        <p className={styles.sub}>
          Sign in with your registered mobile number to view your project.
        </p>

        {/* UI only — OTP send/verify is wired once the partner SMS template
            is ready. The button is intentionally inert for now. */}
        <form className={styles.form}>
          <label htmlFor="partner-mobile" className={styles.label}>
            Mobile number
          </label>
          <div className={styles.phoneRow}>
            <span className={styles.cc}>+91</span>
            <input
              id="partner-mobile"
              name="mobile"
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              maxLength={10}
              placeholder="00000 00000"
              className={styles.phoneInput}
            />
          </div>

          <button type="button" className={styles.submit}>
            Send OTP
            <svg className={styles.submitArrow} viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M5 12h14M13 6l6 6-6 6"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </form>

        <div className={styles.foot}>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="1.7" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.7" />
          </svg>
          Secured access · Mateshwari Temple Construction
        </div>
      </div>
    </main>
  );
}
