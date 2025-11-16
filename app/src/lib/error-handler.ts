/**
 * Utility functions for handling and displaying errors in a user-friendly way
 */

export interface ErrorInfo {
  isNetworkError: boolean
  isUserInputError: boolean
  title: string
  message: string
  variant: 'default' | 'destructive' | 'warning'
}

/**
 * Detect if an error is related to network/connectivity issues
 */
export function isNetworkError(error: any): boolean {
  if (!error) return false
  
  const errorMessage = error.message?.toLowerCase() || ''
  const errorName = error.name?.toLowerCase() || ''
  
  return (
    errorMessage.includes('failed to fetch') ||
    errorMessage.includes('network request failed') ||
    errorMessage.includes('network error') ||
    errorMessage.includes('connection') ||
    errorMessage.includes('timeout') ||
    errorMessage.includes('net::err') ||
    (errorName === 'typeerror' && errorMessage.includes('fetch'))
  )
}

/**
 * Detect if an error is related to user input or validation
 */
export function isUserInputError(error: any): boolean {
  if (!error) return false
  
  const errorMessage = error.message?.toLowerCase() || ''
  
  return (
    errorMessage.includes('already packed') ||
    errorMessage.includes('already been completed') ||
    errorMessage.includes('already marked as spoiled') ||
    errorMessage.includes('already linked') ||
    errorMessage.includes('invalid input') ||
    errorMessage.includes('validation failed') ||
    errorMessage.includes('required field') ||
    errorMessage.includes('from a case that has already been completed') ||
    errorMessage.includes('from a completed case')
  )
}

/**
 * Parse error and return user-friendly error information
 */
export function parseError(error: any): ErrorInfo {
  if (isNetworkError(error)) {
    return {
      isNetworkError: true,
      isUserInputError: false,
      title: 'Connection Problem',
      message: 'Unable to connect to the server. Please check your internet connection and try again.',
      variant: 'destructive'
    }
  }
  
  if (isUserInputError(error)) {
    return {
      isNetworkError: false,
      isUserInputError: true,
      title: 'Attention',
      message: error.message || 'Please check your input and try again.',
      variant: 'warning'
    }
  }
  
  return {
    isNetworkError: false,
    isUserInputError: false,
    title: 'Error',
    message: error.message || 'An unexpected error occurred. Please try again.',
    variant: 'destructive'
  }
}

/**
 * Get user-friendly error message for common error scenarios
 */
export function getErrorMessage(error: any): string {
  if (isNetworkError(error)) {
    return 'Unable to connect to the server. Please check your internet connection and try again.'
  }
  
  if (error.message) {
    return error.message
  }
  
  return 'An unexpected error occurred. Please try again.'
}
