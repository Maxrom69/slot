import type { ProjectStatus, Volatility } from "@/lib/blueprint/types";

export interface DemoProjectSeed {
  id: string;
  title: string;
  theme: string;
  styleGuide: string;
  description: string;
  status: ProjectStatus;
  folderPath: string | null;
  thumbnailUri: string | null;
  columns: number;
  rows: number;
  paylineCount: number;
  rtpTarget: number;
  volatility: Volatility;
  tags: string[];
  symbolArt?: Record<string, string>;
  updatedMinutesAgo: number;
  createdDaysAgo: number;
}

/**
 * Deterministic local demonstration content so the dashboard is never empty
 * on first launch. These are ordinary projects — they can be renamed,
 * duplicated, moved and deleted like any other.
 */
export const DEMO_PROJECTS: DemoProjectSeed[] = [
  {
    id: "prj_demo_roman_empire",
    title: "Roman Empire",
    theme: "Roman Empire",
    styleGuide: "Cinematic realism, gold leaf, marble, volumetric dusk light",
    description:
      "Legionary-themed 5x3 line game with expanding wild eagle and colosseum free spins.",
    status: "prototype",
    folderPath: null,
    thumbnailUri: "/thumbs/roman-empire.jpg",
    columns: 5,
    rows: 3,
    paylineCount: 20,
    rtpTarget: 95.5,
    volatility: "high",
    tags: ["flagship", "line-game"],
    updatedMinutesAgo: 4,
    createdDaysAgo: 42,
  },
  {
    id: "prj_demo_temple_riches",
    title: "Temple Riches",
    theme: "Jungle Temple",
    styleGuide: "Stylized cartoon, emerald rim light, carved stone, humid haze",
    description:
      "Exploration theme set in ancient jungle ruins filled with relics and idols.",
    status: "team_review",
    folderPath: null,
    thumbnailUri: "/thumbs/temple-riches.jpg",
    columns: 5,
    rows: 3,
    paylineCount: 20,
    rtpTarget: 96.1,
    volatility: "medium",
    tags: ["adventure"],
    symbolArt: {
      A: "/symbols/key.png",
      H1: "/symbols/idol.png",
      H2: "/symbols/mask.png",
      H3: "/symbols/priestess.png",
      M1: "/symbols/chest.png",
      M2: "/symbols/goblet.png",
      WILD: "/symbols/wild.svg",
      SCAT: "/symbols/scatter.svg",
    },
    updatedMinutesAgo: 60 * 7,
    createdDaysAgo: 30,
  },
  {
    id: "prj_demo_neon_sevens",
    title: "Neon Sevens",
    theme: "Neon Arcade",
    styleGuide: "Retro-futurist chrome, magenta/cyan neon, CRT scanlines",
    description: "Classic fruit-machine reinterpretation with hold & win respins.",
    status: "blueprint",
    folderPath: "Concepts",
    thumbnailUri: "/thumbs/neon-sevens.jpg",
    columns: 3,
    rows: 3,
    paylineCount: 5,
    rtpTarget: 94.2,
    volatility: "low",
    tags: ["classic", "retro"],
    updatedMinutesAgo: 60 * 21,
    createdDaysAgo: 12,
  },
  {
    id: "prj_demo_spring_hatch",
    title: "Spring Hatch",
    theme: "Blossom Spring",
    styleGuide: "Soft pastel cartoon, bloom lighting, plush shapes",
    description: "Seasonal campaign slot built for the spring marketing window.",
    status: "draft",
    folderPath: "Campaigns/Spring",
    thumbnailUri: "/thumbs/spring-hatch.jpg",
    columns: 5,
    rows: 4,
    paylineCount: 40,
    rtpTarget: 95.0,
    volatility: "medium",
    tags: ["seasonal", "campaign"],
    updatedMinutesAgo: 60 * 30,
    createdDaysAgo: 8,
  },
  {
    id: "prj_demo_abyss_fortune",
    title: "Abyss Fortune",
    theme: "Deep Abyss",
    styleGuide: "Bioluminescent deep sea, caustic light, cold cyan palette",
    description: "Ways-evaluation deep sea game with cascading bubbles.",
    status: "math",
    folderPath: "Concepts",
    thumbnailUri: null,
    columns: 6,
    rows: 4,
    paylineCount: 0,
    rtpTarget: 96.4,
    volatility: "extreme",
    tags: ["ways", "experiment"],
    updatedMinutesAgo: 60 * 52,
    createdDaysAgo: 19,
  },
  {
    id: "prj_demo_frost_vault",
    title: "Frost Vault",
    theme: "Frost Vault",
    styleGuide: "Icy chrome vault, pale blue glass, frozen particulates",
    description: "Hold & win vault game with frozen jackpot coins.",
    status: "blueprint",
    folderPath: "Campaigns/Winter",
    thumbnailUri: null,
    columns: 5,
    rows: 3,
    paylineCount: 25,
    rtpTarget: 95.8,
    volatility: "high",
    tags: ["hold-and-win"],
    updatedMinutesAgo: 60 * 96,
    createdDaysAgo: 65,
  },
];
