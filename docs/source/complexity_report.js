#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const OUTPUT_DIR = path.join(__dirname, '_generated');
const OUTPUT_REPORT = path.join(OUTPUT_DIR, 'complexity-report.md');
const OUTPUT_JSON = path.join(OUTPUT_DIR, 'complexity-summary.json');

const EXCLUDED_DIRS = new Set([
  'node_modules',
  'build',
  'typedoc',
  'out',
  '.git',
  '.venv',
  'dist',
  'coverage',
  '.VSCodeCounter',
  '.vscode-test',
  '.github',
  '.vscode',
  'docs',
]);

const ALLOWED_EXTENSIONS = new Set(['.ts', '.js']);

function collectSourceFiles(root) {
  const results = [];
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (error) {
    return results;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) {
        continue;
      }
      results.push(...collectSourceFiles(path.join(root, entry.name)));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const extension = path.extname(entry.name);
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      continue;
    }

    if (entry.name.endsWith('.d.ts')) {
      continue;
    }

    results.push(path.join(root, entry.name));
  }

  return results;
}

function countLoc(text) {
  if (!text) {
    return 0;
  }
  return text
    .split(/\r\n|\r|\n/)
    .filter((line) => line.trim().length > 0).length;
}

function isLogicalOperator(kind) {
  return (
    kind === ts.SyntaxKind.AmpersandAmpersandToken ||
    kind === ts.SyntaxKind.BarBarToken ||
    kind === ts.SyntaxKind.QuestionQuestionToken
  );
}

function computeCyclomaticComplexity(root) {
  let complexity = 1;

  function visit(node) {
    if (node !== root && ts.isFunctionLike(node)) {
      return;
    }

    if (
      ts.isIfStatement(node) ||
      ts.isForStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isForOfStatement(node) ||
      ts.isWhileStatement(node) ||
      ts.isDoStatement(node) ||
      ts.isCatchClause(node) ||
      ts.isConditionalExpression(node)
    ) {
      complexity += 1;
    } else if (ts.isCaseClause(node)) {
      complexity += 1;
    } else if (ts.isBinaryExpression(node) && isLogicalOperator(node.operatorToken.kind)) {
      complexity += 1;
    }

    ts.forEachChild(node, visit);
  }

  if (root.body) {
    visit(root.body);
  }

  return complexity;
}

// Cognitive complexity uses a nesting-aware approximation of the SonarSource rules.
function computeCognitiveComplexity(root) {
  let complexity = 0;

  function visit(node, nesting) {
    if (node !== root && ts.isFunctionLike(node)) {
      return;
    }

    if (ts.isIfStatement(node)) {
      const isElseIf =
        ts.isIfStatement(node.parent) && node.parent.elseStatement === node;
      complexity += isElseIf ? 1 : 1 + nesting;
      visit(node.expression, nesting);
      visit(node.thenStatement, nesting + 1);
      if (node.elseStatement) {
        const elseNesting = ts.isIfStatement(node.elseStatement)
          ? nesting
          : nesting + 1;
        visit(node.elseStatement, elseNesting);
      }
      return;
    }

    if (
      ts.isForStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isForOfStatement(node) ||
      ts.isWhileStatement(node) ||
      ts.isDoStatement(node)
    ) {
      complexity += 1 + nesting;
      ts.forEachChild(node, (child) => visit(child, nesting + 1));
      return;
    }

    if (ts.isSwitchStatement(node)) {
      complexity += 1 + nesting;
      const clauseNesting = nesting + 1;
      for (const clause of node.caseBlock.clauses) {
        if (ts.isCaseClause(clause)) {
          complexity += 1;
        }
        clause.statements.forEach((statement) => visit(statement, clauseNesting));
      }
      return;
    }

    if (ts.isCatchClause(node)) {
      complexity += 1 + nesting;
      ts.forEachChild(node, (child) => visit(child, nesting + 1));
      return;
    }

    if (ts.isConditionalExpression(node)) {
      complexity += 1 + nesting;
      visit(node.condition, nesting);
      visit(node.whenTrue, nesting + 1);
      visit(node.whenFalse, nesting + 1);
      return;
    }

    if (ts.isBinaryExpression(node) && isLogicalOperator(node.operatorToken.kind)) {
      complexity += 1;
    }

    ts.forEachChild(node, (child) => visit(child, nesting));
  }

  if (root.body) {
    visit(root.body, 0);
  }

  return complexity;
}

function getTypeNameText(typeName) {
  if (ts.isIdentifier(typeName)) {
    return typeName.text;
  }
  if (ts.isQualifiedName(typeName)) {
    return getTypeNameText(typeName.right);
  }
  return '';
}

function getExpressionName(expr) {
  if (ts.isIdentifier(expr)) {
    return expr.text;
  }
  if (ts.isPropertyAccessExpression(expr)) {
    return expr.name.text;
  }
  return '';
}

function collectClassCouplings(classNode) {
  const couplings = new Set();
  const localTypeParams = new Set();

  function addName(name) {
    if (!name || localTypeParams.has(name)) {
      return;
    }
    if (name === classNode.name?.text) {
      return;
    }
    couplings.add(name);
  }

  function visit(node) {
    if (ts.isTypeParameterDeclaration(node) && ts.isIdentifier(node.name)) {
      localTypeParams.add(node.name.text);
    }

    if (ts.isTypeReferenceNode(node)) {
      addName(getTypeNameText(node.typeName));
    } else if (ts.isExpressionWithTypeArguments(node)) {
      addName(getExpressionName(node.expression));
    } else if (ts.isNewExpression(node)) {
      addName(getExpressionName(node.expression));
    }

    ts.forEachChild(node, visit);
  }

  visit(classNode);
  return couplings;
}

function getBaseClassName(node) {
  if (!node.heritageClauses) {
    return '';
  }
  for (const clause of node.heritageClauses) {
    if (clause.token !== ts.SyntaxKind.ExtendsKeyword) {
      continue;
    }
    for (const type of clause.types) {
      const name = getExpressionName(type.expression);
      if (name) {
        return name;
      }
    }
  }
  return '';
}

function computeHalsteadMetrics(text, languageVariant, globalOperators, globalOperands) {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    languageVariant,
    text
  );
  const operators = new Map();
  const operands = new Map();

  function addCount(map, tokenText) {
    map.set(tokenText, (map.get(tokenText) || 0) + 1);
  }

  function isOperandToken(token) {
    return (
      token === ts.SyntaxKind.Identifier ||
      token === ts.SyntaxKind.PrivateIdentifier ||
      token === ts.SyntaxKind.StringLiteral ||
      token === ts.SyntaxKind.NumericLiteral ||
      token === ts.SyntaxKind.NoSubstitutionTemplateLiteral ||
      token === ts.SyntaxKind.TemplateHead ||
      token === ts.SyntaxKind.TemplateMiddle ||
      token === ts.SyntaxKind.TemplateTail ||
      token === ts.SyntaxKind.RegularExpressionLiteral ||
      token === ts.SyntaxKind.BigIntLiteral ||
      token === ts.SyntaxKind.ThisKeyword ||
      token === ts.SyntaxKind.SuperKeyword ||
      token === ts.SyntaxKind.TrueKeyword ||
      token === ts.SyntaxKind.FalseKeyword ||
      token === ts.SyntaxKind.NullKeyword
    );
  }

  let token = scanner.scan();
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    const tokenText = scanner.getTokenText();
    if (isOperandToken(token)) {
      addCount(operands, tokenText);
    } else {
      addCount(operators, tokenText);
    }
    token = scanner.scan();
  }

  for (const key of operators.keys()) {
    globalOperators.add(key);
  }
  for (const key of operands.keys()) {
    globalOperands.add(key);
  }

  const totalOperators = Array.from(operators.values()).reduce((sum, value) => sum + value, 0);
  const totalOperands = Array.from(operands.values()).reduce((sum, value) => sum + value, 0);
  const vocabulary = operators.size + operands.size;
  const length = totalOperators + totalOperands;
  const volume = vocabulary > 0 ? length * Math.log2(vocabulary) : 0;
  const difficulty =
    operators.size > 0 && operands.size > 0
      ? (operators.size / 2) * (totalOperands / operands.size)
      : 0;
  const effort = difficulty * volume;
  const bugs = volume / 3000;
  const time = effort / 18;

  return {
    operators: { distinct: operators.size, total: totalOperators },
    operands: { distinct: operands.size, total: totalOperands },
    vocabulary,
    length,
    volume,
    difficulty,
    effort,
    bugs,
    time,
  };
}

function computeMaintainabilityIndex(volume, cyclomatic, loc) {
  if (volume <= 0 || loc <= 0) {
    return 0;
  }
  const mi =
    (171 -
      5.2 * Math.log(volume) -
      0.23 * cyclomatic -
      16.2 * Math.log(loc)) *
    (100 / 171);
  return Math.max(0, mi);
}

function average(values) {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function max(values) {
  if (!values.length) {
    return 0;
  }
  return Math.max(...values);
}

function formatInteger(value) {
  if (!Number.isFinite(value)) {
    return '0';
  }
  return value.toLocaleString('en-US');
}

function formatNumber(value, decimals) {
  if (!Number.isFinite(value)) {
    return 'N/A';
  }
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatTable(headers, rows, numericColumns = []) {
  const numericSet = new Set(numericColumns);
  const headerLine = `| ${headers.join(' | ')} |`;
  const separator = `| ${headers
    .map((_, index) => (numericSet.has(index) ? '---:' : '---'))
    .join(' | ')} |`;
  const body = rows.map((row) => `| ${row.join(' | ')} |`).join('\n');
  return [headerLine, separator, body].join('\n');
}

function analyzeFile(
  filePath,
  classInfoMap,
  classNameIndex,
  globalOperators,
  globalOperands
) {
  const text = fs.readFileSync(filePath, 'utf8');
  const scriptKind =
    path.extname(filePath) === '.js' ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKind
  );

  const functions = [];
  const classNames = [];

  function visit(node) {
    if (ts.isFunctionLike(node) && node.body) {
      functions.push({
        cyclomatic: computeCyclomaticComplexity(node),
        cognitive: computeCognitiveComplexity(node),
      });
    }

    if (ts.isClassDeclaration(node) && node.name) {
      const className = node.name.text;
      const classId = `${filePath}::${className}`;
      classNames.push(className);
      classInfoMap.set(classId, {
        id: classId,
        name: className,
        filePath,
        baseName: getBaseClassName(node),
        couplings: collectClassCouplings(node),
      });
      if (!classNameIndex.has(className)) {
        classNameIndex.set(className, []);
      }
      classNameIndex.get(className).push(classId);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  const loc = countLoc(text);
  const cyclomaticValues = functions.map((metric) => metric.cyclomatic);
  const cognitiveValues = functions.map((metric) => metric.cognitive);
  const cyclomaticTotal = cyclomaticValues.reduce((sum, value) => sum + value, 0);
  const cognitiveTotal = cognitiveValues.reduce((sum, value) => sum + value, 0);

  const halstead = computeHalsteadMetrics(
    text,
    sourceFile.languageVariant,
    globalOperators,
    globalOperands
  );
  const maintainability = computeMaintainabilityIndex(
    halstead.volume,
    cyclomaticTotal,
    loc
  );

  return {
    path: path.relative(PROJECT_ROOT, filePath),
    loc,
    functions: {
      count: functions.length,
      cyclomatic: {
        total: cyclomaticTotal,
        avg: average(cyclomaticValues),
        max: max(cyclomaticValues),
      },
      cognitive: {
        total: cognitiveTotal,
        avg: average(cognitiveValues),
        max: max(cognitiveValues),
      },
    },
    halstead,
    maintainability,
    classNames,
  };
}

function computeDitValues(classInfoMap, classNameIndex) {
  const cache = new Map();
  const stack = new Set();

  function resolveBaseClass(info) {
    if (!info.baseName) {
      return '';
    }
    const candidates = classNameIndex.get(info.baseName) || [];
    if (!candidates.length) {
      return '';
    }
    if (candidates.length === 1) {
      return candidates[0];
    }
    const sameFile = candidates.find(
      (candidate) => classInfoMap.get(candidate)?.filePath === info.filePath
    );
    return sameFile || '';
  }

  function computeDit(classId) {
    if (cache.has(classId)) {
      return cache.get(classId);
    }
    if (stack.has(classId)) {
      return 1;
    }
    stack.add(classId);

    const info = classInfoMap.get(classId);
    if (!info) {
      cache.set(classId, 1);
      stack.delete(classId);
      return 1;
    }

    const baseId = resolveBaseClass(info);
    if (!baseId || !classInfoMap.has(baseId)) {
      const dit = info.baseName ? 2 : 1;
      cache.set(classId, dit);
      stack.delete(classId);
      return dit;
    }

    const dit = 1 + computeDit(baseId);
    cache.set(classId, dit);
    stack.delete(classId);
    return dit;
  }

  for (const classId of classInfoMap.keys()) {
    computeDit(classId);
  }

  return cache;
}

function buildReport(fileMetrics, classMetrics, halsteadSummary) {
  const functionCount = fileMetrics.reduce(
    (sum, file) => sum + file.functions.count,
    0
  );
  const cyclomaticTotal = fileMetrics.reduce(
    (sum, file) => sum + file.functions.cyclomatic.total,
    0
  );
  const cognitiveTotal = fileMetrics.reduce(
    (sum, file) => sum + file.functions.cognitive.total,
    0
  );
  const cyclomaticMax = max(
    fileMetrics.map((file) => file.functions.cyclomatic.max)
  );
  const cognitiveMax = max(
    fileMetrics.map((file) => file.functions.cognitive.max)
  );
  const cyclomaticAvg = functionCount ? cyclomaticTotal / functionCount : 0;
  const cognitiveAvg = functionCount ? cognitiveTotal / functionCount : 0;
  const maintainabilityValues = fileMetrics.map((file) => file.maintainability);
  const ditValues = classMetrics.map((metric) => metric.dit);
  const cboValues = classMetrics.map((metric) => metric.cbo);

  const overviewRows = [
    [
      'Cyclomatic complexity (functions)',
      formatInteger(functionCount),
      formatNumber(cyclomaticAvg, 2),
      formatInteger(cyclomaticMax),
    ],
    [
      'Cognitive complexity (functions)',
      formatInteger(functionCount),
      formatNumber(cognitiveAvg, 2),
      formatInteger(cognitiveMax),
    ],
    [
      'Maintainability index (files)',
      formatInteger(fileMetrics.length),
      formatNumber(average(maintainabilityValues), 1),
      formatNumber(max(maintainabilityValues), 1),
    ],
    [
      'Depth of inheritance (classes)',
      formatInteger(classMetrics.length),
      formatNumber(average(ditValues), 2),
      formatInteger(max(ditValues)),
    ],
    [
      'Coupling between objects (classes)',
      formatInteger(classMetrics.length),
      formatNumber(average(cboValues), 2),
      formatInteger(max(cboValues)),
    ],
  ];

  const overviewTable = formatTable(
    ['Metric', 'Count', 'Average', 'Max'],
    overviewRows,
    [1, 2, 3]
  );

  const halsteadRows = [
    ['Operators (distinct)', formatInteger(halsteadSummary.operators.distinct)],
    ['Operators (total)', formatInteger(halsteadSummary.operators.total)],
    ['Operands (distinct)', formatInteger(halsteadSummary.operands.distinct)],
    ['Operands (total)', formatInteger(halsteadSummary.operands.total)],
    ['Vocabulary', formatInteger(halsteadSummary.vocabulary)],
    ['Length', formatInteger(halsteadSummary.length)],
    ['Volume', formatNumber(halsteadSummary.volume, 2)],
    ['Difficulty', formatNumber(halsteadSummary.difficulty, 2)],
    ['Effort', formatNumber(halsteadSummary.effort, 2)],
    ['Bugs', formatNumber(halsteadSummary.bugs, 2)],
    ['Time (sec)', formatNumber(halsteadSummary.time, 2)],
  ];

  const halsteadTable = formatTable(['Metric', 'Value'], halsteadRows, [1]);

  const complexityRows = fileMetrics.map((file) => [
    `\`${file.path}\``,
    formatInteger(file.loc),
    formatInteger(file.functions.count),
    formatNumber(file.functions.cyclomatic.avg, 2),
    formatInteger(file.functions.cyclomatic.max),
    formatNumber(file.functions.cognitive.avg, 2),
    formatInteger(file.functions.cognitive.max),
    formatNumber(file.maintainability, 1),
  ]);

  const complexityTable = formatTable(
    [
      'File',
      'LOC',
      'Functions',
      'Cyclomatic Avg',
      'Cyclomatic Max',
      'Cognitive Avg',
      'Cognitive Max',
      'Maintainability',
    ],
    complexityRows,
    [1, 2, 3, 4, 5, 6, 7]
  );

  const halsteadFileRows = fileMetrics.map((file) => [
    `\`${file.path}\``,
    formatInteger(file.halstead.vocabulary),
    formatInteger(file.halstead.length),
    formatNumber(file.halstead.volume, 2),
    formatNumber(file.halstead.difficulty, 2),
    formatNumber(file.halstead.effort, 2),
    formatNumber(file.halstead.bugs, 2),
    formatNumber(file.halstead.time, 2),
  ]);

  const halsteadFileTable = formatTable(
    [
      'File',
      'Vocabulary',
      'Length',
      'Volume',
      'Difficulty',
      'Effort',
      'Bugs',
      'Time (sec)',
    ],
    halsteadFileRows,
    [1, 2, 3, 4, 5, 6, 7]
  );

  let classTable = 'No class declarations were detected in the analyzed sources.';
  if (classMetrics.length) {
    const classRows = classMetrics.map((metric) => [
      `\`${metric.name}\``,
      `\`${metric.file}\``,
      formatInteger(metric.dit),
      formatInteger(metric.cbo),
    ]);
    classTable = formatTable(
      ['Class', 'File', 'DIT', 'CBO'],
      classRows,
      [2, 3]
    );
  }

  return [
    '<!-- Automatically generated by docs/source/complexity_report.js; do not edit manually. -->',
    `Generated on ${new Date().toISOString()}.`,
    '',
    '## Complexity overview',
    overviewTable,
    '',
    '## Halstead summary',
    halsteadTable,
    '',
    '## Complexity by file',
    complexityTable,
    '',
    '## Halstead metrics by file',
    halsteadFileTable,
    '',
    '## Class coupling and inheritance',
    classTable,
    '',
  ].join('\n');
}

function main() {
  const sourceFiles = collectSourceFiles(PROJECT_ROOT);
  if (!sourceFiles.length) {
    throw new Error('No source files were found for complexity analysis.');
  }

  const classInfoMap = new Map();
  const classNameIndex = new Map();
  const globalOperators = new Set();
  const globalOperands = new Set();

  const fileMetrics = sourceFiles.map((filePath) =>
    analyzeFile(
      filePath,
      classInfoMap,
      classNameIndex,
      globalOperators,
      globalOperands
    )
  );
  fileMetrics.sort((a, b) => a.path.localeCompare(b.path));

  const ditValues = computeDitValues(classInfoMap, classNameIndex);
  const classMetrics = [];
  for (const [classId, info] of classInfoMap.entries()) {
    classMetrics.push({
      name: info.name,
      file: path.relative(PROJECT_ROOT, info.filePath),
      dit: ditValues.get(classId) || 1,
      cbo: info.couplings ? info.couplings.size : 0,
    });
  }
  classMetrics.sort((a, b) =>
    a.file === b.file ? a.name.localeCompare(b.name) : a.file.localeCompare(b.file)
  );

  const totalOperators = fileMetrics.reduce(
    (sum, file) => sum + file.halstead.operators.total,
    0
  );
  const totalOperands = fileMetrics.reduce(
    (sum, file) => sum + file.halstead.operands.total,
    0
  );
  const vocabulary = globalOperators.size + globalOperands.size;
  const length = totalOperators + totalOperands;
  const volume = vocabulary > 0 ? length * Math.log2(vocabulary) : 0;
  const difficulty =
    globalOperators.size > 0 && globalOperands.size > 0
      ? (globalOperators.size / 2) * (totalOperands / globalOperands.size)
      : 0;
  const effort = difficulty * volume;
  const bugs = volume / 3000;
  const time = effort / 18;

  const halsteadSummary = {
    operators: { distinct: globalOperators.size, total: totalOperators },
    operands: { distinct: globalOperands.size, total: totalOperands },
    vocabulary,
    length,
    volume,
    difficulty,
    effort,
    bugs,
    time,
  };

  const report = buildReport(fileMetrics, classMetrics, halsteadSummary);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_REPORT, report, 'utf8');

  fs.writeFileSync(
    OUTPUT_JSON,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        files: fileMetrics,
        classes: classMetrics,
        halsteadSummary,
      },
      null,
      2
    ),
    'utf8'
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
