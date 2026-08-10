import sharp from 'sharp'
import type { WebpOptions } from 'sharp'
import { IMAGE_POLICY } from '../constants.js'
import { VisionError } from '../errors.js'
import type { EncodedImage, NormalizedImage } from './types.js'

export interface TileBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface NormalizedRegion {
  x: number
  y: number
  width: number
  height: number
}

export interface SelectedTile {
  tileIndex: number
  bounds: TileBounds
}

export interface TileSelection {
  selected: SelectedTile[]
  requiredTiles: number
  complete: boolean
}

export type ContentKind = 'document' | 'screenshot' | 'diagram' | 'photo' | 'uncertain'

function axisAnchors(length: number, tileSize: number, stride: number): number[] {
  if (length <= tileSize) return [0]
  const anchors: number[] = []
  for (let position = 0; position + tileSize <= length; position += stride) anchors.push(position)
  const edge = length - tileSize
  if (anchors.at(-1) !== edge) anchors.push(edge)
  return anchors
}

export function selectEvenlyDistributed<T>(items: readonly T[], count: number): T[] {
  const slots = Math.min(Math.max(0, Math.floor(count)), items.length)
  if (slots === items.length) return [...items]
  const selected: T[] = []
  for (let slot = 0; slot < slots; slot += 1) {
    const position =
      slots === 1 ? Math.floor((items.length - 1) / 2) : Math.round((slot * (items.length - 1)) / (slots - 1))
    const item = items[position]
    if (item !== undefined) selected.push(item)
  }
  return selected
}

export function createGrid(width: number, height: number, tileSize: number, overlap: number): TileBounds[] {
  if (
    ![width, height, tileSize].every(value => Number.isInteger(value) && value > 0) ||
    overlap < 0 ||
    overlap >= tileSize
  ) {
    throw new RangeError('Invalid tile geometry')
  }
  const stride = tileSize - overlap
  const xs = axisAnchors(width, tileSize, stride)
  const ys = axisAnchors(height, tileSize, stride)
  return ys.flatMap(y =>
    xs.map(x => ({ x, y, width: Math.min(tileSize, width - x), height: Math.min(tileSize, height - y) })),
  )
}

export function expandRegion(
  region: NormalizedRegion,
  imageWidth: number,
  imageHeight: number,
  margin: number,
): TileBounds {
  const left = Math.max(0, Math.floor((region.x - region.width * margin) * imageWidth))
  const top = Math.max(0, Math.floor((region.y - region.height * margin) * imageHeight))
  const right = Math.min(imageWidth, Math.ceil((region.x + region.width * (1 + margin)) * imageWidth))
  const bottom = Math.min(imageHeight, Math.ceil((region.y + region.height * (1 + margin)) * imageHeight))
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) }
}

function intersects(a: TileBounds, b: TileBounds): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

export function selectTiles(
  grid: readonly TileBounds[],
  preferredRegions: readonly TileBounds[],
  maxTiles: number,
): TileSelection {
  const cap = Math.max(0, Math.floor(maxTiles))
  const preferred = grid
    .map((bounds, tileIndex) => ({ bounds, tileIndex }))
    .filter(tile => preferredRegions.some(region => intersects(tile.bounds, region)))
  const chosen = preferred.slice(0, cap)
  const chosenIndexes = new Set(chosen.map(tile => tile.tileIndex))
  const remaining = grid
    .map((bounds, tileIndex) => ({ bounds, tileIndex }))
    .filter(tile => !chosenIndexes.has(tile.tileIndex))
  const slots = Math.min(cap - chosen.length, remaining.length)
  chosen.push(...selectEvenlyDistributed(remaining, slots))
  return { selected: chosen, requiredTiles: grid.length, complete: chosen.length === grid.length }
}

async function encode(image: NormalizedImage, bounds: TileBounds, options: WebpOptions): Promise<Buffer> {
  return sharp(image.pixels, { raw: { width: image.width, height: image.height, channels: image.channels } })
    .extract({ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height })
    .webp(options)
    .toBuffer()
}

export async function encodeTile(
  image: NormalizedImage,
  bounds: TileBounds,
  contentKind: ContentKind,
): Promise<EncodedImage> {
  const initial = await encode(
    image,
    bounds,
    contentKind === 'photo' ? { quality: IMAGE_POLICY.detailTile.photoQuality } : { lossless: true },
  )
  if (initial.length <= IMAGE_POLICY.detailTile.maxBytes) {
    return {
      buffer: initial,
      mediaType: 'image/webp',
      width: bounds.width,
      height: bounds.height,
      bytes: initial.length,
    }
  }
  for (const quality of IMAGE_POLICY.detailTile.fallbackQualities) {
    const candidate = await encode(image, bounds, { quality })
    if (candidate.length <= IMAGE_POLICY.detailTile.maxBytes) {
      return {
        buffer: candidate,
        mediaType: 'image/webp',
        width: bounds.width,
        height: bounds.height,
        bytes: candidate.length,
      }
    }
  }
  throw new VisionError('SOURCE_TOO_LARGE', 'A detail tile cannot fit within the encoded byte limit.', {
    details: { stage: 'detail_tile_encode', maxBytes: IMAGE_POLICY.detailTile.maxBytes },
  })
}
