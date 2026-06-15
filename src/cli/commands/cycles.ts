import { getCachedStorageProfile } from '../../core/storage/resolveProfile.js'
import { findCycles } from '../../core/graph/cycles.js'
import type { EdgeType } from '../../core/storage/types.js'

export interface CyclesCommandOptions {
  edgeTypes?: string
}

export async function cyclesCommand(options: CyclesCommandOptions = {}): Promise<void> {
  const profile = getCachedStorageProfile(process.cwd())
  const edgeTypes = options.edgeTypes
    ? options.edgeTypes.split(',').map((s) => s.trim()).filter(Boolean) as EdgeType[]
    : (['imports'] as EdgeType[])

  const cycles = await findCycles(profile.graph, edgeTypes)

  if (cycles.length === 0) {
    console.log(`No ${edgeTypes.join('/')} cycles found.`)
    return
  }

  console.log(`Found ${cycles.length} ${edgeTypes.join('/')} cycle(s):\n`)
  for (const cycle of cycles) {
    console.log(`  ${cycle.displayNames.join(' -> ')}`)
  }
}
