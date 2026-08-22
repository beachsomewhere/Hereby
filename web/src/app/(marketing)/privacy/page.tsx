import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Hereby — Privacy Policy",
};

export default function PrivacyPage() {
  return (
    <div className="marketing article">
      <header>
        <div className="wrap">
          <h1>Privacy Policy</h1>
          <p className="updated">Last updated August 19, 2026</p>
        </div>
      </header>

      <main>
        <div className="wrap">
          <p>
            Hereby is a location-based group chat app. This page explains what data the app collects, how
            it&rsquo;s used, and how long it&rsquo;s kept. Hereby is a small, independently-run project — if
            anything here is unclear, reach out (contact info at the bottom).
          </p>

          <div className="callout">
            <strong>The short version:</strong> your exact location is never shown to other users or
            stored. Chats are temporary and are automatically and permanently deleted a few days after they
            end. There are no ads and no third-party analytics or tracking SDKs in the app.
          </div>

          <h2>What we collect</h2>
          <ul>
            <li>
              <strong>Email address</strong> — used only to sign you in via a one-time code. We don&rsquo;t
              use it for marketing.
            </li>
            <li>
              <strong>A generated username</strong> — not your real name, chosen automatically at signup.
            </li>
            <li>
              <strong>Location</strong> — used to determine which nearby conversations you can see and
              join. See &ldquo;How location is handled&rdquo; below for exactly what is and isn&rsquo;t
              stored.
            </li>
            <li>
              <strong>Messages, votes, and thread activity</strong> you post or take inside the app.
            </li>
            <li>
              <strong>An avatar icon</strong> you select — a simple emoji-style icon, not a photo.
            </li>
            <li>
              <strong>Reports you file</strong> against a message or user, if you use that feature.
            </li>
          </ul>

          <h2>How location is handled</h2>
          <p>
            Your device&rsquo;s precise GPS coordinate is sent to our server only at the moment it&rsquo;s
            needed — to check whether you&rsquo;re close enough to join or post in a specific conversation.
            That raw coordinate is used for a single distance calculation and then discarded; it is never
            written to a database.
          </p>
          <p>
            When you create a new conversation, its location is snapped to a coarse grid before being
            stored, so the stored location is an approximate area, never your precise personal location.
            Other users never see your individual location — only the location of conversations, which
            reflects where they were created, not where any specific person is standing.
          </p>

          <h2>How long we keep data</h2>
          <p>
            Conversations in Hereby are inherently temporary. Once a conversation goes quiet and its
            activity window ends, it&rsquo;s archived, and permanently deleted from our database within
            about 72 hours — along with all of its threads, messages, and votes. There is no long-term
            message archive.
          </p>
          <p>
            Your account (email, username, avatar, and activity level) persists across conversations until
            you delete your account. Deleting your account also deletes any messages you&rsquo;ve sent that
            still exist at that time.
          </p>

          <h2>Who we share data with</h2>
          <p>
            We don&rsquo;t sell your data or share it with advertisers. The app has no third-party
            analytics, advertising, or crash-reporting SDKs. Data is stored with our backend infrastructure
            provider (Supabase), which hosts the database and authentication used to run the app — they
            don&rsquo;t use your data for their own purposes.
          </p>

          <h2>Your choices</h2>
          <ul>
            <li>You can sign out at any time from your profile.</li>
            <li>You can block or report other users from within a conversation.</li>
            <li>To request deletion of your account and associated data, contact us using the email below.</li>
          </ul>

          <h2>Children</h2>
          <p>Hereby is not directed at children under 13, and we don&rsquo;t knowingly collect data from them.</p>

          <h2>Changes to this policy</h2>
          <p>If this policy changes in a meaningful way, we&rsquo;ll update the date at the top of this page.</p>

          <h2>Contact</h2>
          <p>
            Questions about this policy or a data deletion request:{" "}
            <a href="mailto:kylecbarnes@gmail.com">kylecbarnes@gmail.com</a>
          </p>
        </div>
      </main>

      <footer>
        <div className="wrap">
          <p>
            Hereby. Source on <a href="https://github.com/beachsomewhere/Hereby">GitHub</a>.
          </p>
        </div>
      </footer>
    </div>
  );
}
