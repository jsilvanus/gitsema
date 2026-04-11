import { Command } from 'commander'
import { readFileSync } from 'node:fs'
import { applyConfigToEnv } from '../core/config/configManager.js'
import { registerAll } from './register/all.js'

const program = new Command()

// Accept a top-level `--verbose` flag so Commander does not reject it.
program.option('--verbose', 'Enable verbose debug logging')

// Honor `--verbose` early by setting an env var so other modules (logger)
// pick it up when they load.
if (process.argv.includes('--verbose')) process.env.GITSEMA_VERBOSE = '1'

// Apply file-based config defaults to process.env so all commands that read
// env vars transparently pick up values from .gitsema/config.json or
// ~/.config/gitsema/config.json. Env vars already set take precedence.
applyConfigToEnv()

// Read package.json version dynamically so `gitsema -V` matches package.json
let pkgVersion = '0.0.0'
try {
  const pkgPath = new URL('../../package.json', import.meta.url)
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  if (pkg && typeof pkg.version === 'string') pkgVersion = pkg.version
} catch {
  // fall back to default
}

program
  .name('gitsema')
  .description('A content-addressed semantic index synchronized with Git\'s object model.')
  .version(pkgVersion)

const GROUPS = [
  'Setup & Infrastructure',
  'Protocol Servers',
  'Search & Discovery',
  'Analysis',
  'File History',
  'Concept History',
  'Cluster Analysis',
  'Change Detection',
  'Code Quality',
  'Workflow & CI',
  'Workflows',
  'Repo Insights',
  'Visualization',
  'Maintenance',
] as const

const COMMAND_GROUPS: Record<string, string> = {
  config:         'Setup & Infrastructure',
  status:         'Setup & Infrastructure',
  index:          'Setup & Infrastructure',
  models:         'Setup & Infrastructure',
  'remote-index': 'Setup & Infrastructure',
  tools:            'Protocol Servers',
  search:           'Search & Discovery',
  'first-seen':     'Search & Discovery',
  'dead-concepts':  'Search & Discovery',
  'file-evolution': 'File History',
  'file-diff':      'File History',
  blame:            'File History',
  'semantic-blame': 'File History',
  impact:           'File History',
  evolution:           'Concept History',
  'concept-evolution': 'Concept History',
  diff:                'Concept History',
  author:              'Concept History',
  clusters:           'Cluster Analysis',
  'cluster-diff':     'Cluster Analysis',
  'cluster-timeline': 'Cluster Analysis',
  'branch-summary':   'Cluster Analysis',
  'merge-audit':      'Cluster Analysis',
  'merge-preview':    'Cluster Analysis',
  'change-points':         'Change Detection',
  'file-change-points':    'Change Detection',
  'cluster-change-points': 'Change Detection',
  'code-search':         'Code Quality',
  'security-scan':       'Code Quality',
  health:                'Code Quality',
  debt:                  'Code Quality',
  'doc-gap':             'Code Quality',
  'refactor-candidates': 'Code Quality',
  lifecycle:             'Code Quality',
  bisect:                  'Workflow & CI',
  'ci-diff':               'Workflow & CI',
  'contributor-profile':   'Workflow & CI',
  'cherry-pick-suggest':   'Workflow & CI',
  repos:                   'Workflow & CI',
  watch:                   'Workflow & CI',
  triage:                  'Analysis',
  policy:                  'Analysis',
  ownership:               'Analysis',
  workflow:                'Workflows',
  experts:                 'Repo Insights',
  map:     'Visualization',
  heatmap: 'Visualization',
  project: 'Visualization',
  'backfill-fts': 'Maintenance',
  'rebuild-fts': 'Maintenance',
  vacuum: 'Maintenance',
  gc: 'Maintenance',
  'update-modules': 'Maintenance',
  'clear-model': 'Maintenance',
  'export-index': 'Maintenance',
  'import-index': 'Maintenance',
  serve: 'Protocol Servers',
  mcp: 'Protocol Servers',
  lsp: 'Protocol Servers',
  'pr-report': 'Workflow & CI',
  'regression-gate': 'Workflow & CI',
  'cross-repo-similarity': 'Repo Insights',
  'code-review': 'Code Quality',
  eval: 'Analysis',
  repl: 'Search & Discovery',
  quickstart: 'Setup & Infrastructure',
}

program.configureHelp({
  formatHelp(cmd, helper) {
    const termWidth = helper.padWidth(cmd, helper)
    const helpWidth = helper.helpWidth ?? 80
    const itemIndentWidth = 2
    const itemSeparatorWidth = 2

    function formatItem(term: string, description: string): string {
      if (description) {
        const fullText = `${term.padEnd(termWidth + itemSeparatorWidth)}${description}`
        return helper.wrap(fullText, helpWidth - itemIndentWidth, termWidth + itemSeparatorWidth)
      }
      return term
    }
    function formatList(textArray: string[]): string {
      return textArray.join('\n').replace(/^/gm, ' '.repeat(itemIndentWidth))
    }

    let output: string[] = [`Usage: ${helper.commandUsage(cmd)}`, '']

    const commandDescription = helper.commandDescription(cmd)
    if (commandDescription.length > 0) {
      output = output.concat([helper.wrap(commandDescription, helpWidth, 0), ''])
    }

    const argumentList = helper.visibleArguments(cmd).map((argument) =>
      formatItem(helper.argumentTerm(argument), helper.argumentDescription(argument)),
    )
    if (argumentList.length > 0) {
      output = output.concat(['Arguments:', formatList(argumentList), ''])
    }

    const optionList = helper.visibleOptions(cmd).map((option) =>
      formatItem(helper.optionTerm(option), helper.optionDescription(option)),
    )
    if (optionList.length > 0) {
      output = output.concat(['Options:', formatList(optionList), ''])
    }

    if (helper.showGlobalOptions) {
      const globalOptionList = helper.visibleGlobalOptions(cmd).map((option) =>
        formatItem(helper.optionTerm(option), helper.optionDescription(option)),
      )
      if (globalOptionList.length > 0) {
        output = output.concat(['Global Options:', formatList(globalOptionList), ''])
      }
    }

    const allCommands = helper.visibleCommands(cmd)
    if (allCommands.length > 0) {
      const grouped = new Map<string, string[]>()
      const ungrouped: string[] = []

      for (const subcmd of allCommands) {
        const group = COMMAND_GROUPS[subcmd.name()]
        const item = formatItem(helper.subcommandTerm(subcmd), helper.subcommandDescription(subcmd))
        if (group) {
          if (!grouped.has(group)) grouped.set(group, [])
          grouped.get(group)!.push(item)
        } else {
          ungrouped.push(item)
        }
      }

      for (const groupName of GROUPS) {
        const items = grouped.get(groupName)
        if (items?.length) {
          output = output.concat([`${groupName}:`, formatList(items), ''])
        }
      }

      if (ungrouped.length > 0) {
        output = output.concat(['Commands:', formatList(ungrouped), ''])
      }
    }

    return output.join('\n')
  },
})

// Register all commands via the per-domain aggregator
registerAll(program)

program.parse()
