export type SequenceOrder = "selected" | "alternate";

export function scheduleSeries(startLocal: string, count: number, intervalDays: number): string[] {
  const start = new Date(startLocal);
  if (!startLocal || Number.isNaN(start.getTime()) || count < 1) return [];
  const days = Math.min(365, Math.max(1, Math.round(intervalDays)));
  return Array.from({ length: count }, (_, index) => {
    const scheduled = new Date(start);
    scheduled.setDate(start.getDate() + index * days);
    return scheduled.toISOString();
  });
}

export function alternateByType<T>(items: T[], typeOf: (item: T) => "image" | "video"): T[] {
  if (items.length < 2) return [...items];
  const firstType = typeOf(items[0]);
  const queues = {
    image: items.filter((item) => typeOf(item) === "image"),
    video: items.filter((item) => typeOf(item) === "video"),
  };
  const result: T[] = [];
  let nextType: "image" | "video" = firstType;
  while (queues.image.length || queues.video.length) {
    const preferred = queues[nextType];
    const fallbackType = nextType === "image" ? "video" : "image";
    result.push((preferred.length ? preferred : queues[fallbackType]).shift()!);
    nextType = fallbackType;
  }
  return result;
}

export function defaultScheduleStart(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(9, 30, 0, 0);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
