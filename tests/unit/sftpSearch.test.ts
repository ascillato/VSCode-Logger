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
});
