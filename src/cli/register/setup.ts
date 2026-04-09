import { Command } from 'commander'
import {
  configSetCommand,
  configGetCommand,
  configListCommand,
  configUnsetCommand,
} from '../commands/config.js'
import { statusCommand } from '../commands/status.js'
import {
  modelsListCommand,
  modelsInfoCommand,
  modelsAddCommand,
  modelsRemoveCommand,
  modelsUpdateCommand,
  modelsNarratorListCommand,
  modelsNarratorAddCommand,
  modelsNarratorActivateCommand,
  modelsNarratorRemoveCommand,
  modelsKindListCommand,
  modelsKindAddCommand,
  modelsKindActivateCommand,
  modelsKindRemoveCommand,
} from '../commands/models.js'
import { collectOut } from '../../utils/outputSink.js'

export function registerSetup(program: Command) {
  program
    .command('config <action> [key] [value]')
    .description('Manage persistent configuration (set, get, list, unset)')
    .option('--global', 'apply to global config (~/.config/gitsema/config.json)')
    .option('--local', 'apply to local config (.gitsema/config.json, default for set/unset)')
    .addHelpText(
      'after',
      `
Subcommands:
  set <key> <value>   Set a config value (--global for user-level, default: repo-level)
  get <key>           Show the resolved value and its source
  list                List all active configuration values and their sources
  unset <key>         Remove a key from config (--global for user-level, default: repo-level)

Supported keys (dot-notation for command defaults):
  provider, model, textModel, codeModel, httpUrl, apiKey
  verbose, logMaxBytes, servePort, serveKey, remoteUrl, remoteKey
  index.concurrency, index.chunker, index.ext, index.maxSize, index.exclude
  index.maxCommits, index.windowSize, index.overlap
  search.top, search.hybrid, search.bm25Weight, search.recent
  search.weightVector, search.weightRecency, search.weightPath
  evolution.threshold, clusters.k
  hooks.enabled        (true/false — installs/removes Git post-commit/post-merge hooks)
  vscode.mcp           (true/false — installs/removes gitsema MCP server entry in mcp.json)
  vscode.lsp           (true/false — installs/removes gitsema LSP config in settings.json)

Examples:
  gitsema config set search.hybrid true
  gitsema config set provider http --global
  gitsema config set model text-embedding-3-small --global
  gitsema config get search.hybrid
  gitsema config list
  gitsema config unset search.hybrid`,
    )
    .action(
      async (
        action: string,
        key: string | undefined,
        value: string | undefined,
        options: { global?: boolean; local?: boolean },
      ) => {
        switch (action) {
          case 'set':
            if (!key) {
              console.error('Error: key is required for config set')
              process.exit(1)
            }
            if (value === undefined) {
              console.error('Error: value is required for config set')
              process.exit(1)
            }
            await configSetCommand(key as string, value as string, options)
            break
          case 'get':
            if (!key) {
              console.error('Error: key is required for config get')
              process.exit(1)
            }
            await configGetCommand(key as string)
            break
          case 'list':
            await configListCommand(options)
            break
          case 'unset':
            if (!key) {
              console.error('Error: key is required for config unset')
              process.exit(1)
            }
            await configUnsetCommand(key as string, options)
            break
          default:
            console.error(`Error: unknown config action '${action}'. Use: set, get, list, unset`)
            process.exit(1)
        }
      },
    )

  program
    .command('status [file]')
    .description('Show index status and database info, or status for a specific file')
    .option('--remote <url>', 'remote server URL (overrides GITSEMA_REMOTE)')
    .action(statusCommand)

  // ── `gitsema models` — model management ───────────────────────────────────

  const modelsSub = program
    .command('models')
    .description('Manage embedding model configurations (list, add, remove, info)')
    .addHelpText(
      'after',
      '\nModel profiles store per-model provider settings so different models can use\n' +
      'different providers, URLs, or API keys. Profiles are saved in .gitsema/config.json.\n\n' +
      'Use --global-name to assign a remote model identifier to a local shorthand name.\n' +
      'The shorthand is used in gitsema arguments; the global name is sent to the provider.\n\n' +
      'Examples:\n' +
      '  gitsema models list\n' +
      '  gitsema models add nomic-embed-text --provider ollama\n' +
      '  gitsema models add my-embed --global-name hf.co/org/model:latest --provider ollama\n' +
      '  gitsema models add text-embedding-3-small --provider http --url https://api.openai.com --key sk-...\n' +
      '  gitsema models info text-embedding-3-small\n' +
      '  gitsema models remove text-embedding-3-small\n',
    )
    .action(async () => {
      // Default action: show the list (same as `models list`)
      await modelsListCommand({})
    })

  modelsSub
    .command('list')
    .description('List all configured model profiles and indexed models')
    .option('--json', 'output as JSON')
    .action(async (opts: { json?: boolean }) => {
      await modelsListCommand(opts)
    })

  modelsSub
    .command('info <name>')
    .description('Show detailed configuration and index stats for a model')
    .action(async (name: string) => {
      await modelsInfoCommand(name)
    })

  modelsSub
    .command('add <name>')
    .description('Configure provider settings for a model (saved to .gitsema/config.json or global config)')
    .option('--global-name <name>', 'remote model identifier sent to the provider (local name is the shorthand used in gitsema arguments)')
    .option('--provider <type>', 'provider type: ollama, http or embedeer')
    .option('--url <url>', 'base URL for HTTP provider (e.g. https://api.openai.com)')
    .option('--key <apikey>', 'API key for HTTP provider')
    .option('--level <level>', 'default indexing/search granularity: file, function, fixed, chunk, symbol, module')
    .option('--set-default', 'also set this model as the default (model + textModel + codeModel in config)')
    .option('--set-text', 'also set this as the default text embedding model (textModel in config)')
    .option('--set-code', 'also set this as the default code embedding model (codeModel in config)')
    .option('--global', 'save to global config (~/.config/gitsema/config.json) instead of local')
    .option('--prefix-code <str>', 'prefix for code file document embeddings, e.g. "search_document:"')
    .option('--prefix-text <str>', 'prefix for text/prose file document embeddings, e.g. "search_document:"')
    .option('--prefix-query <str>', 'prefix for search query embeddings, e.g. "search_query:"')
    .option('--prefix-other <str>', 'prefix for files in the "other" category (not code or text), e.g. "search_document:"')
    .option('--prefix-type <role=prefix>', 'user-defined role prefix (can be repeated)', (v, acc) => { acc = acc || []; acc.push(v); return acc }, [] as string[])
    .option('--ext-role <ext=role>', 'custom extension-to-role mapping (can be repeated)', (v, acc) => { acc = acc || []; acc.push(v); return acc }, [] as string[])
    .action(async (
      name: string,
      opts: { globalName?: string; provider?: string; url?: string; key?: string; level?: string; setDefault?: boolean; setText?: boolean; setCode?: boolean; global?: boolean;
        prefixCode?: string; prefixText?: string; prefixQuery?: string; prefixOther?: string; prefixType?: string[]; extRole?: string[] },
    ) => {
      await modelsAddCommand(name, opts)
    })

  modelsSub
    .command('update <name>')
    .description('Update provider settings for a model (saved to .gitsema/config.json or global config)')
    .option('--global-name <name>', 'remote model identifier sent to the provider (local name is the shorthand used in gitsema arguments)')
    .option('--provider <type>', 'provider type: ollama, http or embedeer')
    .option('--url <url>', 'base URL for HTTP provider (e.g. https://api.openai.com)')
    .option('--key <apikey>', 'API key for HTTP provider')
    .option('--level <level>', 'default indexing/search granularity: file, function, fixed, chunk, symbol, module')
    .option('--set-default', 'also set this model as the default (model + textModel + codeModel in config)')
    .option('--set-text', 'also set this as the default text embedding model (textModel in config)')
    .option('--set-code', 'also set this as the default code embedding model (codeModel in config)')
    .option('--global', 'save to global config (~/.config/gitsema/config.json) instead of local')
    .option('--prefix-code <str>', 'prefix for code file document embeddings, e.g. "search_document:"')
    .option('--prefix-text <str>', 'prefix for text/prose file document embeddings, e.g. "search_document:"')
    .option('--prefix-query <str>', 'prefix for search query embeddings, e.g. "search_query:"')
    .option('--prefix-other <str>', 'prefix for files in the "other" category (not code or text), e.g. "search_document:"')
    .option('--prefix-type <role=prefix>', 'user-defined role prefix (can be repeated)', (v, acc) => { acc = acc || []; acc.push(v); return acc }, [] as string[])
    .option('--ext-role <ext=role>', 'custom extension-to-role mapping (can be repeated)', (v, acc) => { acc = acc || []; acc.push(v); return acc }, [] as string[])
    .action(async (
      name: string,
      opts: { globalName?: string; provider?: string; url?: string; key?: string; level?: string; setDefault?: boolean; setText?: boolean; setCode?: boolean; global?: boolean;
        prefixCode?: string; prefixText?: string; prefixQuery?: string; prefixOther?: string; prefixType?: string[]; extRole?: string[] },
    ) => {
      await modelsUpdateCommand(name, opts)
    })

  modelsSub
    .command('remove <name>')
    .description('Remove a model profile from config (does not delete index data unless --purge-index)')
    .option('--purge-index', 'also delete all stored embeddings for this model from the index')
    .option('-y, --yes', 'skip confirmation when purging index data')
    .option('--global', 'remove from global config instead of local')
    .action(async (
      name: string,
      opts: { purgeIndex?: boolean; yes?: boolean; global?: boolean },
    ) => {
      await modelsRemoveCommand(name, opts)
    })

  // ---------------------------------------------------------------------------
  // Unified narrator / guide model management (--narrator | --guide flag)
  // ---------------------------------------------------------------------------

  // models list [--narrator] [--guide]
  // (extends existing list subcommand with optional kind flag)
  modelsSub
    .command('list-narrator')
    .alias('narrator-list')
    .description('List narrator model configs (kind=narrator). Alias: models list --narrator')
    .option('--json', 'output as JSON')
    .action(async (opts: { json?: boolean }) => {
      await modelsKindListCommand('narrator', opts)
    })

  modelsSub
    .command('list-guide')
    .description('List guide model configs (kind=guide). Alias: models list --guide')
    .option('--json', 'output as JSON')
    .action(async (opts: { json?: boolean }) => {
      await modelsKindListCommand('guide', opts)
    })

  // models add <name> --narrator / --guide
  modelsSub
    .command('add-narrator <name>')
    .alias('narrator-add')
    .description('Add/update a narrator model config (--narrator shorthand). Use --activate to set as default.')
    .option('--http-url <url>', 'OpenAI-compatible base URL for chat completions (required)')
    .option('--key <token>', 'API key / Bearer token')
    .option('--max-tokens <n>', 'max tokens per narration call (default: 512)')
    .option('--temperature <n>', 'temperature (default: 0.3)')
    .option('--activate', 'set this as the active narrator model immediately')
    .action(async (
      name: string,
      opts: { httpUrl?: string; key?: string; maxTokens?: string; temperature?: string; activate?: boolean },
    ) => {
      await modelsKindAddCommand(name, 'narrator', { httpUrl: opts.httpUrl ?? '', key: opts.key, maxTokens: opts.maxTokens, temperature: opts.temperature, activate: opts.activate })
    })

  modelsSub
    .command('add-guide <name>')
    .description('Add/update a guide model config. Guide models power gitsema guide interactive chat.')
    .option('--http-url <url>', 'OpenAI-compatible base URL for chat completions (required)')
    .option('--key <token>', 'API key / Bearer token')
    .option('--max-tokens <n>', 'max tokens per guide call (default: 512)')
    .option('--temperature <n>', 'temperature (default: 0.3)')
    .option('--activate', 'set this as the active guide model immediately')
    .action(async (
      name: string,
      opts: { httpUrl?: string; key?: string; maxTokens?: string; temperature?: string; activate?: boolean },
    ) => {
      await modelsKindAddCommand(name, 'guide', { httpUrl: opts.httpUrl ?? '', key: opts.key, maxTokens: opts.maxTokens, temperature: opts.temperature, activate: opts.activate })
    })

  // models activate <name> --narrator / --guide
  modelsSub
    .command('activate-narrator <name>')
    .alias('narrator-activate')
    .description('Set a narrator model as the active default (used by gitsema narrate / explain)')
    .action(async (name: string) => {
      await modelsKindActivateCommand(name, 'narrator')
    })

  modelsSub
    .command('activate-guide <name>')
    .description('Set a guide model as the active default (used by gitsema guide)')
    .action(async (name: string) => {
      await modelsKindActivateCommand(name, 'guide')
    })

  // models remove <name> --narrator / --guide
  modelsSub
    .command('remove-narrator <name>')
    .alias('narrator-remove')
    .description('Remove a narrator model config from the DB')
    .action(async (name: string) => {
      await modelsKindRemoveCommand(name, 'narrator')
    })

  modelsSub
    .command('remove-guide <name>')
    .description('Remove a guide model config from the DB')
    .action(async (name: string) => {
      await modelsKindRemoveCommand(name, 'guide')
    })
}
