import { z } from "zod";
import { isValidPosition } from "./position";

const id = z.string().min(1).max(64);
/** 省略時は兄弟の末尾に置く。 */
const position = z.string().max(64).refine(isValidPosition, "invalid position").optional();

/**
 * 構造操作。管理画面の手動操作と、ルールからの配置提案で共通。
 * ツリーは1本だけなので、ツリー自体を作る・消す操作は無い。ノードはすべてページなので、フォルダの操作も無い。
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
    type: z.literal("add_to_tree"),
    treeId: id,
    pageId: id,
    parentNodeId: id.nullable(),
    position,
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
]);

export type StructureOp = z.infer<typeof structureOpSchema>;
export type StructureOpInput = z.input<typeof structureOpSchema>;
export type StructureOpType = StructureOp["type"];

export const commitStructureInput = z.object({
  /** 楽観ロック。headがこの値と一致する場合のみコミットする。 */
  expectedHeadCommitId: z.string().uuid(),
  message: z.string().max(500).optional(),
  ops: z.array(structureOpSchema).min(1).max(1000),
});
export type CommitStructureInput = z.infer<typeof commitStructureInput>;
