import { buildProgram } from './dist/cli/program.js'

const program = buildProgram()

function walk(cmd, prefix = '') {
  const name = prefix ? `${prefix} ${cmd.name()}` : cmd.name()
  const opts = cmd.options.map(o => o.long || o.short).filter(Boolean)
  console.log(name + ': ' + opts.join(', '))
  for (const sub of cmd.commands) {
    walk(sub, name)
  }
}

for (const cmd of program.commands) {
  walk(cmd)
}
