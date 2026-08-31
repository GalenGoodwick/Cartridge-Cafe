import { describe, expect, it } from 'vitest'
import { baseBackdropSeedCommands } from '@/app/engine/placeholder-nodes'

describe('baseBackdropSeedCommands — born in context (no grey square)', () => {
  it('sizes the backdrop to a mobile portrait rect, centered on it', () => {
    const cmds = baseBackdropSeedCommands({ gridSize: 1024, gridW: 576, gridH: 1024, deviceConfig: 'mobile' })
    const vis = cmds.find(c => c.type === 'define_visual')
    const field = cmds.find(c => c.type === 'create_field')!
    expect(vis?.name).toBe('base_bg')
    expect(typeof vis?.wgsl).toBe('string')
    expect(field.width).toBe(576)
    expect(field.height).toBe(1024)
    expect(field.x).toBe(288)   // rect center x — matches restingCenter
    expect(field.y).toBe(512)   // rect center y
    expect(field.visualType).toBe('base_bg')
    expect(field.shape).toBe('rect')
  })

  it('falls back to a square 512 canvas for an undeclared (desktop/universal) world', () => {
    const cmds = baseBackdropSeedCommands(undefined)
    const field = cmds.find(c => c.type === 'create_field')!
    expect(field.width).toBe(512)
    expect(field.height).toBe(512)
    expect(field.x).toBe(256)
    expect(field.y).toBe(256)
  })

  it('respects a seed world\'s own rect (gridW/gridH over gridSize)', () => {
    const cmds = baseBackdropSeedCommands({ gridSize: 2048, gridW: 2048, gridH: 768 })
    const field = cmds.find(c => c.type === 'create_field')!
    expect(field.width).toBe(2048)
    expect(field.height).toBe(768)
    expect(field.y).toBe(384)   // rect center, not gridSize/2 = 1024
  })
})
