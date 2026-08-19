export interface ScenarioConversationSeed {
  title: string;
  radiusM: number;
  dLat: number; // offset in degrees from the scenario's center point
  dLng: number;
  participants: number;
  ageMinutes: number;
  seedMessages: string[];
}

export interface Scenario {
  label: string;
  description: string;
  conversations: ScenarioConversationSeed[];
}

// Small, deliberately handwritten degree offsets (roughly tens to a few
// hundred meters at mid-latitudes) so each scenario fans out several
// conversations around one "you are here" point without needing real venue
// geometry. Good enough for exercising bubble sizing, clustering, and the
// dev simulator end to end.

export const SCENARIOS: Record<string, Scenario> = {
  airport: {
    label: "Airport terminal",
    description: "Several gate/flight conversations clustered in one terminal, plus a security-line thread.",
    conversations: [
      {
        title: "What's going on at the airport today?",
        radiusM: 600,
        dLat: 0,
        dLng: 0,
        participants: 35,
        ageMinutes: 120,
        seedMessages: ["Anyone else seeing delays across the board?", "Storms rolling through, expect ripple effects"],
      },
      {
        title: "UA663 delay",
        radiusM: 30,
        dLat: 0.0006,
        dLng: 0.0004,
        participants: 14,
        ageMinutes: 40,
        seedMessages: ["Anyone hear a new departure time?", "Gate agent said 45 more minutes"],
      },
      {
        title: "Gate C12 boarding?",
        radiusM: 30,
        dLat: 0.0004,
        dLng: 0.0007,
        participants: 3,
        ageMinutes: 8,
        seedMessages: ["Screen still says delayed"],
      },
      {
        title: "Security line at Terminal B",
        radiusM: 200,
        dLat: -0.0003,
        dLng: 0.0009,
        participants: 6,
        ageMinutes: 20,
        seedMessages: ["About 25 min wait right now"],
      },
    ],
  },
  concert: {
    label: "Concert venue",
    description: "One large area conversation about set times, plus a parking-lot micro thread.",
    conversations: [
      {
        title: "When does the headliner start?",
        radiusM: 600,
        dLat: 0.0002,
        dLng: -0.0003,
        participants: 22,
        ageMinutes: 60,
        seedMessages: ["Opener just finished", "Probably another 30 min"],
      },
      {
        title: "Parking lot exit backed up",
        radiusM: 30,
        dLat: -0.0008,
        dLng: -0.0006,
        participants: 9,
        ageMinutes: 5,
        seedMessages: ["North exit is faster right now"],
      },
    ],
  },
  traffic: {
    label: "Traffic incident",
    description: "A single corridor-type conversation attached to a road segment.",
    conversations: [
      {
        title: "Why is traffic stopped on I-90 eastbound?",
        radiusM: 300,
        dLat: 0.0001,
        dLng: 0.0015,
        participants: 41,
        ageMinutes: 25,
        seedMessages: ["Looks like a stall in the left lane", "Starting to move a little"],
      },
    ],
  },
  stadium: {
    label: "Stadium / sporting event",
    description: "Concourse-level chatter about food, parking, and the game itself.",
    conversations: [
      {
        title: "Best concession line right now?",
        radiusM: 200,
        dLat: 0.0003,
        dLng: 0.0002,
        participants: 11,
        ageMinutes: 15,
        seedMessages: ["Section 114 stand has no line"],
      },
      {
        title: "Any updates on the injury delay?",
        radiusM: 600,
        dLat: -0.0002,
        dLng: 0.0004,
        participants: 30,
        ageMinutes: 10,
        seedMessages: ["Announcer said player is walking off under his own power"],
      },
    ],
  },
  conference: {
    label: "Conference",
    description: "One session-level conversation and a broader hallway-track thread.",
    conversations: [
      {
        title: "General conference chatter",
        radiusM: 600,
        dLat: 0,
        dLng: 0,
        participants: 40,
        ageMinutes: 150,
        seedMessages: ["Anyone have the wifi password?", "Lunch line is out the door already"],
      },
      {
        title: "Keynote Q&A - anyone catch the slide link?",
        radiusM: 30,
        dLat: 0.0002,
        dLng: 0.0001,
        participants: 18,
        ageMinutes: 30,
        seedMessages: ["Slides should be on the app under Resources"],
      },
      {
        title: "Best sessions today?",
        radiusM: 200,
        dLat: -0.0001,
        dLng: -0.0002,
        participants: 8,
        ageMinutes: 90,
        seedMessages: ["Track 3 has been excellent so far"],
      },
    ],
  },
};

export type ScenarioName = keyof typeof SCENARIOS;
