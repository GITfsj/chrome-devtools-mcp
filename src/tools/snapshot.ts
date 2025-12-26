/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {zod} from '../third_party/index.js';

import {ToolCategory} from './categories.js';
import {defineTool, timeoutSchema} from './ToolDefinition.js';
import type {
  McpContext,
  TextSnapshot,
  TextSnapshotNode,
} from '../McpContext.js';

export const takeSnapshot = defineTool({
  name: 'take_snapshot',
  description: `Take a text snapshot of the currently selected page based on the a11y tree. The snapshot lists page elements along with a unique
identifier (uid). Always use the latest snapshot. Prefer taking a snapshot over taking a screenshot. The snapshot indicates the element selected
in the DevTools Elements panel (if any).`,
  annotations: {
    category: ToolCategory.DEBUGGING,
    // Not read-only due to filePath param.
    readOnlyHint: false,
  },
  schema: {
    verbose: zod
      .boolean()
      .optional()
      .describe(
        'Whether to include all possible information available in the full a11y tree. Default is false.',
      ),
    filePath: zod
      .string()
      .optional()
      .describe(
        'The absolute path, or a path relative to the current working directory, to save the snapshot to instead of attaching it to the response.',
      ),
    skipRoles: zod
      .array(zod.string())
      .optional()
      .describe(
        'Array of role names to skip in the snapshot (e.g., ["img", "image"] to skip image elements). Default skips image and img roles.',
      ),
  },
  handler: async (request, response) => {
    response.includeSnapshot({
      verbose: request.params.verbose ?? false,
      filePath: request.params.filePath,
      skipRoles: request.params.skipRoles ?? ['image', 'img'],
    });
  },
});

type SnapshotDiffType = 'added' | 'removed' | 'changed';

interface SnapshotAttributeChange {
  name: string;
  before: unknown;
  after: unknown;
}

interface SnapshotDiffEntry {
  type: SnapshotDiffType;
  path: string;
  oldUid?: string;
  newUid?: string;
  changes?: SnapshotAttributeChange[];
}

interface InternalDiffOptions {
  skipRoles: Set<string>;
  verbose: boolean;
  maxChanges: number;
}

function createInternalDiffOptions(
  skipRoles: string[] | undefined,
  maxChanges: number | undefined,
  verbose: boolean,
): InternalDiffOptions {
  const normalizedSkipRoles = new Set(
    (skipRoles ?? ['image', 'img']).map(role => role.toLowerCase()),
  );
  const effectiveMaxChanges = maxChanges && maxChanges > 0 ? maxChanges : 50;

  return {
    skipRoles: normalizedSkipRoles,
    verbose,
    maxChanges: effectiveMaxChanges,
  };
}

function isRoleSkipped(
  node: TextSnapshotNode,
  options: InternalDiffOptions,
): boolean {
  const role = node.role?.toLowerCase();
  if (!role) {
    return false;
  }
  return options.skipRoles.has(role);
}

function getNodeMatchKey(node: TextSnapshotNode): string {
  const role = (node.role ?? '').toLowerCase();
  const name =
    typeof node.name === 'string' ? node.name.trim().toLowerCase() : '';
  const value =
    typeof node.value === 'string' || typeof node.value === 'number'
      ? String(node.value)
      : '';
  return `${role}|${name}|${value}`;
}

function buildPathFromNodes(nodes: TextSnapshotNode[]): string {
  const labels = nodes.map(node => {
    const role = node.role && node.role !== 'none' ? node.role : 'node';
    const name =
      typeof node.name === 'string' && node.name.trim()
        ? ` "${node.name.toString().trim().slice(0, 80)}"`
        : '';
    return `${role}${name}`;
  });
  return labels.join(' > ');
}

function buildPathString(
  ancestors: TextSnapshotNode[],
  node: TextSnapshotNode,
): string {
  return buildPathFromNodes([...ancestors, node]);
}

function collectAttributeChanges(
  previous: TextSnapshotNode,
  current: TextSnapshotNode,
  options: InternalDiffOptions,
): SnapshotAttributeChange[] {
  const excluded = new Set([
    'children',
    'id',
    'backendNodeId',
    'elementHandle',
  ]);

  const baseInteresting = [
    'role',
    'name',
    'value',
    'description',
    'checked',
    'pressed',
    'expanded',
    'selected',
    'focused',
    'disabled',
    'hidden',
    'level',
  ];

  const extraVerbose = [
    'autocomplete',
    'placeholder',
    'multiselectable',
    'required',
    'invalid',
  ];

  const interesting = new Set(
    options.verbose ? [...baseInteresting, ...extraVerbose] : baseInteresting,
  );

  const keys = new Set<string>();
  for (const key of Object.keys(previous)) {
    if (!excluded.has(key) && interesting.has(key)) {
      keys.add(key);
    }
  }
  for (const key of Object.keys(current)) {
    if (!excluded.has(key) && interesting.has(key)) {
      keys.add(key);
    }
  }

  const changes: SnapshotAttributeChange[] = [];
  for (const key of keys) {
    const before =
      (previous as unknown as Record<string, unknown>)[key];
    const after = (current as unknown as Record<string, unknown>)[key];

    if (before === after) {
      continue;
    }
    const beforeString =
      typeof before === 'object' && before !== null
        ? JSON.stringify(before)
        : before;
    const afterString =
      typeof after === 'object' && after !== null
        ? JSON.stringify(after)
        : after;

    if (beforeString === afterString) {
      continue;
    }

    changes.push({name: key, before, after});
  }

  return changes;
}

function diffSnapshots(
  previous: TextSnapshot,
  current: TextSnapshot,
  options: InternalDiffOptions,
): {entries: SnapshotDiffEntry[]; truncated: boolean} {
  const entries: SnapshotDiffEntry[] = [];
  let truncated = false;

  const ensureCapacity = () => {
    if (entries.length >= options.maxChanges) {
      truncated = true;
      return true;
    }
    return false;
  };

  const visit = (
    prevNode: TextSnapshotNode,
    currNode: TextSnapshotNode,
    ancestors: TextSnapshotNode[],
  ): void => {
    if (ensureCapacity()) {
      return;
    }

    if (
      isRoleSkipped(prevNode, options) &&
      isRoleSkipped(currNode, options)
    ) {
      return;
    }

    const changes = collectAttributeChanges(prevNode, currNode, options);
    if (changes.length) {
      entries.push({
        type: 'changed',
        path: buildPathString(ancestors, currNode),
        oldUid: prevNode.id,
        newUid: currNode.id,
        changes,
      });
      if (ensureCapacity()) {
        return;
      }
    }

    const prevChildren = prevNode.children.filter(
      child => !isRoleSkipped(child, options),
    );
    const currChildren = currNode.children.filter(
      child => !isRoleSkipped(child, options),
    );

    const prevByKey = new Map<string, TextSnapshotNode[]>();
    for (const child of prevChildren) {
      const key = getNodeMatchKey(child);
      const list = prevByKey.get(key);
      if (list) {
        list.push(child);
      } else {
        prevByKey.set(key, [child]);
      }
    }

    const currByKey = new Map<string, TextSnapshotNode[]>();
    for (const child of currChildren) {
      const key = getNodeMatchKey(child);
      const list = currByKey.get(key);
      if (list) {
        list.push(child);
      } else {
        currByKey.set(key, [child]);
      }
    }

    const allKeys = new Set<string>([
      ...prevByKey.keys(),
      ...currByKey.keys(),
    ]);

    for (const key of allKeys) {
      if (ensureCapacity()) {
        return;
      }
      const prevList = prevByKey.get(key) ?? [];
      const currList = currByKey.get(key) ?? [];
      const common = Math.min(prevList.length, currList.length);

      for (let i = 0; i < common; i++) {
        visit(prevList[i], currList[i], [...ancestors, currNode]);
        if (ensureCapacity()) {
          return;
        }
      }

      if (prevList.length > common) {
        for (let i = common; i < prevList.length; i++) {
          if (ensureCapacity()) {
            return;
          }
          const node = prevList[i];
          entries.push({
            type: 'removed',
            path: buildPathString([...ancestors, currNode], node),
            oldUid: node.id,
          });
        }
      }

      if (currList.length > common) {
        for (let i = common; i < currList.length; i++) {
          if (ensureCapacity()) {
            return;
          }
          const node = currList[i];
          entries.push({
            type: 'added',
            path: buildPathString([...ancestors, currNode], node),
            newUid: node.id,
          });
        }
      }
    }
  };

  visit(previous.root, current.root, []);

  return {entries, truncated};
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) {
    return '<none>';
  }
  if (typeof value === 'string') {
    return `"${value}"`;
  }
  return String(value);
}

function findPathByUid(
  snapshot: TextSnapshot,
  uid: string | undefined,
): string | undefined {
  if (!uid) {
    return;
  }
  const target = snapshot.idToNode.get(uid);
  if (!target) {
    return;
  }

  let result: string | undefined;
  const dfs = (
    node: TextSnapshotNode,
    ancestors: TextSnapshotNode[],
  ) => {
    if (result) {
      return;
    }
    if (node.id === uid) {
      result = buildPathFromNodes([...ancestors, node]);
      return;
    }
    for (const child of node.children) {
      dfs(child, [...ancestors, node]);
      if (result) {
        return;
      }
    }
  };

  dfs(snapshot.root, []);
  return result;
}

export const takeSnapshotDiff = defineTool({
  name: 'take_snapshot_diff',
  description: `Take a new text snapshot of the currently selected page and compute a high-signal diff against the previous snapshot. This is useful for understanding what changed on the page between two consecutive states.`,
  annotations: {
    category: ToolCategory.DEBUGGING,
    readOnlyHint: true,
  },
  schema: {
    verbose: zod
      .boolean()
      .optional()
      .describe(
        'Whether to include more attributes in the diff output. Default is false (summary).',
      ),
    skipRoles: zod
      .array(zod.string())
      .optional()
      .describe(
        'Array of role names to skip when diffing (e.g., ["img", "image"] to ignore images). Default skips image and img roles.',
      ),
    maxChanges: zod
      .number()
      .int()
      .optional()
      .describe(
        'Maximum number of changes to include in the diff. Default is 50 to keep the diff focused.',
      ),
  },
  handler: async (request, response, context) => {
    const verbose = request.params.verbose ?? false;
    const options = createInternalDiffOptions(
      request.params.skipRoles,
      request.params.maxChanges,
      verbose,
    );
    const mcpContext = context as McpContext;

    const previousSnapshot = mcpContext.getTextSnapshot();

    const devToolsData = await mcpContext.getDevToolsData();
    await mcpContext.createTextSnapshot(verbose, devToolsData);
    const currentSnapshot = mcpContext.getTextSnapshot();

    if (!currentSnapshot) {
      response.appendResponseLine(
        'No accessibility snapshot is available for the current page.',
      );
      return;
    }

    if (!previousSnapshot) {
      response.appendResponseLine(
        'No previous snapshot found. Captured the first snapshot; run take_snapshot_diff again after the page changes to see a diff.',
      );
      return;
    }

    const {entries, truncated} = diffSnapshots(
      previousSnapshot,
      currentSnapshot,
      options,
    );

    if (!entries.length) {
      response.appendResponseLine(
        'No meaningful differences detected between the last two snapshots (within the current filters).',
      );
      return;
    }

    response.appendResponseLine('## Snapshot diff');

    const selectionChanged =
      previousSnapshot.selectedElementUid !==
      currentSnapshot.selectedElementUid;

    if (selectionChanged) {
      const previousPath = findPathByUid(
        previousSnapshot,
        previousSnapshot.selectedElementUid,
      );
      const currentPath = findPathByUid(
        currentSnapshot,
        currentSnapshot.selectedElementUid,
      );
      response.appendResponseLine('### DevTools selection');
      response.appendResponseLine(
        `Selection in the DevTools Elements panel changed:`,
      );
      response.appendResponseLine(
        `- Before: ${
          previousPath ?? previousSnapshot.selectedElementUid ?? '<none>'
        }`,
      );
      response.appendResponseLine(
        `- After: ${
          currentPath ?? currentSnapshot.selectedElementUid ?? '<none>'
        }`,
      );
    }

    const changed = entries.filter(entry => entry.type === 'changed');
    const added = entries.filter(entry => entry.type === 'added');
    const removed = entries.filter(entry => entry.type === 'removed');

    const totalReported = entries.length;

    response.appendResponseLine(
      `Detected ${totalReported} change${
        totalReported === 1 ? '' : 's'
      } between snapshots (showing up to ${options.maxChanges}).`,
    );

    if (changed.length) {
      response.appendResponseLine('### Attribute changes');
      for (const entry of changed) {
        const changesSummary =
          entry.changes
            ?.map(
              change =>
                `${change.name}: ${formatValue(
                  change.before,
                )} -> ${formatValue(change.after)}`,
            )
            .join('; ') ?? '';
        response.appendResponseLine(
          `- ${entry.path} (${entry.oldUid} -> ${entry.newUid}): ${changesSummary}`,
        );
      }
    }

    if (added.length) {
      response.appendResponseLine('### Added elements');
      for (const entry of added) {
        response.appendResponseLine(
          `- ${entry.path} (${entry.newUid})`,
        );
      }
    }

    if (removed.length) {
      response.appendResponseLine('### Removed elements');
      for (const entry of removed) {
        response.appendResponseLine(
          `- ${entry.path} (${entry.oldUid})`,
        );
      }
    }

    if (truncated) {
      response.appendResponseLine(
        `Diff output truncated to ${options.maxChanges} changes. You can increase maxChanges if you need more detail.`,
      );
    }
  },
});

export const waitFor = defineTool({
  name: 'wait_for',
  description: `Wait for the specified text to appear on the selected page.`,
  annotations: {
    category: ToolCategory.NAVIGATION,
    readOnlyHint: true,
  },
  schema: {
    text: zod.string().describe('Text to appear on the page'),
    ...timeoutSchema,
  },
  handler: async (request, response, context) => {
    await context.waitForTextOnPage(request.params);

    response.appendResponseLine(
      `Element with text "${request.params.text}" found.`,
    );

    response.includeSnapshot();
  },
});
