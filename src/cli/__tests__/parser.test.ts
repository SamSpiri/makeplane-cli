import { describe, it, expect } from 'vitest';
import { parse } from '../parser.js';

describe('parse', () => {
  it('defaults to help when no args', () => {
    const result = parse([]);
    expect(result.command).toBe('help');
  });

  it('parses simple command', () => {
    const result = parse(['projects']);
    expect(result.command).toBe('projects');
    expect(result.subcommand).toBeUndefined();
  });

  it('parses flags', () => {
    const result = parse(['list', '--project', 'CORE', '--json']);
    expect(result.command).toBe('list');
    expect(result.flags.project).toBe('CORE');
    expect(result.flags.json).toBe(true);
  });

  it('parses short flags', () => {
    const result = parse(['list', '-p', 'CORE', '-q']);
    expect(result.flags.project).toBe('CORE');
    expect(result.flags.quiet).toBe(true);
  });

  it('parses --no-color', () => {
    const result = parse(['list', '--no-color']);
    expect(result.flags['no-color']).toBe(true);
  });

  it('parses positionals after command', () => {
    const result = parse(['show', 'PROJ-42']);
    expect(result.command).toBe('show');
    expect(result.positional).toEqual(['PROJ-42']);
  });

  it('parses label add subcommand', () => {
    const result = parse(['label', 'add', 'PROJ-42', 'backend']);
    expect(result.command).toBe('label');
    expect(result.subcommand).toBe('add');
    expect(result.positional).toEqual(['PROJ-42', 'backend']);
  });

  it('parses label remove subcommand', () => {
    const result = parse(['label', 'remove', 'PROJ-42', 'backend']);
    expect(result.command).toBe('label');
    expect(result.subcommand).toBe('remove');
  });

  it('parses dep add subcommand', () => {
    const result = parse(['dep', 'add', 'PROJ-42', 'blocked_by', 'PROJ-7']);
    expect(result.command).toBe('dep');
    expect(result.subcommand).toBe('add');
    expect(result.positional).toEqual(['PROJ-42', 'blocked_by', 'PROJ-7']);
  });

  it('parses dep remove subcommand', () => {
    const result = parse(['dep', 'remove', 'PROJ-42', 'PROJ-7']);
    expect(result.command).toBe('dep');
    expect(result.subcommand).toBe('remove');
    expect(result.positional).toEqual(['PROJ-42', 'PROJ-7']);
  });

  it('parses cycle add-issue', () => {
    const result = parse([
      'cycle',
      'add-issue',
      'Sprint 24',
      'PROJ-42',
      '--project',
      'CORE',
    ]);
    expect(result.command).toBe('cycle');
    expect(result.subcommand).toBe('add-issue');
    expect(result.positional).toEqual(['Sprint 24', 'PROJ-42']);
    expect(result.flags.project).toBe('CORE');
  });

  it('parses module add-issue', () => {
    const result = parse([
      'module',
      'add-issue',
      'Auth',
      'PROJ-42',
      '-p',
      'CORE',
    ]);
    expect(result.command).toBe('module');
    expect(result.subcommand).toBe('add-issue');
  });

  it('parses quick positional title (create)', () => {
    const result = parse(['create', '-p', 'CORE', 'Fix bug']);
    expect(result.command).toBe('create');
    expect(result.flags.project).toBe('CORE');
    expect(result.positional).toEqual(['Fix bug']);
  });

  it('parses mixed flags and positionals', () => {
    const result = parse(['list', '--project', 'CORE', '--limit', '10', '--state', 'Open']);
    expect(result.flags.project).toBe('CORE');
    expect(result.flags.limit).toBe('10');
    expect(result.flags.state).toBe('Open');
  });

  it('rejects unknown flags', () => {
    expect(() => parse(['list', '--bogus'])).toThrow('Unknown flag');
  });

  it('unknown flag error suggests help', () => {
    expect(() => parse(['list', '--descriptions'])).toThrow('pl help');
  });
});
