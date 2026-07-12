# Engine Plugins

Agents can create `.ts` files here. Each file exports a plugin object that hooks into the simulation.

## Plugin interface

```typescript
import type { FieldSimulation } from '../simulation'

export default {
  name: 'my-plugin',
  // Called every simulation step
  onStep?: (sim: FieldSimulation, dt: number) => void,
  // Called when a field is created
  onCreateField?: (sim: FieldSimulation, fieldId: string) => void,
  // Called when a command is received (before processing)
  onCommand?: (sim: FieldSimulation, command: any) => any, // return modified command or null to cancel
}
```

Rules:
- One file per plugin. Name it uniquely.
- Plugins are additive — they all run. Don't modify or delete other plugins.
- Plugins can read and modify simulation state (fields, world params, etc.)
- Plugins can call any simulation method (createField, emitData, applyForce, etc.)
