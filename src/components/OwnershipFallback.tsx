import type { ReactNode } from "react";
import { ShieldAlert } from "lucide-react";
import styles from "./OwnershipBoundary.module.css";

/** Presentation only. Account decisions and recovery actions stay in the boundary. */
export function OwnershipFallback({ checking, title, message, children }: {
  checking: boolean;
  title: string;
  message: string;
  children?: ReactNode;
}) {
  return (
    <main className={`${styles.root} ${styles.fallback}`} role="status" aria-live="polite" aria-atomic="true">
      <div className={styles.frame}>
        <div className={styles.wordmark}>capture<span>.</span></div>
        <section className={styles.panel}>
          {checking ? (
            <div className={styles.waiting} aria-hidden="true"><span /><span /><span /></div>
          ) : (
            <ShieldAlert className={styles.noticeIcon} size={24} strokeWidth={1.5} aria-hidden="true" />
          )}
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.message}>{message}</p>
          {children && <div className={styles.actions}>{children}</div>}
        </section>
      </div>
    </main>
  );
}
