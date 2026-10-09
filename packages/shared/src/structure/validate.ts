import type { TreeState } from "./types";

export type ValidationIssue = {
  treeId: string;
  nodeId?: string;
  code:
    | "duplicate_node"
    | "duplicate_page"
    | "invalid_page_node"
    | "orphan"
    | "cycle";
  message: string;
};

/** 循環・孤児・重複などを検出する。マージ後・コミット前に必ず通す。 */
export function validateTree(tree: TreeState): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (code: ValidationIssue["code"], message: string, nodeId?: string) =>
    issues.push({ treeId: tree.treeId, nodeId, code, message });

  const byId = new Map<string, (typeof tree.nodes)[number]>();
  const pages = new Set<string>();
  for (const n of tree.nodes) {
    if (byId.has(n.nodeId)) add("duplicate_node", `node ${n.nodeId} appears twice`, n.nodeId);
    byId.set(n.nodeId, n);
    if (!n.pageId || n.nodeId !== n.pageId) add("invalid_page_node", "node must have nodeId = pageId", n.nodeId);
    if (n.pageId) {
      if (pages.has(n.pageId)) add("duplicate_page", `page ${n.pageId} appears twice`, n.nodeId);
      pages.add(n.pageId);
    }
  }

  for (const n of byId.values()) {
    if (n.parentNodeId !== null && !byId.has(n.parentNodeId)) {
      add("orphan", `parent ${n.parentNodeId} of ${n.nodeId} does not exist`, n.nodeId);
    }
  }

  // 循環検出：各ノードから根まで辿り、自分に戻るか確認
  const ok = new Set<string>();
  for (const start of byId.values()) {
    const path = new Set<string>();
    let cur: string | null = start.nodeId;
    while (cur !== null && !ok.has(cur)) {
      if (path.has(cur)) {
        add("cycle", `cycle detected at ${start.nodeId}`, start.nodeId);
        break;
      }
      path.add(cur);
      cur = byId.get(cur)?.parentNodeId ?? null;
    }
    if (cur === null || ok.has(cur)) for (const p of path) ok.add(p);
  }

  return issues;
}
