// Shared, isomorphic whiteboard logic. Imported by the server route, the client
// component and the logic test, so it must stay free of Node and browser APIs.

export type WhiteboardTool = "pen" | "marker" | "eraser";

// Points are normalised to the 0..1 range on both axes so a stroke drawn on a
// laptop lands in the same place on a phone.
export type WhiteboardPoint = [number, number];

export type WhiteboardStroke = {
  id: string;
  // Opaque per-participant key (random per session), never the Supabase user id.
  author: string;
  tool: WhiteboardTool;
  color: string;
  size: number;
  points: WhiteboardPoint[];
};

export type WhiteboardScene = {
  strokes: WhiteboardStroke[];
};

export const WHITEBOARD_MAX_STROKES = 4000;
export const WHITEBOARD_MAX_POINTS = 1500;
export const WHITEBOARD_MAX_SCENE_BYTES = 1_500_000;

export const WHITEBOARD_COLORS = [
  "#101828",
  "#d92d20",
  "#1570ef",
  "#12b76a",
  "#f79009",
  "#ffffff"
] as const;

export const WHITEBOARD_SIZES = [3, 6, 12] as const;

export type WhiteboardEvent =
  | { type: "stroke"; stroke: WhiteboardStroke }
  | { type: "remove"; ids: string[] }
  | { type: "clear" };

export function emptyScene(): WhiteboardScene {
  return { strokes: [] };
}

function isFinitePair(value: unknown): value is WhiteboardPoint {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number" &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  );
}

function clampUnit(value: number) {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function isWhiteboardStroke(value: unknown): value is WhiteboardStroke {
  if (!value || typeof value !== "object") return false;
  const stroke = value as Record<string, unknown>;
  return (
    typeof stroke.id === "string" &&
    stroke.id.length > 0 &&
    stroke.id.length <= 64 &&
    typeof stroke.author === "string" &&
    stroke.author.length <= 64 &&
    (stroke.tool === "pen" || stroke.tool === "marker" || stroke.tool === "eraser") &&
    typeof stroke.color === "string" &&
    /^#[0-9a-fA-F]{6}$/.test(stroke.color) &&
    typeof stroke.size === "number" &&
    Number.isFinite(stroke.size) &&
    stroke.size > 0 &&
    stroke.size <= 64 &&
    Array.isArray(stroke.points) &&
    stroke.points.length > 0
  );
}

// Accepts anything (a DB row, a broadcast payload) and returns a bounded,
// well-formed scene. Unknown or oversized input collapses to something safe
// rather than throwing.
export function normaliseScene(value: unknown): WhiteboardScene {
  const source =
    value && typeof value === "object" && Array.isArray((value as WhiteboardScene).strokes)
      ? (value as WhiteboardScene).strokes
      : [];
  const strokes: WhiteboardStroke[] = [];
  for (const candidate of source) {
    if (!isWhiteboardStroke(candidate)) continue;
    const points = candidate.points
      .filter(isFinitePair)
      .slice(0, WHITEBOARD_MAX_POINTS)
      .map((point) => [clampUnit(point[0]), clampUnit(point[1])] as WhiteboardPoint);
    if (!points.length) continue;
    strokes.push({
      id: candidate.id,
      author: candidate.author,
      tool: candidate.tool,
      color: candidate.color.toLowerCase(),
      size: Math.min(64, Math.max(0.5, candidate.size)),
      points
    });
    if (strokes.length >= WHITEBOARD_MAX_STROKES) break;
  }
  return { strokes };
}

export function normaliseEvent(value: unknown): WhiteboardEvent | null {
  if (!value || typeof value !== "object") return null;
  const event = value as Record<string, unknown>;
  if (event.type === "clear") return { type: "clear" };
  if (event.type === "remove") {
    if (!Array.isArray(event.ids)) return null;
    const ids = event.ids.filter((id): id is string => typeof id === "string" && id.length <= 64).slice(0, 200);
    return ids.length ? { type: "remove", ids } : null;
  }
  if (event.type === "stroke") {
    const [stroke] = normaliseScene({ strokes: [event.stroke] }).strokes;
    return stroke ? { type: "stroke", stroke } : null;
  }
  return null;
}

// Pure reducer: every client applies the same events in receive order and
// converges on the same scene. Duplicate strokes (re-broadcast on reconnect)
// are ignored.
export function applyEvent(scene: WhiteboardScene, event: WhiteboardEvent): WhiteboardScene {
  switch (event.type) {
    case "stroke": {
      if (scene.strokes.some((stroke) => stroke.id === event.stroke.id)) return scene;
      const strokes = [...scene.strokes, event.stroke];
      if (strokes.length > WHITEBOARD_MAX_STROKES) {
        strokes.splice(0, strokes.length - WHITEBOARD_MAX_STROKES);
      }
      return { strokes };
    }
    case "remove": {
      const drop = new Set(event.ids);
      if (!scene.strokes.some((stroke) => drop.has(stroke.id))) return scene;
      return { strokes: scene.strokes.filter((stroke) => !drop.has(stroke.id)) };
    }
    case "clear":
      return scene.strokes.length ? { strokes: [] } : scene;
    default:
      return scene;
  }
}

export function sceneWithinLimit(scene: WhiteboardScene) {
  if (scene.strokes.length > WHITEBOARD_MAX_STROKES) return false;
  return JSON.stringify(scene).length <= WHITEBOARD_MAX_SCENE_BYTES;
}
