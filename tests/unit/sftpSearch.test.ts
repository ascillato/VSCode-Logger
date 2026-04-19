import { describe, expect, it } from 'vitest';

import {
  compileSftpSearchCommand,
  createDefaultSftpSearchOptions,
  normalizeSftpSearchOptions,
} from '../../src/sftpSearch';

describe('sftpSearch', () => {
  it('builds a find command with grep filters and current base path', () => {
    const options = normalizeSftpSearchOptions({
      name: 'syslog',
      sizeValue: '50M',
      sizeMode: 'bigger',
      timeKind: 'modified',
      timeComparator: 'inLast',
      timeDays: '7',
      permissions: '644',
      excludePath: '.git',
      includeSubdirectories: true,
      content: 'error',
      contentCaseSensitive: false,
      contentWholeWordOnly: true,
      contentExactLineMatch: false,
    });

    const compiled = compileSftpSearchCommand('/var/log', options);

    expect(compiled.command).toContain("cd '/var/log' && find .");
    expect(compiled.command).toContain("-iname '*syslog*'");
    expect(compiled.command).toContain("-size '+50M'");
    expect(compiled.command).toContain("-mtime '-7'");
    expect(compiled.command).toContain("-perm '644'");
    expect(compiled.command).toContain("-not -path '*.git*'");
    expect(compiled.command).toContain("-exec grep -q -i -w -- 'error' {} \\;");
    expect(compiled.command.endsWith('-print')).toBe(true);
  });

  it('limits search depth when subdirectories are disabled', () => {
    const compiled = compileSftpSearchCommand('/tmp', {
      ...createDefaultSftpSearchOptions(),
      includeSubdirectories: false,
    });

    expect(compiled.command).toContain('-maxdepth 1');
  });

  it('rejects invalid size filters', () => {
    expect(() =>
      compileSftpSearchCommand('/tmp', {
        ...createDefaultSftpSearchOptions(),
        sizeValue: 'abc',
      })
    ).toThrow(/size/i);
  });

  it('rejects invalid permission filters', () => {
    expect(() =>
      compileSftpSearchCommand('/tmp', {
        ...createDefaultSftpSearchOptions(),
        permissions: 'ugo+r',
      })
    ).toThrow(/permissions/i);
  });

  it('normalizes unknown values back to defaults and trims text fields', () => {
    const options = normalizeSftpSearchOptions({
      name: '  logs  ',
      nameCaseSensitive: 1 as never,
      sizeValue: 42 as never,
      sizeMode: 'huge' as never,
      timeKind: 'created' as never,
      timeComparator: 'before' as never,
      timeDays: ' 5 ',
      permissions: ' 644 ',
      excludePath: ' build ',
      includeSubdirectories: 0 as never,
      content: ' error ',
      contentCaseSensitive: 'yes' as never,
      contentWholeWordOnly: '' as never,
      contentExactLineMatch: 1 as never,
    });

    expect(options).toEqual({
      name: 'logs',
      nameCaseSensitive: true,
      sizeValue: '',
      sizeMode: 'exactly',
      timeKind: 'modified',
      timeComparator: 'inLast',
      timeDays: '5',
      permissions: '644',
      excludePath: 'build',
      includeSubdirectories: true,
      content: 'error',
      contentCaseSensitive: true,
      contentWholeWordOnly: false,
      contentExactLineMatch: true,
    });
  });

  it('builds alternate size, time, name, and grep predicates', () => {
    const command = compileSftpSearchCommand("/service/app's", {
      name: '*.LOG',
      nameCaseSensitive: true,
      sizeValue: '10k',
      sizeMode: 'smaller',
      timeKind: 'accessed',
      timeComparator: 'moreThan',
      timeDays: '3',
      excludePath: 'tmp/*',
      content: 'critical',
      contentCaseSensitive: true,
      contentExactLineMatch: true,
    }).command;

    expect(command).toContain("cd '/service/app'\\''s'");
    expect(command).toContain("-name '*.LOG'");
    expect(command).toContain("-size '-10k'");
    expect(command).toContain("-atime '+3'");
    expect(command).toContain("-not -path './tmp/*'");
    expect(command).toContain("-exec grep -q -x -- 'critical' {} \\;");
  });

  it('builds changed-time and exact-size predicates and rejects invalid days', () => {
    const command = compileSftpSearchCommand('/service', {
      sizeValue: '512',
      sizeMode: 'exactly',
      timeKind: 'changed',
      timeComparator: 'inLast',
      timeDays: '0',
      excludePath: '.git',
    }).command;

    expect(command).toContain("-size '512'");
    expect(command).toContain("-ctime '-0'");
    expect(command).toContain("-not -path '*.git*'");

    expect(() =>
      compileSftpSearchCommand('/service', {
        ...createDefaultSftpSearchOptions(),
        timeDays: '1.5',
      })
    ).toThrow(/days/i);
  });
});
