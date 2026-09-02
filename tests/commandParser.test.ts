import { describe, test, expect } from 'vitest';
import { parseCommand } from '../src/im/commandParser.js';

describe('IM Command Parser', () => {
  test('parses steer command with @ mention', () => {
    const cmd = parseCommand({ text: '@claude-code 重构auth模块', fromUser: 'user', timestamp: 0 });
    expect(cmd.action).toBe('steer');
    expect(cmd.targetAgent).toBe('claude-code');
    expect(cmd.body).toBe('重构auth模块');
  });

  test('parses steer command without @', () => {
    const cmd = parseCommand({ text: 'codex: fix the bug', fromUser: 'user', timestamp: 0 });
    expect(cmd.action).toBe('steer');
    expect(cmd.targetAgent).toBe('codex');
    expect(cmd.body).toBe('fix the bug');
  });

  test('parses status command', () => {
    const cmd = parseCommand({ text: 'status', fromUser: 'user', timestamp: 0 });
    expect(cmd.action).toBe('status');
  });

  test('parses memory query command', () => {
    const cmd = parseCommand({ text: 'memory query 认证逻辑', fromUser: 'user', timestamp: 0 });
    expect(cmd.action).toBe('memory');
    expect(cmd.query).toBe('认证逻辑');
  });

  test('parses stop command', () => {
    const cmd = parseCommand({ text: 'stop codex', fromUser: 'user', timestamp: 0 });
    expect(cmd.action).toBe('stop');
    expect(cmd.targetAgent).toBe('codex');
  });

  test('returns unknown for unrecognized commands', () => {
    const cmd = parseCommand({ text: 'random gibberish', fromUser: 'user', timestamp: 0 });
    expect(cmd.action).toBe('unknown');
  });
});
