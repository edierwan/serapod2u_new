export interface RepackBalance {
  configId: string
  onHand: number
  allocated: number
}

export interface RepackPreview {
  quantity: number
  sourceBefore: number
  sourceAfter: number
  sourceAvailable: number
  destinationBefore: number
  destinationAfter: number
  totalBefore: number
  totalAfter: number
}

const wholeNumber = (value: unknown): number | null => {
  const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN
  return Number.isInteger(parsed) ? parsed : null
}

export const createRepackPreview = (
  source: RepackBalance,
  destination: RepackBalance,
  requestedQuantity: unknown,
): RepackPreview => {
  if (!source.configId || !destination.configId || source.configId === destination.configId) {
    throw new Error('Source and destination configurations must differ')
  }

  const quantity = wholeNumber(requestedQuantity)
  if (quantity === null || quantity <= 0) {
    throw new Error('Repack quantity must be a positive whole number')
  }

  const sourceBefore = wholeNumber(source.onHand)
  const sourceAllocated = wholeNumber(source.allocated)
  const destinationBefore = wholeNumber(destination.onHand)
  if (
    sourceBefore === null ||
    sourceAllocated === null ||
    destinationBefore === null ||
    sourceBefore < 0 ||
    sourceAllocated < 0 ||
    destinationBefore < 0
  ) {
    throw new Error('Repack balances must be non-negative whole numbers')
  }

  const sourceAvailable = Math.max(0, sourceBefore - sourceAllocated)
  if (quantity > sourceAvailable) {
    throw new Error(`Repack quantity exceeds available stock (${sourceAvailable})`)
  }

  const sourceAfter = sourceBefore - quantity
  const destinationAfter = destinationBefore + quantity
  return {
    quantity,
    sourceBefore,
    sourceAfter,
    sourceAvailable,
    destinationBefore,
    destinationAfter,
    totalBefore: sourceBefore + destinationBefore,
    totalAfter: sourceAfter + destinationAfter,
  }
}

export const isRepackSourceConfiguration = (configuration: {
  config_code?: string | null
  volume_ml?: number | null
  packaging?: string | null
  status?: string | null
}): boolean =>
  configuration.status !== 'inactive' &&
  configuration.volume_ml === 50 &&
  (
    (configuration.config_code === '50OB' && configuration.packaging === 'old_box') ||
    (configuration.config_code === '50NB' && configuration.packaging === 'new_box')
  )

export const isRepackDestinationConfiguration = (configuration: {
  config_code?: string | null
  volume_ml?: number | null
  packaging?: string | null
  status?: string | null
}): boolean =>
  configuration.status === 'active' &&
  configuration.config_code === '20NB' &&
  configuration.volume_ml === 20 &&
  configuration.packaging === 'new_box'
