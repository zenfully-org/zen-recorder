// The ESLint rules of the quality gate (`pnpm check:quality`, scripts/check-quality.ts). Biome is
// the linter and formatter; ESLint runs here only for what Biome does not have, from
// eslint-plugin-sonarjs, the rule set SonarQube runs for JavaScript and TypeScript, so a finding is
// one a SonarQube report would show:
// - the per-function and per-file metrics, which Biome does not have (cyclomatic complexity,
//   nesting, repeated literals) or counts differently (cognitive complexity), at the thresholds
//   below;
// - SonarQube's code smells and security hotspots: its recommended rules, minus the metric rules
//   and the rules Biome already enforces.
// Nothing here is formatting or style. A line that fails is one quality-baseline.json does not
// allow, and an inline `eslint-disable` comment changes nothing (the last block).
import { createRequire } from 'node:module';
import sonarjs from 'eslint-plugin-sonarjs';
import tseslint from 'typescript-eslint';

/** Production code and the tooling under scripts/. */
const PRODUCTION = {
  cognitiveComplexity: 15,
  cyclomaticComplexity: 10,
  linesPerFunction: 80,
  linesPerFile: 400,
  nesting: 3,
  parameters: 4,
  statements: 40,
  nestedCallbacks: 3,
  conditionalOperators: 3,
  switchCases: 30,
  nestedFunctions: 5,
  repeatedLiterals: true,
};

/** Tests, fakes and the e2e harness: a `describe` callback is a function to these rules, so the size limits double. */
const TESTS = {
  ...PRODUCTION,
  cyclomaticComplexity: 15,
  linesPerFunction: 160,
  linesPerFile: 800,
  parameters: 5,
  statements: 60,
  nestedCallbacks: 5,
  repeatedLiterals: false,
};

const TEST_FILES = ['**/*.test.ts', '**/*.test.tsx', 'src/test/**', 'scripts/e2e/**'];

/**
 * SonarJS rules that check what an enabled Biome rule checks already: Biome reports it in
 * `pnpm check:lint`, so these stay off and every problem has one rule. Kept on although Biome
 * covers part of them: `no-identical-expressions` (Biome's `noSelfCompare` only compares, SonarJS
 * also catches `a && a`), `code-eval` (`noGlobalEval` misses `new Function`), `no-labels`
 * (`noConfusingLabels` allows labels on loops), `no-redundant-jump` (`noUselessContinue` misses
 * `return` and `break`), `no-gratuitous-expressions` (`noConstantCondition` misses conditions an
 * earlier check settled), `link-with-target-blank` (`noBlankTarget` is about JSX, not
 * `window.open`).
 */
export const ENFORCED_BY_BIOME = {
  'sonarjs/array-callback-without-return': 'suspicious/useIterableCallbackReturn',
  'sonarjs/block-scoped-var': 'correctness/noInnerDeclarations',
  'sonarjs/for-loop-increment-sign': 'correctness/useValidForDirection',
  'sonarjs/generator-without-yield': 'correctness/useYield',
  'sonarjs/label-position': 'suspicious/noConfusingLabels',
  'sonarjs/no-control-regex': 'suspicious/noControlCharactersInRegex',
  'sonarjs/no-empty-character-class': 'correctness/noEmptyCharacterClassInRegex',
  'sonarjs/no-fallthrough': 'suspicious/noFallthroughSwitchClause',
  'sonarjs/no-globals-shadowing': 'suspicious/noShadowRestrictedNames',
  'sonarjs/no-identical-conditions': 'suspicious/noDuplicateElseIf',
  'sonarjs/no-misleading-character-class': 'suspicious/noMisleadingCharacterClass',
  'sonarjs/no-nested-assignment': 'suspicious/noAssignInExpressions',
  'sonarjs/no-regex-spaces': 'complexity/noAdjacentSpacesInRegex',
  'sonarjs/no-unused-vars': 'correctness/noUnusedVariables',
  'sonarjs/no-useless-catch': 'complexity/noUselessCatch',
  'sonarjs/object-alt-content': 'a11y/useAltText',
  'sonarjs/prefer-default-last': 'suspicious/useDefaultSwitchClauseLast',
  'sonarjs/unused-import': 'correctness/noUnusedImports',
  'sonarjs/updated-const-var': 'correctness/noConstAssign',
};

/** Recommended SonarJS rules that misread this project, and why. */
const MISREADS = {
  // The project compiles with exactOptionalPropertyTypes, where `x?: T | undefined` says more than
  // `x?: T`. The rule knows that only with type information, which this lint runs without.
  'sonarjs/no-redundant-optional': 'off',
  // The scripts run git, bash, ffmpeg and the like by name from the contributor's PATH on purpose,
  // and the extension starts no process.
  'sonarjs/no-os-command-from-path': 'off',
};

/**
 * SonarJS's rules for test code (scope "Tests" in SonarSource's rule metadata). SonarQube runs
 * these on test files only and every other rule on main code only, and so do the blocks below: a
 * test may compare floats exactly or build an object only to see its constructor run, and main
 * code has no assertions.
 */
export const TEST_RULES = new Set(
  [
    'assertions-in-test-cases',
    'assertions-in-tests',
    'async-test-assertions',
    'chai-determinate-assertion',
    'composite-assertions',
    'disabled-timeout',
    'explicit-test-skip',
    'hooks-before-test-cases',
    'inverted-assertion-arguments',
    'no-code-after-done',
    'no-debug-commands-in-ui-tests',
    'no-duplicate-parameterized-test-case',
    'no-duplicate-test-title',
    'no-empty-parameterized-test-dataset',
    'no-empty-test-file',
    'no-empty-test-title',
    'no-exclusive-tests',
    'no-fixed-wait-in-tests',
    'no-forced-browser-interaction',
    'no-incompatible-assertion-types',
    'no-incomplete-assertions',
    'no-interpolation-in-inline-snapshots',
    'no-mixed-completion-style',
    'no-networkidle-wait',
    'no-same-argument-assert',
    'no-skipped-tests',
    'no-trivial-assertions',
    'parameterized-tests',
    'prefer-cypress-should',
    'prefer-specific-assertions',
    'stable-tests',
    'synchronous-exception-assertions',
    'synchronous-suite-callback',
    'test-check-exception',
    'testing-library-prefer-query-by-disappearance',
    'testing-library-query-assertion',
    'vitest-mock-at-module-scope',
  ].map((rule) => `sonarjs/${rule}`),
);

function metricRules(limits) {
  return {
    'sonarjs/cognitive-complexity': ['error', limits.cognitiveComplexity],
    'sonarjs/cyclomatic-complexity': ['error', { threshold: limits.cyclomaticComplexity }],
    'sonarjs/max-lines-per-function': ['error', { maximum: limits.linesPerFunction }],
    'sonarjs/max-lines': ['error', { maximum: limits.linesPerFile }],
    'sonarjs/nested-control-flow': ['error', { maximumNestingLevel: limits.nesting }],
    'max-params': ['error', limits.parameters],
    'max-statements': ['error', limits.statements],
    'max-nested-callbacks': ['error', limits.nestedCallbacks],
    'sonarjs/expression-complexity': ['error', { max: limits.conditionalOperators }],
    'sonarjs/max-switch-cases': ['error', limits.switchCases],
    'sonarjs/no-nested-functions': ['error', { threshold: limits.nestedFunctions }],
    'sonarjs/no-identical-functions': 'error',
    'sonarjs/no-duplicate-string': limits.repeatedLiterals ? ['error', { threshold: 3 }] : 'off',
  };
}

const AWS_CDK = ['aws-cdk-lib'];
const TESTING_LIBRARY = [
  '@testing-library/dom',
  '@testing-library/react',
  '@testing-library/vue',
  '@testing-library/angular',
  '@testing-library/svelte',
];

/**
 * SonarJS rules for one library or framework: SonarQube runs each only when the project depends
 * on one of these packages (`requiredDependency` in SonarSource's rule metadata), and so does this
 * file, which reads the dependencies from package.json. The AWS CDK rules alone took 1.6 s a run.
 */
export const REQUIRED_DEPENDENCIES = {
  ...Object.fromEntries(
    [
      'aws-apigateway-public-api',
      'aws-ec2-rds-dms-public',
      'aws-ec2-unencrypted-ebs-volume',
      'aws-efs-unencrypted',
      'aws-iam-all-privileges',
      'aws-iam-all-resources-accessible',
      'aws-iam-privilege-escalation',
      'aws-iam-public-access',
      'aws-opensearchservice-domain',
      'aws-rds-unencrypted-databases',
      'aws-restricted-ip-admin-access',
      'aws-s3-bucket-granted-access',
      'aws-s3-bucket-insecure-http',
      'aws-s3-bucket-public-access',
      'aws-s3-bucket-versioning',
      'aws-sagemaker-unencrypted-notebook',
      'aws-sns-unencrypted-topics',
      'aws-sqs-unencrypted-queue',
      'weak-ssl',
    ].map((rule) => [`sonarjs/${rule}`, AWS_CDK]),
  ),
  'sonarjs/jsx-no-leaked-render': ['react', 'react-native'],
  'sonarjs/no-debounce-throttle-in-render': ['react'],
  'sonarjs/no-hook-setter-in-body': ['react'],
  'sonarjs/no-mutate-reactive-state-in-updated-hook': ['vue'],
  'sonarjs/no-networkidle-wait': ['@playwright/test'],
  'sonarjs/no-useless-react-setstate': ['react'],
  'sonarjs/no-vue-class-component': ['vue-class-component', 'vue-property-decorator'],
  'sonarjs/no-vue-mixins': ['vue'],
  'sonarjs/prefer-cypress-should': ['cypress'],
  'sonarjs/prefer-read-only-props': ['react'],
  'sonarjs/testing-library-prefer-query-by-disappearance': TESTING_LIBRARY,
  'sonarjs/testing-library-query-assertion': TESTING_LIBRARY,
  'sonarjs/vitest-mock-at-module-scope': ['vitest'],
};

const packageJson = createRequire(import.meta.url)('./package.json');
const DEPENDENCIES = new Set(
  Object.keys({ ...packageJson.dependencies, ...packageJson.devDependencies }),
);

/** Whether SonarQube would run the rule here: it needs no library, or one the project depends on. */
function appliesHere(rule) {
  const needs = REQUIRED_DEPENDENCIES[rule];
  return needs === undefined || needs.some((dependency) => DEPENDENCIES.has(dependency));
}

const METRIC_RULES = new Set(Object.keys(metricRules(PRODUCTION)));

/** SonarJS's recommended code-smell and hotspot rules for test code (`true`) or main code (`false`). */
export function smellRules(forTests) {
  return Object.fromEntries(
    Object.entries(sonarjs.configs.recommended.rules ?? {}).filter(
      ([rule, level]) =>
        level !== 'off' &&
        !METRIC_RULES.has(rule) &&
        !(rule in ENFORCED_BY_BIOME) &&
        !(rule in MISREADS) &&
        appliesHere(rule) &&
        TEST_RULES.has(rule) === forTests,
    ),
  );
}

export default [
  {
    // What Biome and tsc leave out too: generated code, third-party code, and the fixture pages.
    // Files git ignores never get here: the gate lints the files git lists.
    ignores: [
      '.output/**',
      '.wxt/**',
      '.tools/**',
      '.firefox-profile/**',
      'node_modules/**',
      'inspiration/**',
      'src/test/fixtures/**',
      'src/components/ui/**',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { sonarjs },
    rules: metricRules(PRODUCTION),
  },
  {
    files: TEST_FILES,
    rules: metricRules(TESTS),
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    ignores: TEST_FILES,
    rules: smellRules(false),
  },
  {
    files: TEST_FILES,
    rules: smellRules(true),
  },
  {
    // An inline comment (`// eslint-disable-next-line`, `/* eslint rule: off */`) has no effect:
    // quality-baseline.json, which a reviewer sees in the diff, is the only way to accept a finding.
    // ESLint warns about each such comment, and the gate fails on the warning (`no-inline-config`).
    linterOptions: { noInlineConfig: true },
  },
];
