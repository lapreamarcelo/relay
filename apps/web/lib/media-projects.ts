export interface NestedMediaProject {
  id: string;
  name: string;
  parentId?: string | null;
}

export interface FlattenedMediaProject<T extends NestedMediaProject> {
  project: T;
  depth: number;
}

export function flattenMediaProjects<T extends NestedMediaProject>(projects: T[]): FlattenedMediaProject<T>[] {
  const knownIds = new Set(projects.map((project) => project.id));
  const children = new Map<string | null, T[]>();
  for (const project of projects) {
    const parentId = project.parentId && knownIds.has(project.parentId) ? project.parentId : null;
    children.set(parentId, [...(children.get(parentId) ?? []), project]);
  }
  for (const siblings of children.values()) siblings.sort((first, second) => first.name.localeCompare(second.name));

  const flattened: FlattenedMediaProject<T>[] = [];
  const visited = new Set<string>();
  const visit = (parentId: string | null, depth: number, ancestors: Set<string>) => {
    for (const project of children.get(parentId) ?? []) {
      if (visited.has(project.id) || ancestors.has(project.id)) continue;
      visited.add(project.id);
      flattened.push({ project, depth });
      const nextAncestors = new Set(ancestors);
      nextAncestors.add(project.id);
      visit(project.id, depth + 1, nextAncestors);
    }
  };
  visit(null, 0, new Set());

  // Keep malformed legacy cycles visible instead of silently dropping folders.
  for (const project of [...projects].sort((first, second) => first.name.localeCompare(second.name))) {
    if (visited.has(project.id)) continue;
    visited.add(project.id);
    flattened.push({ project, depth: 0 });
    visit(project.id, 1, new Set([project.id]));
  }
  return flattened;
}

export function descendantMediaProjectIds<T extends NestedMediaProject>(projects: T[], rootId: string): Set<string> {
  const descendants = new Set<string>();
  const children = new Map<string, T[]>();
  for (const project of projects) {
    if (project.parentId) children.set(project.parentId, [...(children.get(project.parentId) ?? []), project]);
  }
  const visit = (parentId: string) => {
    for (const project of children.get(parentId) ?? []) {
      if (descendants.has(project.id)) continue;
      descendants.add(project.id);
      visit(project.id);
    }
  };
  visit(rootId);
  return descendants;
}

export function mediaProjectOptionLabel(name: string, depth: number): string {
  return `${depth ? `${"— ".repeat(depth)}` : ""}${name}`;
}
