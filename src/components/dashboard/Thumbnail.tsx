"use client";

import { glyphsForTheme, hashString, paletteForTheme } from "@/lib/blueprint/palette";
import type { ProjectSummary } from "@/lib/workspace/types";

/**
 * Thumbnails are derived from blueprint data (theme palette + grid) so every
 * project has a rich, deterministic preview even before art is attached.
 * A linked preview asset (thumbnailUri) always wins.
 */
export function Thumbnail({
  project,
  dense = false,
}: {
  project: ProjectSummary;
  dense?: boolean;
}) {
  const palette = paletteForTheme(project.theme || project.title);
  const glyphs = glyphsForTheme(project.theme || project.title);
  const seed = hashString(`${project.id}:${project.theme}`);

  const columns = Math.max(3, Math.min(6, Math.round(project.columns)));
  const rows = Math.max(2, Math.min(5, Math.round(project.rows)));
  const cells = columns * rows;

  if (project.thumbnailUri) {
    return (
      <div
        className="h-full w-full bg-cover bg-center"
        style={{ backgroundImage: `url(${project.thumbnailUri})` }}
        role="img"
        aria-label={`${project.title} preview art`}
      />
    );
  }

  return (
    <div
      className="relative h-full w-full overflow-hidden"
      role="img"
      aria-label={`${project.title} generated preview`}
      style={{
        background: `radial-gradient(120% 90% at 50% 0%, ${palette.accent}33 0%, ${palette.surface} 45%, ${palette.background} 100%)`,
      }}
    >
      <div
        className="absolute inset-0 opacity-50"
        style={{
          backgroundImage: `radial-gradient(60% 50% at 20% 100%, ${palette.accentAlt}55, transparent 70%)`,
        }}
      />
      <div className="absolute inset-0 grid place-items-center p-3">
        <div
          className="grid w-full gap-[3px] rounded-md border p-[5px]"
          style={{
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            borderColor: `${palette.accent}44`,
            background: `${palette.background}aa`,
            maxWidth: dense ? "72px" : "none",
          }}
        >
          {Array.from({ length: cells }).map((_, index) => (
            <div
              key={index}
              className="grid aspect-square place-items-center rounded-[3px]"
              style={{
                background: `${palette.surface}dd`,
                boxShadow: `inset 0 0 0 1px ${palette.accent}1f`,
                fontSize: dense ? "7px" : "13px",
              }}
            >
              <span style={{ opacity: 0.92 }}>
                {glyphs[(seed + index * 7) % glyphs.length]}
              </span>
            </div>
          ))}
        </div>
      </div>
      {!dense ? (
        <div
          className="absolute inset-x-0 bottom-0 h-10"
          style={{
            background: `linear-gradient(to top, ${palette.background}ee, transparent)`,
          }}
        />
      ) : null}
    </div>
  );
}
