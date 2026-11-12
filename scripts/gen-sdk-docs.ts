/**
 * Generates the SDK reference (apps/web/src/generated/sdk-reference.md) from the TSDoc comments
 * in packages/sdk/src/index.ts, using the TypeScript compiler API. Run by the build.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = join(ROOT, 'packages', 'sdk', 'src', 'index.ts');
const OUT = join(ROOT, 'apps', 'web', 'src', 'generated', 'sdk-reference.md');

const program = ts.createProgram([ENTRY], { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, strict: true });
const checker = program.getTypeChecker();
const source = program.getSourceFile(ENTRY)!;

const doc = (node: ts.Node): string => {
  const symbol = (node as ts.NamedDeclaration).name ? checker.getSymbolAtLocation((node as ts.NamedDeclaration).name!) : undefined;
  const text = symbol ? ts.displayPartsToString(symbol.getDocumentationComment(checker)) : '';
  if (text) return text.replace(/\s+/g, ' ').trim();
  const ranges = ts.getLeadingCommentRanges(source.text, node.getFullStart()) ?? [];
  const raw = ranges.map((r) => source.text.slice(r.pos, r.end)).join('\n');
  return raw
    .replace(/^\/\*\*?|\*\/$/gm, '')
    .replace(/^\s*\* ?/gm, '')
    .replace(/^\/\/\s?/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const sig = (node: ts.Node): string => {
  const type = checker.getTypeAtLocation(node);
  return checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseSingleQuotesForStringLiteralType);
};

const sections: string[] = [];
const modules = ['game', 'ad', 'user', 'data', 'leaderboard', 'quests'];

ts.forEachChild(source, (node) => {
  if (!ts.isVariableStatement(node)) return;
  for (const decl of node.declarationList.declarations) {
    if (!ts.isIdentifier(decl.name) || !modules.includes(decl.name.text)) continue;
    if (!decl.initializer || !ts.isObjectLiteralExpression(decl.initializer)) continue;
    const lines = [`## BG.${decl.name.text}`, '', doc(node), ''];
    for (const prop of decl.initializer.properties) {
      const name = prop.name && ts.isIdentifier(prop.name) ? prop.name.text : '';
      if (!name) continue;
      lines.push(`### \`BG.${decl.name.text}.${name}\``, '', '```ts', `${name}: ${sig(prop)}`, '```', '');
      const d = doc(prop);
      if (d) lines.push(d, '');
    }
    sections.push(lines.join('\n'));
  }
});

const header = `# SDK reference

Generated from the TSDoc comments in \`packages/sdk/src/index.ts\`. Every method is available on
\`window.BG\` (script tag) and on the default export of \`@brainstorming/sdk\`.

## BG.init and BG.environment

\`\`\`ts
init(): Promise<void>
environment: 'local' | 'brainstorming' | 'disabled'
\`\`\`

Call \`await BG.init()\` once before anything else. \`BG.environment\` tells you where the game runs.
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${header}\n${sections.join('\n')}\n`);
console.log(`[sdk-docs] ${sections.length} modules documented`);
