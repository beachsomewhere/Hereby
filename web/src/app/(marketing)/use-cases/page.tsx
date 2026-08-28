import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Hereby — Use cases",
};

function Scenario({
  emoji,
  title,
  sample,
  children,
}: {
  emoji: string;
  title: string;
  sample: string;
  children: React.ReactNode;
}) {
  return (
    <div className="scenario">
      <span className="emoji">{emoji}</span>
      <h3>{title}</h3>
      <p>{children}</p>
      <div className="sample">{sample}</div>
    </div>
  );
}

export default function UseCasesPage() {
  return (
    <div className="marketing article">
      <header>
        <div className="wrap">
          <h1>Where a location-based chat actually helps</h1>
          <p className="updated">
            Any time the people worth talking to are defined by where you are right now, not who you already
            know.
          </p>
        </div>
      </header>

      <main>
        <div className="wrap">
          <h2>On the move</h2>
          <div className="scenarios">
            <Scenario
              emoji="🚗"
              title="Highway traffic backup"
              sample={`"Overturned truck past exit 12, right lane only — add 20 min"`}
            >
              Three lanes just stopped and nobody knows why. Someone a quarter mile ahead already knows —
              check the corridor chat instead of guessing whether a detour&rsquo;s worth it.
            </Scenario>
            <Scenario
              emoji="✈️"
              title="Delayed or canceled flight"
              sample={`"Gate agent said mechanical, new crew inbound ~40 min"`}
            >
              The board just says &ldquo;Delayed,&rdquo; no explanation. The people actually at your gate
              usually know first — which agent has real answers, or who already got rebooked.
            </Scenario>
            <Scenario
              emoji="🚉"
              title="Train or transit delay"
              sample={`"Signal problem at the next stop, they're single-tracking"`}
            >
              A stalled platform announcement repeats the same line every two minutes. Riders already on the
              train usually know more than the PA does.
            </Scenario>
          </div>

          <h2>At a big venue or event</h2>
          <div className="scenarios">
            <Scenario
              emoji="🎪"
              title="Concert, festival, or stadium event"
              sample={`"Lost & found is behind Gate C, by the merch tent"`}
            >
              Thousands of people, one lost item, no staff in sight. Ask the venue chat instead of
              wandering — and branch a thread for something narrow, like set times, without cluttering it
              for everyone else.
            </Scenario>
            <Scenario
              emoji="🏫"
              title="Conference or convention"
              sample={`"Room 204B talk got moved to the main hall"`}
            >
              A schedule change spreads by word of mouth before the official app updates. A chat scoped to
              the venue catches it as it happens, not after you&rsquo;ve already walked to the wrong room.
            </Scenario>
            <Scenario
              emoji="🎓"
              title="Campus move-in or orientation day"
              sample={`"Elevator in Building C is out, use the one by the mail room"`}
            >
              A one-day crowd of people who don&rsquo;t know each other yet, all trying to solve the same
              small logistics problems at once.
            </Scenario>
          </div>

          <h2>Around town</h2>
          <div className="scenarios">
            <Scenario
              emoji="🏢"
              title="Apartment building or HOA"
              sample={`"Water's shut off on floors 3-6 until 2pm, maintenance is on it"`}
            >
              A building-wide notice board nobody has to opt into ahead of time — useful the one day
              something&rsquo;s actually wrong, gone once it&rsquo;s resolved.
            </Scenario>
            <Scenario
              emoji="🎡"
              title="Farmers market or street fair"
              sample={`"Taco stand just sold out, but there's a new coffee cart by the fountain"`}
            >
              Vendors change week to week and nothing&rsquo;s posted online. The people already walking the
              rows right now have the actual answer.
            </Scenario>
            <Scenario
              emoji="🎢"
              title="Long line or wait"
              sample={`"Line for this ride is a 45 min wait, single rider is basically empty"`}
            >
              A theme park queue, a popup drop, a crowded waiting room — is it actually moving, and is there
              a faster way through it that the sign doesn&rsquo;t mention.
            </Scenario>
          </div>
        </div>
      </main>

      <footer>
        <div className="wrap">
          <p>
            Ready to try it? <a href="/">Back to Hereby</a>.
          </p>
        </div>
      </footer>
    </div>
  );
}
