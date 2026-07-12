// Field Engine — Input Handling (pointer → cell mapping, shape tools)

import { DEFAULT_GRID_SIZE } from './types'

export class FieldInput {
  gridSize: number

  constructor(gridSize: number = DEFAULT_GRID_SIZE) {
    this.gridSize = gridSize
  }

  /** Convert screen pixel coordinates to grid cell coordinates */
  screenToCell(
    screenX: number,
    screenY: number,
    canvasRect: DOMRect,
    camera: { x: number; y: number },
    zoom: number
  ): { x: number; y: number } {
    // Normalize screen position to [0,1] within canvas
    const normX = (screenX - canvasRect.left) / canvasRect.width
    const normY = (screenY - canvasRect.top) / canvasRect.height

    const aspect = canvasRect.width / canvasRect.height
    const gridRange = this.gridSize / zoom

    let gridX: number, gridY: number
    if (aspect > 1) {
      gridX = camera.x + (normX - 0.5) * gridRange * aspect
      gridY = camera.y + (normY - 0.5) * gridRange
    } else {
      gridX = camera.x + (normX - 0.5) * gridRange
      gridY = camera.y + (normY - 0.5) * gridRange / aspect
    }

    return {
      x: Math.floor(gridX),
      y: Math.floor(gridY),
    }
  }

  /** Get the grid delta for a screen pixel delta (for panning) */
  screenDeltaToGridDelta(
    dxScreen: number,
    dyScreen: number,
    canvasRect: DOMRect,
    zoom: number
  ): { dx: number; dy: number } {
    const aspect = canvasRect.width / canvasRect.height
    const gridRange = this.gridSize / zoom

    let dx: number, dy: number
    if (aspect > 1) {
      dx = (dxScreen / canvasRect.width) * gridRange * aspect
      dy = (dyScreen / canvasRect.height) * gridRange
    } else {
      dx = (dxScreen / canvasRect.width) * gridRange
      dy = (dyScreen / canvasRect.height) * gridRange / aspect
    }

    return { dx, dy }
  }

  /** Brush tool: returns cell indices in a filled circle around position */
  getBrushCells(cellX: number, cellY: number, brushSize: number): number[] {
    const cells: number[] = []
    const radius = Math.floor(brushSize / 2)

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > radius * radius) continue
        const x = cellX + dx
        const y = cellY + dy
        if (x < 0 || x >= this.gridSize || y < 0 || y >= this.gridSize) continue
        cells.push(y * this.gridSize + x)
      }
    }

    return cells
  }

  /** Line tool: returns cell indices along a line with thickness */
  getLineCells(
    from: { x: number; y: number },
    to: { x: number; y: number },
    thickness: number
  ): number[] {
    const cells = new Set<number>()
    const dx = to.x - from.x
    const dy = to.y - from.y
    const steps = Math.max(Math.abs(dx), Math.abs(dy), 1)

    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const cx = Math.round(from.x + dx * t)
      const cy = Math.round(from.y + dy * t)

      // Apply thickness as brush at each point
      const brushCells = this.getBrushCells(cx, cy, thickness)
      for (const idx of brushCells) {
        cells.add(idx)
      }
    }

    return Array.from(cells)
  }

  /** Circle tool: returns cell indices in a circle outline with thickness */
  getCircleCells(
    center: { x: number; y: number },
    radius: number
  ): number[] {
    const cells = new Set<number>()

    // Filled circle
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > radius * radius) continue
        const x = center.x + dx
        const y = center.y + dy
        if (x < 0 || x >= this.gridSize || y < 0 || y >= this.gridSize) continue
        cells.add(y * this.gridSize + x)
      }
    }

    return Array.from(cells)
  }

  /** Rect tool: returns cell indices in a filled rectangle */
  getRectCells(
    corner1: { x: number; y: number },
    corner2: { x: number; y: number }
  ): number[] {
    const cells: number[] = []
    const minX = Math.max(0, Math.min(corner1.x, corner2.x))
    const maxX = Math.min(this.gridSize - 1, Math.max(corner1.x, corner2.x))
    const minY = Math.max(0, Math.min(corner1.y, corner2.y))
    const maxY = Math.min(this.gridSize - 1, Math.max(corner1.y, corner2.y))

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        cells.push(y * this.gridSize + x)
      }
    }

    return cells
  }

  /** Freeform tool: returns cell indices along a freeform path with thickness */
  getFreeformCells(points: { x: number; y: number }[], thickness: number): number[] {
    const cells = new Set<number>()

    for (let i = 0; i < points.length - 1; i++) {
      const lineCells = this.getLineCells(points[i], points[i + 1], thickness)
      for (const idx of lineCells) {
        cells.add(idx)
      }
    }

    // Also paint at the last point
    if (points.length > 0) {
      const last = points[points.length - 1]
      const brushCells = this.getBrushCells(last.x, last.y, thickness)
      for (const idx of brushCells) {
        cells.add(idx)
      }
    }

    return Array.from(cells)
  }
}
