/**
 * Helpers for compiling and validating SFTP search commands.
 *
 * @packageDocumentation
 */

export type SftpSearchSizeMode = 'bigger' | 'smaller' | 'exactly';
export type SftpSearchTimeKind = 'modified' | 'accessed' | 'changed';
export type SftpSearchTimeComparator = 'inLast' | 'moreThan';

export interface SftpSearchOptions {
  name: string;
  nameCaseSensitive: boolean;
  sizeValue: string;
  sizeMode: SftpSearchSizeMode;
  timeKind: SftpSearchTimeKind;
  timeComparator: SftpSearchTimeComparator;
  timeDays: string;
  permissions: string;
  excludePath: string;
  includeSubdirectories: boolean;
  content: string;
  contentCaseSensitive: boolean;
  contentWholeWordOnly: boolean;
  contentExactLineMatch: boolean;
}

export interface CompiledSftpSearchCommand {
  command: string;
}

const SIZE_PATTERN = /^\d+(?:[bcwkMG])?$/i;
const DAYS_PATTERN = /^\d+$/;
const PERMISSIONS_PATTERN = /^[-/]?[0-7]{3,4}$/;
const WILDCARD_PATTERN = /[*?[]/;

/**
 * Returns a blank search request with sensible defaults.
 */
export function createDefaultSftpSearchOptions(): SftpSearchOptions {
  return {
    name: '',
    nameCaseSensitive: false,
    sizeValue: '',
    sizeMode: 'exactly',
    timeKind: 'modified',
    timeComparator: 'inLast',
    timeDays: '',
    permissions: '',
    excludePath: '',
    includeSubdirectories: true,
    content: '',
    contentCaseSensitive: false,
    contentWholeWordOnly: false,
    contentExactLineMatch: false,
  };
}

/**
 * Validates and normalizes a search request.
 */
export function normalizeSftpSearchOptions(
  value: Partial<SftpSearchOptions> | undefined
): SftpSearchOptions {
  const defaults = createDefaultSftpSearchOptions();
  const merged = { ...defaults, ...(value ?? {}) };
  return {
    ...merged,
    name: normalizeText(merged.name),
    sizeValue: normalizeText(merged.sizeValue),
    timeDays: normalizeText(merged.timeDays),
    permissions: normalizeText(merged.permissions),
    excludePath: normalizeText(merged.excludePath),
    content: normalizeText(merged.content),
    nameCaseSensitive: Boolean(merged.nameCaseSensitive),
    includeSubdirectories: merged.includeSubdirectories !== false,
    contentCaseSensitive: Boolean(merged.contentCaseSensitive),
    contentWholeWordOnly: Boolean(merged.contentWholeWordOnly),
    contentExactLineMatch: Boolean(merged.contentExactLineMatch),
    sizeMode: normalizeEnum(merged.sizeMode, ['bigger', 'smaller', 'exactly'], 'exactly'),
    timeKind: normalizeEnum(merged.timeKind, ['modified', 'accessed', 'changed'], 'modified'),
    timeComparator: normalizeEnum(merged.timeComparator, ['inLast', 'moreThan'], 'inLast'),
  };
}

/**
 * Compiles a shell-safe command that runs from the given base path.
 */
export function compileSftpSearchCommand(
  basePath: string,
  rawOptions: Partial<SftpSearchOptions> | undefined
): CompiledSftpSearchCommand {
  const options = normalizeSftpSearchOptions(rawOptions);
  const predicates: string[] = [];

  if (!options.includeSubdirectories) {
    predicates.push('-maxdepth 1');
  }

  predicates.push('-type f');

  if (options.name) {
    const matcher = options.nameCaseSensitive ? '-name' : '-iname';
    predicates.push(`${matcher} ${shellQuote(toFindPattern(options.name))}`);
  }

  if (options.sizeValue) {
    if (!SIZE_PATTERN.test(options.sizeValue)) {
      throw new Error('Size must be a number with an optional suffix such as 50M.');
    }
    const sizePrefix =
      options.sizeMode === 'bigger' ? '+' : options.sizeMode === 'smaller' ? '-' : '';
    predicates.push(`-size ${shellQuote(`${sizePrefix}${options.sizeValue}`)}`);
  }

  if (options.timeDays) {
    if (!DAYS_PATTERN.test(options.timeDays)) {
      throw new Error('Days must be a non-negative integer.');
    }
    const timeFlag =
      options.timeKind === 'accessed'
        ? '-atime'
        : options.timeKind === 'changed'
          ? '-ctime'
          : '-mtime';
    const timePrefix = options.timeComparator === 'moreThan' ? '+' : '-';
    predicates.push(`${timeFlag} ${shellQuote(`${timePrefix}${options.timeDays}`)}`);
  }

  if (options.permissions) {
    if (!PERMISSIONS_PATTERN.test(options.permissions)) {
      throw new Error('Permissions must use octal notation such as 644, -644, or /111.');
    }
    predicates.push(`-perm ${shellQuote(options.permissions)}`);
  }

  if (options.excludePath) {
    const excludePattern = toExcludePattern(options.excludePath);
    predicates.push(`-not -path ${shellQuote(excludePattern)}`);
  }

  if (options.content) {
    const grepFlags = ['-q'];
    if (!options.contentCaseSensitive) {
      grepFlags.push('-i');
    }
    if (options.contentWholeWordOnly) {
      grepFlags.push('-w');
    }
    if (options.contentExactLineMatch) {
      grepFlags.push('-x');
    }
    predicates.push(`-exec grep ${grepFlags.join(' ')} -- ${shellQuote(options.content)} {} \\;`);
  }

  const command = `cd ${shellQuote(basePath)} && find . ${predicates.join(' ')} -print`;
  return { command };
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeEnum<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? (value as T) : fallback;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function toFindPattern(value: string): string {
  return WILDCARD_PATTERN.test(value) ? value : `*${value}*`;
}

function toExcludePattern(value: string): string {
  const pattern = WILDCARD_PATTERN.test(value) ? value : `*${value}*`;
  return pattern.startsWith('.') || pattern.startsWith('*') ? pattern : `./${pattern}`;
}
