import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Hereby — location-based group chat",
};

export default function HomePage() {
  return (
    <div className="marketing">
      <header className="hero">
        <div className="wrap">
          <div className="hero-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="hero-icon" src="/icon.png" alt="Hereby app icon" />
            <h1>Hereby</h1>
          </div>
          <p className="tagline">
            The map is the app. See what people around you are talking about, right now — and join in.
          </p>
        </div>
      </header>

      <section>
        <div className="wrap">
          <h2>Why GPS-based chat?</h2>
          <p className="lead">
            Most chat apps connect you to people you already know. Hereby connects you to whoever&rsquo;s
            actually near you, right now — for exactly as long as it matters. Once the moment passes, so
            does the chat; nothing lingers as a group you have to leave later.
          </p>
          <div className="why-row">
            <div>
              <h3>Better information, faster</h3>
              <p>
                The people standing in the same delay, the same traffic, the same crowd usually know
                what&rsquo;s happening before any app, airline, or venue staff does — because they&rsquo;re
                living it with you.
              </p>
            </div>
            <div>
              <h3>No group to manage</h3>
              <p>
                Chats are tied to a place and fade on their own once activity dies down. There&rsquo;s
                nothing to mute, leave, or clean up later.
              </p>
            </div>
            <div>
              <h3>Anonymous by default</h3>
              <p>
                You show up as a pseudonym and a level, not a name or a face — useful, low-stakes
                participation without becoming discoverable.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="alt">
        <div className="wrap">
          <h2>Real situations, real chats</h2>
          <p className="lead">
            A few examples of exactly when this is useful — <a href="/use-cases">more use cases →</a>
          </p>
          <div className="scenarios">
            <div className="scenario">
              <span className="emoji">🚗</span>
              <h3>Stuck in traffic</h3>
              <p>
                Three lanes just stopped moving and nobody knows why. Check the corridor chat instead of
                guessing — someone a quarter mile ahead already posted what&rsquo;s going on, and whether a
                detour&rsquo;s worth it.
              </p>
              <div className="sample">&ldquo;Overturned truck past exit 12, right lane only — add 20 min&rdquo;</div>
            </div>
            <div className="scenario">
              <span className="emoji">✈️</span>
              <h3>Delayed at the gate</h3>
              <p>
                The board just says &ldquo;Delayed,&rdquo; no explanation. The people actually at your gate
                usually know first — which agent has real answers, who already got rebooked, or if it just
                became a cancellation. Narrow question? Branch it into its own thread instead of scrolling
                everyone else&rsquo;s.
              </p>
              <div className="sample">&ldquo;Gate agent said mechanical, new crew inbound ~40 min&rdquo;</div>
            </div>
            <div className="scenario">
              <span className="emoji">🎪</span>
              <h3>Lost at a venue</h3>
              <p>
                Thousands of people, one lost item, no staff in sight. Ask the venue chat where lost and
                found actually is, or if anyone saw a dropped phone near where you were standing.
              </p>
              <div className="sample">&ldquo;Lost &amp; found is behind Gate C, by the merch tent&rdquo;</div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <h2>What it looks like</h2>
          <p className="lead">Screenshots from the iOS Simulator, running the current build.</p>
          <div className="gallery">
            <figure>
              <div className="phone-frame">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/screenshots/map-view.png"
                  alt="Map screen showing a 1,400+ person concert chat with a to-scale radius ring covering SoFi Stadium"
                />
              </div>
              <figcaption>
                <strong>Map</strong>A 1,400-person chat at SoFi Stadium, its radius ring covering the whole
                venue.
              </figcaption>
            </figure>
            <figure>
              <div className="phone-frame">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/screenshots/chat-view.png"
                  alt="Conversation screen showing the Set Times topic thread within a large concert chat"
                />
              </div>
              <figcaption>
                <strong>Conversation</strong>Topic threads like Set Times keep a huge chat organized instead
                of one long feed.
              </figcaption>
            </figure>
            <figure>
              <div className="phone-frame">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/screenshots/create-chat.png"
                  alt="Create chat sheet showing the radius slider and live radius preview"
                />
              </div>
              <figcaption>
                <strong>Start a chat</strong>Slide from a specific spot to a wide area — the radius preview
                updates live on the map underneath.
              </figcaption>
            </figure>
          </div>
        </div>
      </section>

      <section className="alt">
        <div className="wrap">
          <h2>How it works</h2>
          <p className="lead">From opening the app to posting in a chat.</p>
          <div className="flow">
            <div className="step">
              <div className="num" />
              <div>
                <h3>Verify your email</h3>
                <p>
                  Sign-up is gated behind a real one-time code sent to your email (Supabase Auth) — no bots
                  spinning up throwaway accounts.
                </p>
              </div>
            </div>
            <div className="step">
              <div className="num" />
              <div>
                <h3>Pick a username — not your name</h3>
                <p>
                  A username is required before you can do anything else, and it&rsquo;s checked against
                  your email and common identifying patterns (no addresses, no phone-number-shaped strings).
                  A safe, anonymous suggestion is generated for you by default.
                </p>
              </div>
            </div>
            <div className="step">
              <div className="num" />
              <div>
                <h3>See what&rsquo;s nearby</h3>
                <p>
                  Only chats your current location is actually inside of are visible — no browsing chats
                  you haven&rsquo;t arrived at yet. Zoom in to reveal more specific ones (a gate, a table)
                  nested inside broader ones (a whole terminal).
                </p>
              </div>
            </div>
            <div className="step">
              <div className="num" />
              <div>
                <h3>Join, post, and vote</h3>
                <p>
                  Reply to a specific message, upvote or downvote to signal what&rsquo;s helpful, and branch
                  off a focused thread within a chat without starting a whole new conversation.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <h2>Level up by being useful</h2>
          <p className="lead">
            Voting shapes reputation, not the feed. There&rsquo;s no algorithm ranking messages — an upvote
            doesn&rsquo;t move anything to the top. What it does do is quietly build the author&rsquo;s
            level, shown right next to their name on every message they post. A brand-new account and a
            longtime, consistently helpful one are both readable at a glance, without either sharing a real
            name.
          </p>
          <div className="level-track">
            <div className="level-chip">
              <div className="lv">Level 1</div>
              <div className="pts">0 pts</div>
            </div>
            <span className="level-arrow">→</span>
            <div className="level-chip">
              <div className="lv">Level 2</div>
              <div className="pts">5 pts</div>
            </div>
            <span className="level-arrow">→</span>
            <div className="level-chip">
              <div className="lv">Level 3</div>
              <div className="pts">15 pts</div>
            </div>
            <span className="level-arrow">→</span>
            <div className="level-chip">
              <div className="lv">Level 4</div>
              <div className="pts">40 pts</div>
            </div>
            <span className="level-arrow">→</span>
            <div className="level-chip">
              <div className="lv">Level 5</div>
              <div className="pts">100 pts</div>
            </div>
          </div>
        </div>
      </section>

      <section className="alt">
        <div className="wrap">
          <h2>Built for temporary, local conversation</h2>
          <p className="lead">A few of the design decisions that shape the app.</p>
          <div className="features">
            <div className="feature">
              <h3>Location, generalized</h3>
              <p>
                Raw GPS coordinates are never stored — every chat&rsquo;s location is snapped to a coarse
                grid before it&rsquo;s saved.
              </p>
            </div>
            <div className="feature">
              <h3>Activity-driven lifecycle</h3>
              <p>
                Chats score themselves on participants and recent messages, then move through new → active
                → cooling down → archived on their own.
              </p>
            </div>
            <div className="feature">
              <h3>Reputation, not real identity</h3>
              <p>
                Helpfulness is tracked through a level system fed by voting — never through a real name,
                photo, or contact info.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <h2>Stack</h2>
          <div className="stack-row">
            <span className="pill">Expo (SDK 54) / React Native</span>
            <span className="pill">TypeScript</span>
            <span className="pill">Zustand</span>
            <span className="pill">react-native-maps + supercluster</span>
            <span className="pill">Supabase Auth (email OTP)</span>
            <span className="pill">Postgres / PostGIS + Supabase Edge Functions</span>
          </div>
        </div>
      </section>

      <footer>
        <div className="wrap">
          <p>Prototype project.</p>
        </div>
      </footer>
    </div>
  );
}
