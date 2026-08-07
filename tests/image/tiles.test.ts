import { describe, expect, test } from 'bun:test'
import { randomFillSync } from 'node:crypto'
import { createGrid, encodeTile, expandRegion, selectTiles } from '../../src/image/tiles.js'
import type { NormalizedImage } from '../../src/image/types.js'

describe('createGrid', () => {
  test('covers a long image with overlap in stable row-major order', () => {
    const tiles = createGrid(1800, 2600, 1024, 128)
    expect(tiles[0]).toEqual({ x: 0, y: 0, width: 1024, height: 1024 })
    expect(tiles.at(-1)).toEqual({ x: 776, y: 1576, width: 1024, height: 1024 })
    expect(
      tiles.every((tile, index) => {
        const previous = tiles[index - 1]
        return index === 0 || (previous !== undefined && tile.y >= previous.y)
      }),
    ).toBe(true)
    for (let y = 0; y < 2600; y += 1) expect(tiles.some(tile => y >= tile.y && y < tile.y + tile.height)).toBe(true)
    for (let x = 0; x < 1800; x += 1) expect(tiles.some(tile => x >= tile.x && x < tile.x + tile.width)).toBe(true)
    expect(
      tiles.every(tile => tile.x >= 0 && tile.y >= 0 && tile.x + tile.width <= 1800 && tile.y + tile.height <= 2600),
    ).toBe(true)
  })

  test('returns one bounded tile for a small image', () => {
    expect(createGrid(500, 300, 1024, 128)).toEqual([{ x: 0, y: 0, width: 500, height: 300 }])
  })
})

describe('region and budget selection', () => {
  test('expands normalized coordinates by a margin and clamps to the image', () => {
    expect(expandRegion({ x: 0, y: 0, width: 0.2, height: 0.25 }, 1000, 800, 0.15)).toEqual({
      x: 0,
      y: 0,
      width: 230,
      height: 230,
    })
  })

  test('prioritizes intersections, distributes the remainder, and enforces the hard cap', () => {
    const grid = createGrid(4608, 3712, 1024, 128)
    expect(grid).toHaveLength(20)
    const regions = [
      expandRegion({ x: 0, y: 0, width: 0.1, height: 0.1 }, 4608, 3712, 0.15),
      expandRegion({ x: 0.9, y: 0.9, width: 0.1, height: 0.1 }, 4608, 3712, 0.15),
    ]
    const result = selectTiles(grid, regions, 6)
    expect(result.selected).toHaveLength(6)
    expect(result.selected[0]?.tileIndex).toBe(0)
    expect(result.selected.some(tile => tile.tileIndex === 19)).toBe(true)
    expect(new Set(result.selected.map(tile => tile.tileIndex)).size).toBe(6)
    expect(result.requiredTiles).toBe(20)
    expect(result.complete).toBe(false)
  })
})

describe('encodeTile', () => {
  test('crops raw pixels and keeps output within the tile byte cap', async () => {
    const pixels = Buffer.alloc(1200 * 1100 * 3)
    randomFillSync(pixels)
    const image: NormalizedImage = {
      pixels,
      width: 1200,
      height: 1100,
      channels: 3,
      sourceFormat: 'raw',
      sourceName: 'fixture',
      selectedFrames: 1,
    }
    const result = await encodeTile(image, { x: 100, y: 50, width: 1024, height: 1024 }, 'document')
    expect([result.width, result.height]).toEqual([1024, 1024])
    expect(result.bytes).toBeLessThanOrEqual(1.5 * 1024 * 1024)
    expect(result.mediaType).toBe('image/webp')
  })
})
