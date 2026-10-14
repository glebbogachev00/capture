import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Terms · capture",
  description: "The terms for using Capture and Capture Cloud.",
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms" updated="October 15, 2026">
      <p>
        These terms cover using Capture: the free trial on trycapture.app, the
        self-hosted app, and Capture Cloud. Capture is made and run by Gleb
        Bogachev ([COUNTRY]). By using it, you agree to them. Questions:{" "}
        <a href="mailto:gleb@trycapture.app">gleb@trycapture.app</a>.
      </p>

      <h2>The open-source app</h2>
      <p>
        Capture&rsquo;s code is open source under the MIT License. If you run it
        yourself, that license applies to the code, and these terms apply only
        to what you use of ours (the trial and Capture Cloud).
      </p>

      <h2>Your account</h2>
      <p>
        Capture Cloud signs you in with a code sent to your email. Keep access to
        that email secure; anyone who can read it can sign in as you. You must be
        at least [MINIMUM AGE] to use Capture.
      </p>

      <h2>Your content</h2>
      <p>
        What you capture is yours. You let us store it and process it only to run
        Capture for you, which includes sending it to AI providers as described in
        the <a href="/privacy">Privacy</a> page. A thread you publish is public at
        its link until you unpublish it; you are responsible for what you publish.
      </p>

      <h2>Fair use</h2>
      <p>
        Don&rsquo;t use Capture to break the law, to harm others, to publish
        content you have no right to, or to overload, probe or get around its
        limits. Capture Cloud includes AI for normal personal use; we may slow
        down or limit unusually heavy use, and you can add your own AI key to keep
        going.
      </p>

      <h2>AI can be wrong</h2>
      <p>
        Sorting, summaries, answers and suggestions are made by AI models and can
        be mistaken. Check anything that matters before you rely on it. Your own
        words are always kept as you said them.
      </p>

      <h2>Capture Cloud subscriptions</h2>
      <p>
        Capture Cloud costs $5 a month or $50 a year, sold through Polar. It renews
        automatically until you cancel. You can cancel any time from Settings
        (Manage subscription), and Cloud stays active until the end of the period
        you paid for. If something went wrong with a charge, email us.
      </p>

      <h2>Keep a backup</h2>
      <p>
        We work hard to keep your board safe, but no service is perfect.
        Capture is provided as it is, without guarantees that it will always be
        available or free of errors. Download a backup from Settings now and then.
      </p>

      <h2>Limits of responsibility</h2>
      <p>
        To the extent the law allows, we are not liable for indirect or
        consequential losses, and our total liability for anything related to
        Capture is limited to what you paid us in the twelve months before the
        claim. Nothing here limits rights you have that cannot be limited by law.
      </p>

      <h2>Ending</h2>
      <p>
        You can stop using Capture at any time and ask us to erase your Cloud
        account. We may suspend an account that breaks these terms, and we will
        tell you why when we can. If we ever shut Capture Cloud down, we will give
        you notice and time to download your data.
      </p>

      <h2>Changes and law</h2>
      <p>
        If these terms change in a way that matters, the date at the top changes
        and Cloud users are told. These terms are governed by the laws of
        [COUNTRY].
      </p>
    </LegalPage>
  );
}
