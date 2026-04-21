import { createLogger } from '@shared/utils/logger';
import { diffLines } from 'diff';
import { readFile } from 'fs/promises';
import * as path from 'path';

import type {
  FileChangeSummary,
  FileEditEvent,
  FileEditTimeline,
  SnippetDiff,
  TaskChangeScope,
  TaskChangeSetV2,
} from '@shared/types';

const logger = createLogger('Service:TaskChangeLedgerReader');

const TASK_CHANGE_LEDGER_SCHEMA_VERSION = 1;
const TASK_CHANGE_LEDGER_DIRNAME = '.board-task-changes';

type LedgerConfidence = 'exact' | 'high' | 'medium' | 'low' | 'ambiguous';

interface LedgerContentRef {
  sha256: string;
  sizeBytes: number;
  blobRef?: string;
  unavailableReason?: string;
}

interface LedgerContentState {
  exists?: boolean;
  sha256?: string;
  sizeBytes?: number;
  unavailableReason?: string;
}

interface LedgerChangeRelation {
  kind: 'rename' | 'copy';
  oldPath: string;
  newPath: string;
}

interface LedgerEvent {
  schemaVersion: typeof TASK_CHANGE_LEDGER_SCHEMA_VERSION;
  eventId: string;
  taskId: string;
  taskRef: string;
  taskRefKind: 'canonical' | 'display' | 'unknown';
  phase: 'work' | 'review';
  executionSeq: number;
  sessionId: string;
  agentId?: string;
  toolUseId: string;
  source:
    | 'file_edit'
    | 'file_write'
    | 'notebook_edit'
    | 'bash_simulated_sed'
    | 'shell_snapshot'
    | 'powershell_snapshot'
    | 'post_tool_hook_snapshot';
  operation: 'create' | 'modify' | 'delete';
  confidence: LedgerConfidence;
  workspaceRoot: string;
  filePath: string;
  relativePath: string;
  timestamp: string;
  toolStatus: 'succeeded' | 'failed' | 'killed' | 'backgrounded';
  before: LedgerContentRef | null;
  after: LedgerContentRef | null;
  beforeState?: LedgerContentState;
  afterState?: LedgerContentState;
  relation?: LedgerChangeRelation;
  oldString?: string;
  newString?: string;
  linesAdded?: number;
  linesRemoved?: number;
  replaceAll?: boolean;
  warnings?: string[];
}

interface LedgerNotice {
  schemaVersion: typeof TASK_CHANGE_LEDGER_SCHEMA_VERSION;
  noticeId: string;
  taskId: string;
  taskRef: string;
  taskRefKind: 'canonical' | 'display' | 'unknown';
  phase: 'work' | 'review';
  executionSeq: number;
  sessionId: string;
  agentId?: string;
  toolUseId: string;
  timestamp: string;
  severity: 'warning';
  message: string;
}

interface LedgerBundle {
  schemaVersion: typeof TASK_CHANGE_LEDGER_SCHEMA_VERSION;
  source: 'task-change-ledger';
  taskId: string;
  generatedAt: string;
  eventCount: number;
  files: {
    filePath: string;
    relativePath: string;
    eventIds: string[];
    linesAdded: number;
    linesRemoved: number;
    isNewFile: boolean;
    latestAfterHash: string | null;
  }[];
  totalLinesAdded: number;
  totalLinesRemoved: number;
  totalFiles: number;
  confidence: 'high' | 'medium' | 'low';
  warnings: string[];
  events: LedgerEvent[];
  notices?: LedgerNotice[];
}

export class TaskChangeLedgerReader {
  async readTaskChanges(params: {
    teamName: string;
    taskId: string;
    projectDir: string;
    projectPath?: string;
    includeDetails: boolean;
  }): Promise<TaskChangeSetV2 | null> {
    const bundle = await this.readBundle(params.projectDir, params.taskId);
    if (!bundle) {
      return null;
    }

    const events = bundle.events
      .filter((event) => event.taskId === params.taskId)
      .sort((a, b) => {
        const timeDiff = Date.parse(a.timestamp) - Date.parse(b.timestamp);
        return timeDiff === 0 ? a.eventId.localeCompare(b.eventId) : timeDiff;
      });
    const notices = (bundle.notices ?? [])
      .filter((notice) => notice.taskId === params.taskId)
      .sort((a, b) => {
        const timeDiff = Date.parse(a.timestamp) - Date.parse(b.timestamp);
        return timeDiff === 0 ? a.noticeId.localeCompare(b.noticeId) : timeDiff;
      });
    if (events.length === 0 && notices.length === 0) {
      return null;
    }

    const snippets = params.includeDetails
      ? await this.buildSnippets(params.projectDir, events)
      : [];
    const files = params.includeDetails
      ? this.aggregateByFile(snippets, params.projectPath, true)
      : this.buildSummaryFiles(bundle, params.projectPath);
    const scope = this.buildScope(params.taskId, events, files, notices);
    const warnings = new Set(bundle.warnings ?? []);
    for (const notice of notices) warnings.add(notice.message);
    for (const event of events) {
      for (const warning of event.warnings ?? []) warnings.add(warning);
      if (event.toolStatus === 'failed') {
        warnings.add(`Tool ${event.toolUseId} failed after changing files.`);
      }
      if (event.toolStatus === 'killed') {
        warnings.add(`Background tool ${event.toolUseId} was killed after changing files.`);
      }
    }

    return {
      teamName: params.teamName,
      taskId: params.taskId,
      files,
      totalLinesAdded: files.reduce((sum, file) => sum + file.linesAdded, 0),
      totalLinesRemoved: files.reduce((sum, file) => sum + file.linesRemoved, 0),
      totalFiles: files.length,
      confidence: bundle.confidence,
      computedAt: bundle.generatedAt,
      scope,
      warnings: [...warnings],
    };
  }

  private async readBundle(projectDir: string, taskId: string): Promise<LedgerBundle | null> {
    const bundlePath = path.join(
      projectDir,
      TASK_CHANGE_LEDGER_DIRNAME,
      'bundles',
      `${encodeURIComponent(taskId)}.json`
    );

    try {
      const raw = await readFile(bundlePath, 'utf8');
      const parsed = JSON.parse(raw) as LedgerBundle;
      if (
        parsed?.schemaVersion !== TASK_CHANGE_LEDGER_SCHEMA_VERSION ||
        parsed.source !== 'task-change-ledger' ||
        parsed.taskId !== taskId ||
        !Array.isArray(parsed.events)
      ) {
        return null;
      }
      return parsed;
    } catch (error) {
      logger.debug(`No task-change ledger bundle for ${taskId}: ${String(error)}`);
      return null;
    }
  }

  private async buildSnippets(projectDir: string, events: LedgerEvent[]): Promise<SnippetDiff[]> {
    return Promise.all(
      events.map(async (event) => {
        const beforeContent = await this.readContentRef(projectDir, event.before);
        const afterContent = await this.readContentRef(projectDir, event.after);
        return this.eventToSnippet(event, beforeContent, afterContent);
      })
    );
  }

  private async readContentRef(
    projectDir: string,
    ref: LedgerContentRef | null
  ): Promise<string | null> {
    if (!ref?.blobRef) {
      return null;
    }
    try {
      return await readFile(
        path.join(projectDir, TASK_CHANGE_LEDGER_DIRNAME, 'blobs', ref.blobRef),
        'utf8'
      );
    } catch {
      return null;
    }
  }

  private eventToSnippet(
    event: LedgerEvent,
    beforeContent: string | null,
    afterContent: string | null
  ): SnippetDiff {
    const toolName = this.mapToolName(event.source);
    const type = this.mapSnippetType(event);
    const source = event.confidence === 'exact' ? 'ledger-exact' : 'ledger-snapshot';
    return {
      toolUseId: event.toolUseId,
      filePath: event.filePath,
      toolName,
      type,
      oldString: event.oldString ?? beforeContent ?? '',
      newString: event.newString ?? afterContent ?? '',
      replaceAll: event.replaceAll ?? false,
      timestamp: event.timestamp,
      isError: false,
      ledger: {
        eventId: event.eventId,
        source,
        confidence: event.confidence,
        originalFullContent: beforeContent,
        modifiedFullContent: afterContent,
        beforeHash: event.before?.sha256 ?? null,
        afterHash: event.after?.sha256 ?? null,
        operation: event.operation,
        beforeState: event.beforeState,
        afterState: event.afterState,
        relation: event.relation,
        executionSeq: event.executionSeq,
      },
    };
  }

  private mapToolName(eventSource: LedgerEvent['source']): SnippetDiff['toolName'] {
    switch (eventSource) {
      case 'file_edit':
        return 'Edit';
      case 'file_write':
        return 'Write';
      case 'notebook_edit':
        return 'NotebookEdit';
      case 'bash_simulated_sed':
      case 'shell_snapshot':
        return 'Bash';
      case 'powershell_snapshot':
        return 'PowerShell';
      case 'post_tool_hook_snapshot':
        return 'PostToolUse';
    }
  }

  private mapSnippetType(event: LedgerEvent): SnippetDiff['type'] {
    if (event.source === 'file_write') {
      return event.operation === 'create' ? 'write-new' : 'write-update';
    }
    if (event.source === 'notebook_edit') {
      return 'notebook-edit';
    }
    if (event.source === 'shell_snapshot' || event.source === 'powershell_snapshot') {
      return 'shell-snapshot';
    }
    if (event.source === 'post_tool_hook_snapshot') {
      return 'hook-snapshot';
    }
    return 'edit';
  }

  private aggregateByFile(
    snippets: SnippetDiff[],
    projectPath: string | undefined,
    includeDetails: boolean
  ): FileChangeSummary[] {
    const fileMap = new Map<
      string,
      { filePath: string; snippets: SnippetDiff[]; isNewFile: boolean }
    >();
    for (const snippet of snippets) {
      const key = this.fileGroupKey(snippet);
      const existing = fileMap.get(key);
      if (existing) {
        existing.snippets.push(snippet);
        existing.isNewFile ||=
          snippet.type === 'write-new' || snippet.ledger?.operation === 'create';
      } else {
        fileMap.set(key, {
          filePath: snippet.filePath,
          snippets: [snippet],
          isNewFile: snippet.type === 'write-new' || snippet.ledger?.operation === 'create',
        });
      }
    }

    return [...fileMap.values()].map((entry) => {
      let linesAdded = 0;
      let linesRemoved = 0;
      for (const snippet of entry.snippets) {
        const { added, removed } = this.countLineChanges(snippet.oldString, snippet.newString);
        linesAdded += added;
        linesRemoved += removed;
      }

      const displayFilePath = this.displayFilePathForGroup(entry);
      const relation = this.relationForSnippets(entry.snippets);
      return {
        filePath: displayFilePath,
        relativePath: this.relativePath(displayFilePath, projectPath),
        snippets: includeDetails ? entry.snippets : [],
        linesAdded,
        linesRemoved,
        isNewFile: relation?.kind === 'rename' ? false : entry.isNewFile,
        timeline: includeDetails ? this.buildTimeline(displayFilePath, entry.snippets) : undefined,
      };
    });
  }

  private buildSummaryFiles(
    bundle: LedgerBundle,
    projectPath: string | undefined
  ): FileChangeSummary[] {
    const eventById = new Map(bundle.events.map((event) => [event.eventId, event]));
    const fileMap = new Map<
      string,
      {
        filePath: string;
        filePaths: string[];
        linesAdded: number;
        linesRemoved: number;
        isNewFile: boolean;
        relation?: LedgerChangeRelation;
      }
    >();

    for (const file of bundle.files) {
      const relation = file.eventIds
        .map((eventId) => eventById.get(eventId)?.relation)
        .find((value): value is LedgerChangeRelation => Boolean(value));
      const key = relation
        ? `relation:${relation.kind}:${this.normalizePathKey(relation.oldPath)}:${this.normalizePathKey(relation.newPath)}`
        : this.normalizePathKey(file.filePath);
      const displayFilePath = relation?.newPath ?? file.filePath;
      const existing = fileMap.get(key);
      if (existing) {
        existing.filePaths.push(file.filePath);
        existing.filePath = relation
          ? this.displayFilePathForRelation(relation, existing.filePaths)
          : existing.filePath;
        existing.linesAdded += file.linesAdded;
        existing.linesRemoved += file.linesRemoved;
        existing.isNewFile ||= file.isNewFile;
        existing.relation ??= relation;
      } else {
        fileMap.set(key, {
          filePath: relation
            ? this.displayFilePathForRelation(relation, [file.filePath])
            : displayFilePath,
          filePaths: [file.filePath],
          linesAdded: file.linesAdded,
          linesRemoved: file.linesRemoved,
          isNewFile: file.isNewFile,
          relation,
        });
      }
    }

    return [...fileMap.values()].map((file) => ({
      filePath: file.filePath,
      relativePath: this.relativePath(file.filePath, projectPath),
      snippets: [],
      linesAdded: file.linesAdded,
      linesRemoved: file.linesRemoved,
      isNewFile: file.relation?.kind === 'rename' ? false : file.isNewFile,
    }));
  }

  private buildScope(
    taskId: string,
    events: LedgerEvent[],
    files: FileChangeSummary[],
    notices: LedgerNotice[] = []
  ): TaskChangeScope {
    const first = events[0];
    const last = events[events.length - 1];
    const firstNotice = notices[0];
    const lastNotice = notices[notices.length - 1];
    const worstConfidence = events.some((event) => event.confidence !== 'exact') ? 2 : 1;
    return {
      taskId,
      memberName: first?.agentId ?? firstNotice?.agentId ?? '',
      startLine: 0,
      endLine: 0,
      startTimestamp: first?.timestamp ?? firstNotice?.timestamp ?? new Date().toISOString(),
      endTimestamp:
        last?.timestamp ??
        first?.timestamp ??
        lastNotice?.timestamp ??
        firstNotice?.timestamp ??
        new Date().toISOString(),
      toolUseIds: [
        ...new Set([
          ...events.map((event) => event.toolUseId),
          ...notices.map((notice) => notice.toolUseId),
        ]),
      ],
      filePaths: files.map((file) => file.filePath),
      confidence: {
        tier: worstConfidence,
        label: worstConfidence === 1 ? 'high' : 'medium',
        reason: 'Scoped by orchestrator task-change ledger',
      },
    };
  }

  private buildTimeline(filePath: string, snippets: SnippetDiff[]): FileEditTimeline {
    const events: FileEditEvent[] = snippets.map((snippet, index) => {
      const { added, removed } = this.countLineChanges(snippet.oldString, snippet.newString);
      return {
        toolUseId: snippet.toolUseId,
        toolName: snippet.toolName,
        timestamp: snippet.timestamp,
        summary: this.summaryForSnippet(snippet, added, removed),
        linesAdded: added,
        linesRemoved: removed,
        snippetIndex: index,
      };
    });
    const firstMs = Date.parse(events[0]?.timestamp ?? '');
    const lastMs = Date.parse(events[events.length - 1]?.timestamp ?? '');
    return {
      filePath,
      events,
      durationMs:
        Number.isFinite(firstMs) && Number.isFinite(lastMs) ? Math.max(0, lastMs - firstMs) : 0,
    };
  }

  private summaryForSnippet(snippet: SnippetDiff, added: number, removed: number): string {
    if (snippet.type === 'write-new') return `Created file (${added} lines)`;
    if (snippet.type === 'write-update') return `Rewrote file (+${added}/-${removed})`;
    if (snippet.type === 'shell-snapshot') {
      return `${snippet.toolName === 'PowerShell' ? 'PowerShell' : 'Shell'} changed file (+${added}/-${removed})`;
    }
    if (snippet.type === 'hook-snapshot') return `Hook changed file (+${added}/-${removed})`;
    if (snippet.type === 'notebook-edit') return `Edited notebook (+${added}/-${removed})`;
    return `Edited file (+${added}/-${removed})`;
  }

  private countLineChanges(before: string, after: string): { added: number; removed: number } {
    let added = 0;
    let removed = 0;
    for (const change of diffLines(before, after)) {
      if (change.added) added += change.count ?? 0;
      if (change.removed) removed += change.count ?? 0;
    }
    return { added, removed };
  }

  private normalizePathKey(filePath: string): string {
    return path.normalize(filePath).toLowerCase();
  }

  private fileGroupKey(snippet: SnippetDiff): string {
    const relation = snippet.ledger?.relation;
    if (relation) {
      return `relation:${relation.kind}:${this.normalizePathKey(relation.oldPath)}:${this.normalizePathKey(relation.newPath)}`;
    }
    return this.normalizePathKey(snippet.filePath);
  }

  private displayFilePathForGroup(entry: { filePath: string; snippets: SnippetDiff[] }): string {
    const relation = this.relationForSnippets(entry.snippets);
    if (!relation) {
      return entry.filePath;
    }
    return this.displayFilePathForRelation(
      relation,
      entry.snippets.map((snippet) => snippet.filePath)
    );
  }

  private relationForSnippets(snippets: SnippetDiff[]): LedgerChangeRelation | undefined {
    return snippets.find((snippet) => snippet.ledger?.relation)?.ledger?.relation;
  }

  private displayFilePathForRelation(relation: LedgerChangeRelation, filePaths: string[]): string {
    const expected = relation.newPath.replace(/\\/g, '/');
    const match = filePaths.find((filePath) => {
      const normalized = filePath.replace(/\\/g, '/');
      return normalized === expected || normalized.endsWith(`/${expected}`);
    });
    return match ?? relation.newPath;
  }

  private relativePath(filePath: string, projectPath?: string): string {
    const normalizedFilePath = filePath.replace(/\\/g, '/');
    const normalizedProjectPath = projectPath?.replace(/\\/g, '/');
    if (normalizedProjectPath && normalizedFilePath.startsWith(normalizedProjectPath + '/')) {
      return normalizedFilePath.slice(normalizedProjectPath.length + 1);
    }
    return normalizedFilePath.split('/').slice(-3).join('/');
  }
}
