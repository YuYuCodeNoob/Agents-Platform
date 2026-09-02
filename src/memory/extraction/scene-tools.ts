import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve, basename } from 'path';
import { sep } from 'path';
import type { ToolDefinition } from './tool-loop-runner.js';

function resolveSandboxedPath(workspaceDir: string, relativePath: string): string {
  const clean = basename(relativePath.replace(/\.\.\//g, '').replace(/\\/g, '/'));
  const resolved = resolve(workspaceDir, clean);
  const normalizedWorkspace = resolve(workspaceDir);
  if (!resolved.startsWith(normalizedWorkspace + sep) && resolved !== normalizedWorkspace) {
    throw new Error(`Path escapes workspace: ${relativePath}`);
  }
  return resolved;
}

export function createReadTool(workspaceDir: string): ToolDefinition {
  return {
    name: 'read',
    description: 'Read the contents of a file at the given relative path within the workspace.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path to read.' },
      },
      required: ['path'],
    },
    execute: async (args) => {
      const filePath = resolveSandboxedPath(workspaceDir, args.path as string);
      if (!existsSync(filePath)) {
        return `Error: file not found: ${args.path}`;
      }
      const content = await readFile(filePath, 'utf-8');
      return content;
    },
  };
}

export function createWriteTool(workspaceDir: string): ToolDefinition {
  return {
    name: 'write',
    description: 'Write content to a file at the given relative path. Creates or overwrites.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path to write.' },
        content: { type: 'string', description: 'Full file content.' },
      },
      required: ['path', 'content'],
    },
    execute: async (args) => {
      const filePath = resolveSandboxedPath(workspaceDir, args.path as string);
      await mkdir(join(filePath, '..'), { recursive: true });
      await writeFile(filePath, args.content as string, 'utf-8');
      return `File written: ${args.path}`;
    },
  };
}

export function createEditTool(workspaceDir: string): ToolDefinition {
  return {
    name: 'edit',
    description: 'Apply one or more text replacements to a file. Each edit replaces an exact substring.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path to edit.' },
        edits: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              oldText: { type: 'string' },
              newText: { type: 'string' },
            },
            required: ['oldText', 'newText'],
          },
        },
      },
      required: ['path', 'edits'],
    },
    execute: async (args) => {
      const filePath = resolveSandboxedPath(workspaceDir, args.path as string);
      if (!existsSync(filePath)) {
        return `Error: file not found: ${args.path}`;
      }
      let content = await readFile(filePath, 'utf-8');
      const edits = args.edits as Array<{ oldText: string; newText: string }>;
      for (const edit of edits) {
        if (!content.includes(edit.oldText)) {
          return `Error: oldText not found in ${args.path}: "${edit.oldText.slice(0, 80)}..."`;
        }
        content = content.replace(edit.oldText, edit.newText);
      }
      await writeFile(filePath, content, 'utf-8');
      return `File edited: ${args.path} (${edits.length} edits applied)`;
    },
  };
}

export function createSceneTools(workspaceDir: string): ToolDefinition[] {
  return [
    createReadTool(workspaceDir),
    createWriteTool(workspaceDir),
    createEditTool(workspaceDir),
  ];
}
