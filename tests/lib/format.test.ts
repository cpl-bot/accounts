import { describe, expect, it } from 'vitest'
import { formatAxisLakh, formatINR, formatLakh, formatPercent } from '@/lib/format'

describe('formatINR', () => {
  it('formats a positive amount with Indian digit grouping and 2 decimals', () => {
    expect(formatINR(617308)).toBe('₹6,17,308.00')
  })

  it('respects a custom fractionDigits', () => {
    expect(formatINR(1000, 0)).toBe('₹1,000')
  })

  it('formats zero', () => {
    expect(formatINR(0)).toBe('₹0.00')
  })
})

describe('formatLakh', () => {
  it('formats crore-scale values', () => {
    expect(formatLakh(1_50_00_000)).toBe('₹1.50 Cr')
  })

  it('formats lakh-scale values', () => {
    expect(formatLakh(21_70_000)).toBe('₹21.70 L')
  })

  it('formats thousand-scale values', () => {
    expect(formatLakh(4_500)).toBe('₹5 K')
  })

  it('formats small values without a suffix', () => {
    expect(formatLakh(420)).toBe('₹420')
  })

  it('preserves the sign for negative values', () => {
    expect(formatLakh(-9_17_000)).toBe('-₹9.17 L')
  })
})

describe('formatAxisLakh', () => {
  it('renders exactly ₹0 for zero', () => {
    expect(formatAxisLakh(0)).toBe('₹0')
  })

  it('formats lakh-scale axis labels with one decimal', () => {
    expect(formatAxisLakh(4_50_000)).toBe('₹4.5 L')
  })

  it('formats thousand-scale axis labels without decimals', () => {
    expect(formatAxisLakh(3_000)).toBe('₹3 K')
  })

  it('formats sub-thousand values as a raw rupee amount', () => {
    expect(formatAxisLakh(250)).toBe('₹250')
  })
})

describe('formatPercent', () => {
  it('prefixes an up arrow for positive values', () => {
    expect(formatPercent(12.345)).toBe('↑ 12.35%')
  })

  it('prefixes a down arrow for negative values', () => {
    expect(formatPercent(-3)).toBe('↓ 3.00%')
  })

  it('has no arrow for zero', () => {
    expect(formatPercent(0)).toBe('0.00%')
  })
})
