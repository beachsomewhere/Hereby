import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Hereby — FAQ",
};

function QA({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div className="qa">
      <h3>{q}</h3>
      <div className="qa-answer">{children}</div>
    </div>
  );
}

export default function FaqPage() {
  return (
    <div className="marketing article">
      <header>
        <div className="wrap">
          <h1>Frequently asked questions</h1>
          <p className="updated">Common questions about how Hereby works</p>
        </div>
      </header>

      <main>
        <div className="wrap">
          <h2>The basics</h2>

          <QA q="What is Hereby?">
            <p>
              A temporary, location-based group chat. The map is the app — instead of browsing a list of
              chats, you see conversations happening around you right now, and you can only join ones your
              current location is actually inside. Once the conversation goes quiet, it fades on its own.
            </p>
          </QA>

          <QA q="How is this different from just a group chat app?">
            <p>
              There&rsquo;s no permanent group to create, manage, or leave later. A chat is tied to a place
              and a moment — it doesn&rsquo;t linger as something you have to clean up once it&rsquo;s no
              longer relevant. See <a href="/safety">Safety</a> for how this design also avoids the
              accountability problems that sank earlier anonymous location-based chat apps.
            </p>
          </QA>

          <QA q="Is Hereby available now?">
            <p>
              Hereby is a small, independently-run prototype currently in TestFlight beta on iOS — it
              isn&rsquo;t on the public App Store yet.
            </p>
          </QA>

          <h2>Location and privacy</h2>

          <QA q="Do other users see my exact location?">
            <p>
              No. Other users only ever see the location of a <em>conversation</em> — which reflects where
              it was created, not where any specific person is standing. Your own precise location is never
              shown to anyone. Full detail in the <a href="/privacy">Privacy Policy</a>.
            </p>
          </QA>

          <QA q="Is my location stored?">
            <p>
              Your raw GPS coordinate is used for one thing — checking whether you&rsquo;re close enough to
              join or post in a specific chat — and then discarded immediately. It&rsquo;s never written to a
              database. A new chat&rsquo;s own location is snapped to a coarse grid before it&rsquo;s stored,
              so what&rsquo;s saved is an approximate area, never a precise point.
            </p>
          </QA>

          <QA q="Am I anonymous?">
            <p>
              You&rsquo;re pseudonymous, not anonymous. You show up to other users as a generated username
              and a level, never your real name or a photo — but every account is a real person verified by
              a one-time code sent to a real email address, not a disposable, untraceable account. More on
              why that distinction matters on the <a href="/safety">Safety</a> page.
            </p>
          </QA>

          <h2>Using the app</h2>

          <QA q="How do I join a chat?">
            <p>
              Chats only appear on the map if your current location is inside their radius. Tap one to see
              its details, then join to start posting. If you step outside the area, you get a short grace
              period before you&rsquo;re moved to read-only for that chat.
            </p>
          </QA>

          <QA q="Can I create my own chat?">
            <p>
              Yes — tap Start chat from the map. You choose a radius from a specific spot (like a single
              table) up to a wide area (like a whole venue or event), and the chat is created at your
              current location.
            </p>
          </QA>

          <QA q="What are threads?">
            <p>
              Every chat has one General thread by default. Participants can branch off additional threads
              scoped to the same chat — useful for keeping a large, busy conversation organized instead of
              one long scrolling feed.
            </p>
          </QA>

          <QA q="What does my &ldquo;Level&rdquo; mean?">
            <p>
              Levels are built from upvotes on your messages — a rough signal of how consistently helpful an
              account has been, shown right next to your username. Voting doesn&rsquo;t rank or reorder the
              feed itself; it only affects your own level over time.
            </p>
          </QA>

          <QA q="How long does a chat last?">
            <p>
              Chats score their own activity from participants and recent messages, and move through
              new &rarr; active &rarr; cooling down &rarr; archived on their own as things quiet down, plus a
              hard time limit regardless of activity. Once archived, a chat and everything in it is
              permanently deleted within about 72 hours — there&rsquo;s no long-term message archive.
            </p>
          </QA>

          <h2>Safety and moderation</h2>

          <QA q="How is content moderated?">
            <p>
              Every message is automatically reviewed the instant it&rsquo;s sent, not only when someone
              reports it — clearly serious violations can be removed within moments. A human always makes
              the final call on anything account-level. Full detail on{" "}
              <a href="/safety">how and why</a>.
            </p>
          </QA>

          <QA q="How do I report something?">
            <p>
              You can report a specific message or a user directly from within a conversation. Reported
              content is prioritized for review alongside whatever AI has already caught proactively.
            </p>
          </QA>

          <QA q="How do I delete my account or data?">
            <p>
              Contact us using the email on the <a href="/privacy">Privacy Policy</a> page — deleting your
              account also deletes any messages you&rsquo;ve sent that still exist at that time.
            </p>
          </QA>

          <h2>Still have a question?</h2>
          <p>
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
