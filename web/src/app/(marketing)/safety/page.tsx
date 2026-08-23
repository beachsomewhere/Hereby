import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Hereby — Safety",
};

function CompareRow({
  problem,
  solution,
}: {
  problem: string;
  solution: string;
}) {
  return (
    <div className="compare-row">
      <div className="compare-card problem">
        <span className="compare-label">The old way</span>
        {problem}
      </div>
      <div className="compare-card solution">
        <span className="compare-label">Hereby</span>
        {solution}
      </div>
    </div>
  );
}

export default function SafetyPage() {
  return (
    <div className="marketing article">
      <header>
        <div className="wrap">
          <h1>Built to avoid what went wrong before</h1>
          <p className="updated">How Hereby approaches safety, and why</p>
        </div>
      </header>

      <main>
        <div className="wrap">
          <p>
            Location-based, pseudonymous group chat isn&rsquo;t a new idea — Yik Yak tried it years before
            Hereby existed, and its complete anonymity is a big part of why it struggled. Without any way to
            trace who posted what, the app became a magnet for targeted harassment, hate speech, racism, and
            even direct physical threats. Schools and communities had no real way to stop it or hold anyone
            accountable, and Yik Yak was pulled from app stores and shut down more than once as a result.
          </p>
          <p>
            Hereby is built around a different premise: <strong>anonymous-feeling, not anonymous.</strong>{" "}
            Every design decision below exists specifically to keep the good part of that idea — showing up
            as a pseudonym, not your real name or face — without recreating the accountability gap that sank
            the last app that tried this.
          </p>

          <div className="callout">
            <strong>The short version:</strong> every account is a real, verified person, not a disposable
            burner. Every message is actively reviewed by AI the instant it&rsquo;s sent, not only when
            someone reports it, with a human always making the final call on anything serious. Chats are
            temporary and permanently deleted, not a permanent public record that harassment campaigns can
            pile onto.
          </div>

          <h2>Anonymous-feeling, not anonymous</h2>
          <div className="compare">
            <CompareRow
              problem="Yik Yak had no sign-up gate at all - anyone could post instantly, with nothing tying a post back to a real person."
              solution="Every account is gated behind a real one-time code sent to a real email address before you can do anything else. Your username is what other people see - it's never your real name - but the account behind it is always one verified, real person."
            />
          </div>
          <p>
            That distinction matters. A username that can&rsquo;t be traced back to anyone is a shield for
            bad behavior with no cost. A username tied to a real, verified account still protects your
            privacy day-to-day, but it means abuse isn&rsquo;t consequence-free, and it isn&rsquo;t
            untraceable if something serious happens. Hereby also blocks a username from containing your
            real name, an address, or anything that looks like a phone number - protecting your identity
            works in both directions.
          </p>

          <h2>Every message is actively reviewed - not just the ones someone reports</h2>
          <div className="compare">
            <CompareRow
              problem="Moderation on apps like Yik Yak depended entirely on users flagging content and understaffed teams working through a queue - if nobody reported it (the target stayed quiet, or a chat just went quiet and disappeared), it was never looked at by anyone, ever."
              solution="Every message is scanned automatically the instant it's sent - not only after someone reports it. A free classifier plus a pattern check for personal information (phone numbers, emails, addresses) run on everything; anything either one flags gets a deeper, context-aware AI pass within seconds. A report is a second way in, not the only one."
            />
          </div>
          <p>
            For content that&rsquo;s clearly a serious violation - a credible threat, targeted harassment,
            doxxing - Hereby can remove it automatically within moments, often before anyone had to report
            it at all. That&rsquo;s deliberately not the same as an AI banning someone on its own: removing a
            message and taking action against an account are different things, and a human always reviews
            the case before anything happens to the account itself. The bar for automatic removal is also
            tiered - it takes far less certainty to act on something that looks like a threat than it does
            on something that merely looks like spam. The overwhelming majority of messages are never
            flagged by anything and cost nothing beyond that one automatic check.
          </p>

          <h2>Temporary by design, not a permanent record</h2>
          <div className="compare">
            <CompareRow
              problem="An anonymous post that stays up indefinitely gives a harassment campaign time to build, get shared, and pile on - the exact pattern that made Yik Yak's worst incidents so damaging."
              solution="Every conversation is scoped to a real place and a real moment. Once it goes quiet, it's archived, and permanently deleted from Hereby's database within about 72 hours - there is no long-term, searchable archive of what anyone said."
            />
          </div>

          <h2>Reporting can&rsquo;t be weaponized as easily</h2>
          <div className="compare">
            <CompareRow
              problem="A mass-reporting brigade could bury a real moderation queue, and there was no way to tell a coordinated pile-on from a genuine wave of reports about one serious incident."
              solution="Reporting is rate-limited per person, and every report against the same message or user is linked into one case with one review - so a burst of reports on a genuine incident gets triaged together, and repeated reporting from one account can't multiply into repeated separate reviews."
            />
          </div>

          <h2>What this doesn&rsquo;t mean</h2>
          <p>
            None of this makes Hereby immune to bad behavior, and it&rsquo;s worth being honest about that.
            AI review isn&rsquo;t perfect, which is exactly why account-level action always has a human
            behind it, not just a model. Hereby is also a small, independently-run project, not a company
            with a dedicated trust-and-safety team - if something gets missed, reporting it directly still
            matters. The goal isn&rsquo;t to claim a perfect community. It&rsquo;s to make sure the tools to
            catch and stop abuse quickly - and trace it when it happens - were built in from the start,
            instead of bolted on after the fact.
          </p>

          <h2>Questions</h2>
          <p>
            More detail on what data Hereby collects and how it&rsquo;s handled is in the{" "}
            <a href="/privacy">Privacy Policy</a>. For anything else:{" "}
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
