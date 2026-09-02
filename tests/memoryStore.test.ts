import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { JsonlStore } from '../src/memory/jsonlStore.js';
import { MarkdownStore } from '../src/memory/markdownStore.js';
import { rmSync, mkdirSync } from 'fs';
import { join } from 'path';

const TEST_DIR = './data/test_tmp';

describe('JsonlStore', () => {
  const store = new JsonlStore(join(TEST_DIR, 'messages'));

  beforeAll(() => {
    mkdirSync(join(TEST_DIR, 'messages'), { recursive: true });
  });

  afterAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  test('saves and reads messages', async () => {
    await store.save({
      agentId: 'test_agent',
      role: 'user',
      content: 'Hello world',
      timestamp: Date.now(),
    });

    const messages = await store.readAll('test_agent');
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('Hello world');
  });

  test('searches messages by content', async () => {
    await store.save({
      agentId: 'test_agent',
      role: 'assistant',
      content: 'The auth module needs refactoring',
      timestamp: Date.now(),
    });

    const results = await store.search('auth');
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.content.includes('auth'))).toBe(true);
  });
});

describe('MarkdownStore', () => {
  const store = new MarkdownStore(join(TEST_DIR, 'skills'), join(TEST_DIR, 'personality'));

  beforeAll(() => {
    mkdirSync(join(TEST_DIR, 'skills'), { recursive: true });
    mkdirSync(join(TEST_DIR, 'personality'), { recursive: true });
  });

  afterAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  test('saves and searches skills', async () => {
    await store.saveSkill({
      name: 'code-review',
      agentId: 'test_agent',
      filePath: 'code-review.md',
      content: '# Code Review Skill\n\nReview code for best practices.',
    });

    const results = await store.searchSkills('review');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].layer).toBe('skill');
  });

  test('saves and searches personality', async () => {
    await store.savePersonality({
      agentId: 'test_agent',
      filePath: 'test_agent.md',
      content: '# Personality\n\nPrefers concise code, likes TypeScript.',
    });

    const results = await store.searchPersonality('concise');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].layer).toBe('personality');
  });
});
