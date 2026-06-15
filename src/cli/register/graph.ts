import { Command } from 'commander'
import { graphBuildCommand } from '../commands/graphBuild.js'
import { coChangeCommand } from '../commands/coChange.js'
import { depsCommand } from '../commands/deps.js'
import { cyclesCommand } from '../commands/cycles.js'
import { graphCallersCommand } from '../commands/graphCallers.js'
import { graphCalleesCommand } from '../commands/graphCallees.js'
import { graphNeighborsCommand } from '../commands/graphNeighbors.js'
import { graphPathCommand } from '../commands/graphPath.js'

/**
 * Structural knowledge-graph commands (Phase 107, knowledge-graph §3.3/§8).
 * `gitsema graph build` truncates and rebuilds `graph_nodes`/`edges` from
 * `structural_refs` + `symbols` + `blob_commits` (populated by
 * `gitsema index --graph`). `co-change`/`deps`/`cycles` read from the result.
 */
export function registerGraph(program: Command) {
  const graph = program
    .command('graph')
    .description('Structural knowledge-graph commands (see also: index --graph)')

  graph
    .command('build')
    .description('Build/rebuild graph_nodes and edges from structural_refs, symbols, and blob_commits (truncate-and-rebuild)')
    .addHelpText(
      'after',
      '\nRequires `gitsema index --graph` to have populated structural_refs for at least\n' +
      'some blobs (TS/TSX/JS/Python only). Safe to re-run at any time — always reflects\n' +
      'the current state of the index.\n',
    )
    .action(graphBuildCommand)

  program
    .command('co-change <path>')
    .description('Files that historically change together with <path> (from blob_commits; see also: graph build)')
    .option('-k, --top <n>', 'number of results to return (default 10)', '10')
    .action(coChangeCommand)

  program
    .command('deps <identifier>')
    .description('Import/dependency closure of a file or symbol (see also: graph build, cycles)')
    .option('--reverse', 'show dependents instead of dependencies')
    .option('--depth <n>', 'limit traversal depth (default: unbounded)')
    .option('--edge-types <types>', 'comma-separated edge types to traverse (default: imports,calls,extends,implements)')
    .action(depsCommand)

  graph
    .command('cycles')
    .description('Detect cycles in the structural graph (default: import cycles)')
    .option('--edge-types <types>', 'comma-separated edge types to check for cycles (default: imports)')
    .action(cyclesCommand)

  // Top-level alias, matching the knowledge-graph §8 command catalog.
  program
    .command('cycles')
    .description('Detect cycles in the structural graph (default: import cycles) (alias of `gitsema graph cycles`)')
    .option('--edge-types <types>', 'comma-separated edge types to check for cycles (default: imports)')
    .action(cyclesCommand)

  // Phase 108: traversal primitives (recursive CTEs over edges/graph_nodes).
  graph
    .command('callers <symbol>')
    .description('Reverse `calls` traversal — who (transitively) calls <symbol> (default depth 3)')
    .option('--depth <n>', 'limit traversal depth (max 3)')
    .action(graphCallersCommand)

  graph
    .command('callees <symbol>')
    .description('Forward `calls` traversal — what <symbol> (transitively) calls (default depth 3)')
    .option('--depth <n>', 'limit traversal depth (max 3)')
    .action(graphCalleesCommand)

  graph
    .command('neighbors <node>')
    .description('Typed neighborhood of <node> — any edge kinds by default (default depth 1, max 3)')
    .option('--edge-types <types>', 'comma-separated edge types to traverse (default: all)')
    .option('--direction <dir>', "'out' | 'in' | 'both' (default: both)")
    .option('--depth <n>', 'limit traversal depth (max 3)')
    .action(graphNeighborsCommand)

  graph
    .command('path <a> <b>')
    .description('Shortest typed path from <a> to <b> (structural lens; max depth 3)')
    .action(graphPathCommand)
}
