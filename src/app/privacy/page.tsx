import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Privacy · capture",
  description: "What Capture keeps, where it goes, and how to get it back or have it erased.",
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" updated="October 15, 2026">
      <p>
        Capture is run from Vietnam. This page says what
        Capture keeps, where it goes, and how to get it back or have it erased.
        Questions: <a href="mailto:gleb@trycapture.app">gleb@trycapture.app</a>.
      </p>

      <h2>Where your notes live</h2>
      <p>It depends on how you use Capture.</p>
      <ul>
        <li>
          <strong>The free trial on trycapture.app.</strong> Your board stays in
          your browser. To sort a capture, its text is sent to our server and to
          an AI provider (below); we don&rsquo;t store it. To stop abuse, AI
          requests are rate-limited by network (IP) address, held briefly in
          memory and not saved.
        </li>
        <li>
          <strong>Self-hosted.</strong> Your board stays on your own machine, and
          your AI requests go from your machine to the providers whose keys you
          set. We receive nothing.
        </li>
        <li>
          <strong>Capture Cloud.</strong> We keep your email address, your board
          (captures, actions, threads, intentions and their history) and your
          photos, so they sync across your devices. The board is stored with
          Supabase, photos with Vercel Blob, and the app runs on Vercel.
        </li>
      </ul>

      <h2>AI processing</h2>
      <p>
        When you use an AI feature (sorting, summaries, Ask, Distill, tidying,
        voice transcription or reading aloud), the text or audio that request
        needs is sent to the provider handling it: Groq, Cerebras, Mistral,
        Google (Gemini) or OpenRouter (and the model provider it routes to).
        Voice is transcribed by Groq; reading aloud uses Microsoft&rsquo;s
        text-to-speech. Each processes it under its own API terms. If you add
        your own AI key in Capture Cloud, requests go to that provider under
        your account; the key stays on your device and passes through our server
        with each AI request without being stored.
      </p>

      <h2>Payments</h2>
      <p>
        Capture Cloud subscriptions are sold through Polar, which processes the
        payment. We never see your card number; we receive your subscription
        status and an identifier for it.
      </p>

      <h2>What becomes public</h2>
      <ul>
        <li>
          A thread you publish is public at its link until you unpublish it.
        </li>
        <li>
          A bug report sent from the app becomes a public issue in Capture&rsquo;s
          open-source repository on GitHub. Don&rsquo;t put private details in it.
        </li>
      </ul>

      <h2>Analytics, cookies and email</h2>
      <p>
        We count page visits with Vercel Web Analytics, which sets no cookies;
        sensitive parts of links are removed first. Capture Cloud uses a sign-in
        cookie to keep you signed in. There are no advertising or tracking
        cookies. We email you only sign-in codes and account or billing messages.
      </p>

      <h2>How long we keep it</h2>
      <p>
        Your Cloud board and photos are kept while your account exists. Billing
        records are kept for up to 400 days, and operational logs for up to 30
        days. Polar keeps its own payment records under its terms.
      </p>

      <h2>Your data, your choice</h2>
      <p>
        You can download a full backup of your board from Settings at any time.
        To correct anything, or to have your Cloud account erased (your board,
        photos and published threads), email{" "}
        <a href="mailto:gleb@trycapture.app">gleb@trycapture.app</a> from your
        account&rsquo;s address.
      </p>

      <h2>Children</h2>
      <p>Capture is not meant for anyone under 13.</p>

      <h2>Changes</h2>
      <p>
        If this page changes in a way that matters, the date at the top changes,
        and Cloud users are told in the app or by email.
      </p>
    </LegalPage>
  );
}
