import type { Metadata } from "next";

import styles from "./partner.module.css";

export const metadata: Metadata = {
  title: "Partner Portal — Mateshwari Temple Construction",
  description:
    "Secure project visibility for MTCPL partners — live site progress, dispatch tracking, and project milestones.",
};

/* Temple-arch emblem — a pointed torana drawn as a double hairline with
   a kalash finial and a base line. Used as the brand mark + watermark. */
function TempleArch({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path
        d="M10 42V24C10 14 24 6 24 6C24 6 38 14 38 24V42"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M16 42V26C16 19.5 24 14.5 24 14.5C24 14.5 32 19.5 32 26V42"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.6"
      />
      <path d="M6 42H42" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="24" cy="4.2" r="1.7" fill="currentColor" />
    </svg>
  );
}

const FEATURES = [
  {
    label: "Live site & installation progress",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="10" r="2.6" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    ),
  },
  {
    label: "Dispatch tracking with delivery proof",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M3 7h11v8H3zM14 10h4l3 3v2h-7z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <circle cx="7" cy="17.5" r="1.8" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="17.5" cy="17.5" r="1.8" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    ),
  },
  {
    label: "Project milestones & documents",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M7 3h7l4 4v14H7zM14 3v4h4"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path d="M9.5 12h6M9.5 15.5h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
];

export default function PartnerLoginPage() {
  return (
    <main className={styles.shell}>
      {/* ---------- Brand panel ---------- */}
      <section className={styles.brand}>
        <TempleArch className={styles.watermark} />

        <div className={styles.brandTop}>
          {/* logo-dark.png is the light-on-dark lockup (same asset the
              staff login uses on its dark panel). */}
          <img src="/logo-dark.png" alt="Mateshwari Temple Construction" className={styles.logo} />
        </div>

        <div className={styles.brandMid}>
          <TempleArch className={styles.emblem} />
          <p className={styles.eyebrow}>Partner Portal</p>
          <h1 className={styles.headline}>
            Built by hand.
            <br />
            Tracked to the day.
          </h1>
          <p className={styles.lede}>
            Follow your project as it takes shape — carving, dispatch and on-site
            installation — with photo proof at every milestone, in one secure place.
          </p>

          <ul className={styles.features}>
            {FEATURES.map((f) => (
              <li key={f.label} className={styles.feature}>
                <span className={styles.featureIcon}>{f.icon}</span>
                <span className={styles.featureText}>{f.label}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className={styles.brandFoot}>
          <span className={styles.brandFootName}>Mateshwari Temple Construction Pvt. Ltd.</span>
          <span className={styles.brandFootRule} />
        </div>
      </section>

      {/* ---------- Sign-in panel ---------- */}
      <section className={styles.panel}>
        <div className={styles.card}>
          <div className={styles.formEyebrow}>
            <span className={styles.formEyebrowRule} />
            <span className={styles.formEyebrowText}>Partner Access</span>
          </div>

          <h2 className={styles.formTitle}>Sign in to your portal</h2>
          <p className={styles.formSub}>
            Use the credentials issued by your MTCPL account manager.
          </p>

          {/* UI only — intentionally not wired to any auth backend yet. */}
          <form>
            <div className={styles.field}>
              <label htmlFor="partner-id" className={styles.label}>
                Account ID or email
              </label>
              <input
                id="partner-id"
                name="identifier"
                type="text"
                className={styles.input}
                placeholder="e.g. larsen-toubro or you@company.com"
                autoComplete="username"
              />
            </div>

            <div className={styles.field}>
              <label htmlFor="partner-password" className={styles.label}>
                Password
              </label>
              <div className={styles.pwWrap}>
                <input
                  id="partner-password"
                  name="password"
                  type="password"
                  className={styles.input}
                  placeholder="••••••••••"
                  autoComplete="current-password"
                />
                <button type="button" className={styles.eye} aria-label="Show password" tabIndex={-1}>
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" width="18" height="18">
                    <path
                      d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinejoin="round"
                    />
                    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
                  </svg>
                </button>
              </div>
            </div>

            <div className={styles.row}>
              <label className={styles.check}>
                <input type="checkbox" className={styles.checkbox} />
                Remember this device
              </label>
              <button type="button" className={styles.link}>
                Forgot password?
              </button>
            </div>

            <button type="button" className={styles.submit}>
              Sign in
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

          <div className={styles.divider}>
            <span className={styles.dividerLine} />
            <span className={styles.dividerText}>Need access?</span>
            <span className={styles.dividerLine} />
          </div>

          <p className={styles.help}>
            Partner accounts are issued by MTCPL.{" "}
            <span className={styles.helpStrong}>Contact your account manager</span> to get
            started.
          </p>

          <div className={styles.secure}>
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="1.7" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.7" />
            </svg>
            Secured connection · Visible only to your organization
          </div>

          <div className={styles.foot}>
            © 2026 Mateshwari Temple Construction Pvt. Ltd.
            <div className={styles.footLinks}>
              <span className={styles.footLink}>Privacy</span>
              <span className={styles.dot}>·</span>
              <span className={styles.footLink}>Terms</span>
              <span className={styles.dot}>·</span>
              <span className={styles.footLink}>Partner support</span>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
