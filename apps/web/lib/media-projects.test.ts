import assert from "node:assert/strict";
import test from "node:test";

import { descendantMediaProjectIds, flattenMediaProjects, mediaProjectOptionLabel } from "./media-projects.ts";

test("flattens media folders into a stable nested tree", () => {
  const projects = [
    { id: "root-b", name: "Second root" },
    { id: "child", name: "Child folder", parentId: "root-a" },
    { id: "root-a", name: "First root" },
    { id: "grandchild", name: "Deep folder", parentId: "child" },
  ];

  assert.deepEqual(
    flattenMediaProjects(projects).map(({ project, depth }) => [project.id, depth]),
    [["root-a", 0], ["child", 1], ["grandchild", 2], ["root-b", 0]],
  );
  assert.equal(mediaProjectOptionLabel("Deep folder", 2), "— — Deep folder");
});

test("finds every descendant so folder moves cannot create cycles", () => {
  const projects = [
    { id: "root", name: "Root" },
    { id: "child", name: "Child", parentId: "root" },
    { id: "grandchild", name: "Grandchild", parentId: "child" },
    { id: "other", name: "Other" },
  ];

  assert.deepEqual(descendantMediaProjectIds(projects, "root"), new Set(["child", "grandchild"]));
});
