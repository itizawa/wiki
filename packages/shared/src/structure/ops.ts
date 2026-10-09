import { z } from "zod";
import { TREE_KEY_PATTERN } from "../slug";
import { isValidPosition } from "./position";

const id = z.string().min(1).max(64);
/** 省略時は兄弟の末尾に置く。 */
const position = z.string().max(64).refine(isValidPosition, "invalid position").optional();
const folderTitle = z.string().trim().min(1).max(200);

export const initialNodeSchema = z.object({
  nodeId: id.optional(),
  kind: z.enum(["page", "folder"]),
  pageId: id.optional(),
  title: folderTitle.optional(),
  parentNodeId: id.nullable(),
  position,
});

/**
 * 構造操作。AI提案（proposal_ops）と管理画面の手動操作で共通。
 * remove_node / delete_tree は設計書の一覧に無く、手動操作用に追加したもの。
 */
export const structureOpSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("move"),
    treeId: id,
    nodeId: id,
    newParentNodeId: id.nullable(),
    position,
  }),
  z.object({
    type: z.literal("rename_folder"),
    treeId: id,
    nodeId: id,
    title: folderTitle,
  }),
  z.object({
    type: z.literal("create_folder"),
    treeId: id,
    nodeId: id.optional(),
    title: folderTitle,
    parentNodeId: id.nullable(),
    position,
  }),
  z.object({
    type: z.literal("add_to_tree"),
    treeId: id,
    pageId: id,
    parentNodeId: id.nullable(),
    position,
  }),
  z.object({
    type: z.literal("create_tree"),
    treeId: id.optional(),
    treeKey: z.string().min(1).max(64).regex(TREE_KEY_PATTERN),
    name: z.string().trim().min(1).max(100),
    isPublic: z.boolean().optional(),
    initialNodes: z.array(initialNodeSchema).max(10_000).default([]),
  }),
  z.object({
    type: z.literal("split_folder"),
    treeId: id,
    nodeId: id,
    groups: z
      .array(z.object({ title: folderTitle, nodeIds: z.array(id).min(1) }))
      .min(1),
  }),
  z.object({
    type: z.literal("merge_candidate"),
    pageIds: z.array(id).min(2),
    intoPageId: id,
  }),
  z.object({
    type: z.literal("remove_node"),
    treeId: id,
    nodeId: id,
  }),
  z.object({
    type: z.literal("delete_tree"),
    treeId: id,
  }),
]);

export type StructureOp = z.infer<typeof structureOpSchema>;
export type StructureOpInput = z.input<typeof structureOpSchema>;
export type StructureOpType = StructureOp["type"];

export const commitStructureInput = z.object({
  branch: z.string().min(1).default("main"),
  /** 楽観ロック。ブランチのheadがこの値と一致する場合のみコミットする。 */
  expectedHeadCommitId: z.string().uuid(),
  message: z.string().max(500).optional(),
  ops: z.array(structureOpSchema).min(1).max(1000),
});
export type CommitStructureInput = z.infer<typeof commitStructureInput>;
